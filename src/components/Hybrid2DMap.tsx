import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  ImportedGpxTrack,
  Map2DStyle,
  NuiDinhDataset,
  PinCategory,
  TacticalTarget,
  TrackPoint,
  UserPin
} from '../types';
import { fetchTileWithCache, getCachedTileBlob } from '../utils/offlineVault';
import { projectPointByBearing, sampleDemElevation } from '../utils/geoMath';
import { useContinuousAngle } from './CompassSystem';

interface Hybrid2DMapProps {
  dataset: NuiDinhDataset;
  mapStyle: Map2DStyle;
  visibleRoutes: Record<string, boolean>;
  showAllTrails: boolean;
  showPois: boolean;
  playerLat: number;
  playerLon: number;
  playerAccuracy: number | null;
  compassHeading: number;
  gpsCourse: number | null;
  userPins: UserPin[];
  trackPoints: TrackPoint[];
  importedGpx: ImportedGpxTrack[];
  lockedTarget: TacticalTarget | null;
  lockedBearing: number | null;
  isSimMode: boolean;
  syntheticLandscape?: boolean;
  headingUp: boolean;
  tacticalTone: boolean;
  onToggleHeadingUp: () => void;
  flyToTrigger: { lat: number; lon: number; zoom?: number; seq: number } | null;
  onSelectTarget: (target: TacticalTarget) => void;
  onSelectUserPin: (pin: UserPin) => void;
  onRequestPinAt: (lat: number, lon: number, ele: number) => void;
  onSimMoveTo: (lat: number, lon: number) => void;
}

const PIN_EMOJI: Record<PinCategory, string> = {
  rock: '🪨',
  poop: '💩',
  checkpoint: '🚩',
  clue: '🧩',
  water: '💧',
  deadend: '⚠️',
  cache: '🎒'
};

class VaultGridLayer extends L.GridLayer {
  private styleKind: Map2DStyle;

  constructor(styleKind: Map2DStyle, opts?: L.GridLayerOptions) {
    super(opts);
    this.styleKind = styleKind;
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Draw sleek dark tactical fallback grid immediately (100% offline safe)
    ctx.fillStyle = '#0B1118';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 256; g += 64) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, g);
      ctx.lineTo(256, g);
      ctx.stroke();
    }

    if (this.styleKind === 'offline-vector') {
      setTimeout(() => done(undefined, canvas), 0);
      return canvas;
    }

    const vaultLayer =
      this.styleKind === 'google-hybrid'
        ? 'google-hybrid'
        : this.styleKind === 'google-terrain'
          ? 'google-terrain'
          : 'opentopo';

    const drawBlobRect = (
      blob: Blob,
      sx: number,
      sy: number,
      sw: number,
      sh: number
    ) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 256, 256);
        URL.revokeObjectURL(url);
        done(undefined, canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        done(undefined, canvas);
      };
      img.src = url;
    };

    (async () => {
      try {
        const directBlob = await fetchTileWithCache(vaultLayer, coords.z, coords.x, coords.y);
        if (directBlob) {
          drawBlobRect(directBlob, 0, 0, 256, 256);
          return;
        }
        // Offline Parent-Tile Overzoom Fallback (scales cached z=16/15/14/13 smoothly at Zoom 17-19!)
        for (let dz = 1; dz <= 5; dz++) {
          const pz = coords.z - dz;
          if (pz < 13) break;
          const scale = 1 << dz;
          const px = Math.floor(coords.x / scale);
          const py = Math.floor(coords.y / scale);
          const parentBlob = await getCachedTileBlob(`${vaultLayer}:${pz}:${px}:${py}`);
          if (parentBlob) {
            const subSize = 256 / scale;
            const sx = (coords.x % scale) * subSize;
            const sy = (coords.y % scale) * subSize;
            drawBlobRect(parentBlob, sx, sy, subSize, subSize);
            return;
          }
        }
        done(undefined, canvas);
      } catch {
        done(undefined, canvas);
      }
    })();

    return canvas;
  }
}

export const Hybrid2DMap: React.FC<Hybrid2DMapProps> = ({
  dataset,
  mapStyle,
  visibleRoutes,
  showAllTrails,
  showPois,
  playerLat,
  playerLon,
  playerAccuracy,
  compassHeading,
  gpsCourse,
  userPins,
  trackPoints,
  importedGpx,
  lockedTarget,
  lockedBearing,
  isSimMode,
  syntheticLandscape = false,
  headingUp,
  tacticalTone,
  onToggleHeadingUp,
  flyToTrigger,
  onSelectTarget,
  onSelectUserPin,
  onRequestPinAt,
  onSimMoveTo
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [rotSize, setRotSize] = React.useState<number>(640);
  const syntheticLandscapeRef = useRef<boolean>(syntheticLandscape);
  syntheticLandscapeRef.current = syntheticLandscape;
  const headingUpRef = useRef<boolean>(headingUp);
  headingUpRef.current = headingUp;
  const bearingRef = useRef<number>(headingUp ? compassHeading : 0);
  bearingRef.current = headingUp ? compassHeading : 0;
  const follow2DRef = useRef<boolean>(headingUp);
  const smoothBearing = useContinuousAngle(headingUp ? compassHeading : 0);
  const baseLayerRef = useRef<L.GridLayer | null>(null);
  const vectorsGroupRef = useRef<L.LayerGroup | null>(null);
  const pinsGroupRef = useRef<L.LayerGroup | null>(null);
  const trackLineRef = useRef<L.Polyline | null>(null);
  const targetLineRef = useRef<L.Polyline | null>(null);
  const sightingLineRef = useRef<L.Polyline | null>(null);
  const headingRayRef = useRef<L.Polyline | null>(null);
  const rangeRingRef = useRef<L.Circle | null>(null);
  const playerMarkerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);

  const callbacksRef = useRef({ onRequestPinAt, onSimMoveTo, isSimMode });
  callbacksRef.current = { onRequestPinAt, onSimMoveTo, isSimMode };

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!divRef.current || !wrapperRef.current) return;
    const map = L.map(divRef.current, {
      center: [dataset.center[0], dataset.center[1]],
      zoom: 14,
      minZoom: 11,
      maxZoom: 19,
      zoomControl: false,
      attributionControl: false
    });

    // Combined screen-to-Leaflet host transform supporting Pure-OTA Synthetic Landscape (+90deg) + Heading-Up (-bearing)
    const clientToHostPoint = (clientX: number, clientY: number): L.Point => {
      const wrapper = wrapperRef.current;
      const host = divRef.current;
      if (!wrapper || !host) return L.point(clientX, clientY);
      const wRect = wrapper.getBoundingClientRect();
      const wW = wrapper.clientWidth || wRect.width;
      const wH = wrapper.clientHeight || wRect.height;
      const localWx = syntheticLandscapeRef.current ? clientY - wRect.top : clientX - wRect.left;
      const localWy = syntheticLandscapeRef.current ? wRect.right - clientX : clientY - wRect.top;
      const cx = localWx - wW * 0.5;
      const cy = localWy - wH * 0.5;
      const rad = (bearingRef.current * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const rx = cx * cosA - cy * sinA;
      const ry = cx * sinA + cy * cosA;
      return L.point(host.clientWidth * 0.5 + rx, host.clientHeight * 0.5 + ry);
    };

    const origMouseEventToContainerPoint = map.mouseEventToContainerPoint.bind(map);
    map.mouseEventToContainerPoint = (ev: MouseEvent) => {
      if (syntheticLandscapeRef.current || headingUpRef.current) {
        return clientToHostPoint(ev.clientX, ev.clientY);
      }
      return origMouseEventToContainerPoint(ev);
    };

    type LeafletDraggablePatch = {
      _onDown?: (e: MouseEvent & { touches?: TouchList }) => void;
      _onMove?: (e: MouseEvent & { touches?: TouchList }) => void;
      _startPoint?: L.Point;
      _parentScale?: { x: number; y: number };
    };
    const drag = (map.dragging as unknown as { _draggable?: LeafletDraggablePatch })._draggable;
    if (drag && drag._onDown && drag._onMove) {
      map.dragging.disable();
      const origOnDown = drag._onDown;
      const origOnMove = drag._onMove;
      let startHostPt: L.Point | null = null;
      drag._onDown = function (e) {
        const first = e.touches ? e.touches[0] : e;
        if (first) startHostPt = clientToHostPoint(first.clientX, first.clientY);
        origOnDown.call(this, e);
        if (syntheticLandscapeRef.current || headingUpRef.current) {
          this._parentScale = { x: 1, y: 1 };
        }
      };
      drag._onMove = function (e) {
        const first = e.touches && e.touches.length === 1 ? e.touches[0] : e;
        if (
          (syntheticLandscapeRef.current || headingUpRef.current) &&
          startHostPt &&
          first &&
          (!e.touches || e.touches.length === 1)
        ) {
          const curHostPt = clientToHostPoint(first.clientX, first.clientY);
          const dx = curHostPt.x - startHostPt.x;
          const dy = curHostPt.y - startHostPt.y;
          if (Math.abs(dx) + Math.abs(dy) > 10) {
            follow2DRef.current = false;
          }
          this._startPoint = L.point(first.clientX - dx, first.clientY - dy);
          this._parentScale = { x: 1, y: 1 };
        }
        origOnMove.call(this, e);
      };
      map.dragging.enable();
    }

    const vectors = L.layerGroup().addTo(map);
    const pinsLayer = L.layerGroup().addTo(map);

    const trackLine = L.polyline([], {
      color: '#00F5D4',
      weight: 4,
      opacity: 0.95
    }).addTo(map);

    const targetLine = L.polyline([], {
      color: '#FFD60A',
      weight: 3,
      dashArray: '8, 8',
      opacity: 0.95
    }).addTo(map);

    const sightingLine = L.polyline([], {
      color: '#00F5D4',
      weight: 2.6,
      dashArray: '6, 6',
      opacity: 0.9
    }).addTo(map);

    const headingRay = L.polyline([], {
      color: '#00F5D4',
      weight: 1.5,
      dashArray: '3, 6',
      opacity: 0.72,
      interactive: false
    }).addTo(map);

    const rangeRing = L.circle([playerLat, playerLon], {
      radius: 150,
      color: '#00F5D4',
      weight: 1,
      dashArray: '4, 6',
      fillOpacity: 0,
      opacity: 0.55,
      interactive: false
    }).addTo(map);

    const accCircle = L.circle([playerLat, playerLon], {
      radius: playerAccuracy || 8,
      color: '#38BDF8',
      weight: 1,
      fillColor: '#38BDF8',
      fillOpacity: 0.14
    }).addTo(map);

    const playerMarker = L.marker([playerLat, playerLon], {
      icon: L.divIcon({
        className: 'player-2d-icon',
        html: '',
        iconSize: [84, 84],
        iconAnchor: [42, 42]
      }),
      zIndexOffset: 1000
    }).addTo(map);

    // Context menu / Long-press on 2D map to drop pin or teleport simulator
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const ele = Math.round(sampleDemElevation(dataset.dem, dataset.bounds, lat, lng));
      const popupDiv = document.createElement('div');
      popupDiv.className = 'map2d-quick-popup';
      popupDiv.innerHTML = `
        <div class="qp-title">⛰️ Độ cao ~${ele}m</div>
        <div class="qp-sub">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        <div class="qp-btns">
          <button data-act="pin">🪨 Ghim</button>
          ${callbacksRef.current.isSimMode ? '<button data-act="walk">🏃 Đi tới</button>' : ''}
        </div>
      `;
      const popup = L.popup({ closeButton: false })
        .setLatLng(e.latlng)
        .setContent(popupDiv)
        .openOn(map);

      popupDiv.querySelector('[data-act="pin"]')?.addEventListener('click', () => {
        callbacksRef.current.onRequestPinAt(Number(lat.toFixed(6)), Number(lng.toFixed(6)), ele);
        map.closePopup(popup);
      });
      popupDiv.querySelector('[data-act="walk"]')?.addEventListener('click', () => {
        callbacksRef.current.onSimMoveTo(Number(lat.toFixed(6)), Number(lng.toFixed(6)));
        map.closePopup(popup);
      });
    });

    mapRef.current = map;
    vectorsGroupRef.current = vectors;
    pinsGroupRef.current = pinsLayer;
    trackLineRef.current = trackLine;
    targetLineRef.current = targetLine;
    sightingLineRef.current = sightingLine;
    headingRayRef.current = headingRay;
    rangeRingRef.current = rangeRing;
    playerMarkerRef.current = playerMarker;
    accuracyCircleRef.current = accCircle;

    const roWrap = new ResizeObserver(() => {
      const w = wrapperRef.current?.clientWidth || 0;
      const h = wrapperRef.current?.clientHeight || 0;
      if (w > 0 && h > 0) {
        const needed = Math.max(320, Math.ceil(Math.hypot(w, h)) + 28);
        setRotSize((prev) => (prev === needed ? prev : needed));
      }
      map.invalidateSize({ pan: false });
    });
    roWrap.observe(wrapperRef.current);

    const ro = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    ro.observe(divRef.current);

    return () => {
      roWrap.disconnect();
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [dataset]);

  // 2. Switch Base Tile Layer (Google Hybrid / Terrain / Topo / Pure Vector)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
    }
    const nextLayer = new VaultGridLayer(mapStyle, { maxZoom: 19, maxNativeZoom: 18 });
    nextLayer.addTo(map);
    baseLayerRef.current = nextLayer;
  }, [mapStyle]);

  // 3. Render Vector Trails, Routes, Streams, Hazards, POIs
  useEffect(() => {
    const grp = vectorsGroupRef.current;
    if (!grp) return;
    grp.clearLayers();

    // Hazard Polygons (Military Shooting Range & Deep Quarries)
    for (const h of dataset.hazards) {
      const col = h.kind === 'military' ? '#FF2D55' : '#FF9F0A';
      L.polygon(h.coords, {
        color: col,
        weight: 2.5,
        dashArray: '6, 4',
        fillColor: col,
        fillOpacity: 0.24
      })
        .bindTooltip(`⛔ ${h.name}`, { sticky: true })
        .addTo(grp);
    }

    // Streams
    for (const s of dataset.streams) {
      L.polyline(s.coords, { color: '#38BDF8', weight: 2, opacity: 0.75 }).addTo(grp);
    }

    // 220kV High-Voltage Powerline Corridor (Magnetic Compass Drift Corridor)
    if (dataset.powerlines) {
      for (const pl of dataset.powerlines) {
        L.polyline(pl.coords, {
          color: '#C084FC',
          weight: 2,
          dashArray: '6, 5',
          opacity: 0.72
        })
          .bindTooltip(`⚡ ${pl.name} (Chú ý nhiễu từ kế la bàn)`, { sticky: true })
          .addTo(grp);
      }
    }

    // 281 Forest Footpaths
    if (showAllTrails) {
      for (const tr of dataset.trails) {
        if (tr.routes.length > 0) continue;
        L.polyline(tr.coords, {
          color: '#F8FAFC',
          weight: 1.8,
          dashArray: '4, 4',
          opacity: 0.65
        }).addTo(grp);
      }
    }

    // 4 Official Color Routes
    for (const r of dataset.routes) {
      if (visibleRoutes[r.id] === false) continue;
      for (const seg of r.segments) {
        L.polyline(seg, {
          color: r.color,
          weight: 4.2,
          opacity: 0.95
        })
          .bindTooltip(r.label, { sticky: true })
          .addTo(grp);
      }
    }

    // Imported GPX
    for (const gpx of importedGpx) {
      const latlngs = gpx.points.map(([lat, lon]) => [lat, lon] as [number, number]);
      L.polyline(latlngs, { color: gpx.color, weight: 4, opacity: 0.95 })
        .bindTooltip(`GPX: ${gpx.name}`)
        .addTo(grp);
    }

    // POIs
    if (showPois) {
      for (const poi of dataset.pois) {
        const iconMap: Record<string, string> = {
          peak: '⛰️',
          viewpoint: '🚁',
          temple: '⛩️',
          water: '🌊',
          camp: '⛺',
          junction: '🔀',
          boulder: '🧗',
          historic: '🏛️',
          warning: '⚠️'
        };
        const em = iconMap[poi.category] || '📍';
        const marker = L.marker([poi.lat, poi.lon], {
          icon: L.divIcon({
            className: 'poi-2d-chip',
            html: `<div class="poi-dot">${em}</div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13]
          })
        });
        marker.on('click', () => {
          onSelectTarget({
            id: poi.id,
            name: poi.name,
            lat: poi.lat,
            lon: poi.lon,
            ele: poi.ele,
            category: poi.category,
            note: poi.note
          });
        });
        const accSuffix = poi.accuracyM ? ` • ±${poi.accuracyM}m` : '';
        marker.bindTooltip(`${poi.name} (${poi.ele}m${accSuffix})`);
        marker.addTo(grp);
      }
    }
  }, [dataset, visibleRoutes, showAllTrails, showPois, importedGpx, onSelectTarget]);

  // 4. Render User Dropped Pins ("Cục đá / 💩")
  useEffect(() => {
    const grp = pinsGroupRef.current;
    if (!grp) return;
    grp.clearLayers();

    for (const pin of userPins) {
      const em = PIN_EMOJI[pin.category] || '🪨';
      const isLocked = lockedTarget?.id === pin.id;
      const m = L.marker([pin.lat, pin.lon], {
        icon: L.divIcon({
          className: 'user-pin-2d',
          html: `<div class="upin-bubble ${isLocked ? 'locked' : ''}"><span>${em}</span><b>${pin.name}</b></div>`,
          iconSize: [120, 32],
          iconAnchor: [60, 32]
        }),
        zIndexOffset: 600
      });
      m.on('click', () => onSelectUserPin(pin));
      m.addTo(grp);
    }
  }, [userPins, lockedTarget, onSelectUserPin]);

  // 5. Update Player Position, Dual-Heading Cone, Tracklog & Target Line
  useEffect(() => {
    if (!playerMarkerRef.current || !accuracyCircleRef.current) return;
    playerMarkerRef.current.setLatLng([playerLat, playerLon]);
    accuracyCircleRef.current.setLatLng([playerLat, playerLon]);
    accuracyCircleRef.current.setRadius(Math.max(5, playerAccuracy || 8));
    rangeRingRef.current?.setLatLng([playerLat, playerLon]);

    if (headingRayRef.current) {
      const rayEnd = projectPointByBearing(playerLat, playerLon, compassHeading, 350);
      headingRayRef.current.setLatLngs([
        [playerLat, playerLon],
        [rayEnd.lat, rayEnd.lon]
      ]);
    }

    const courseSvg =
      gpsCourse !== null
        ? `<g transform="rotate(${gpsCourse} 42 42)">
             <line x1="42" y1="42" x2="42" y2="8" stroke="#30D158" stroke-width="3.2" stroke-linecap="round" />
             <polygon points="42,3 36,13 48,13" fill="#30D158" />
           </g>`
        : '';

    playerMarkerRef.current.setIcon(
      L.divIcon({
        className: 'player-2d-icon',
        iconSize: [84, 84],
        iconAnchor: [42, 42],
        html: `
          <svg width="84" height="84" viewBox="0 0 84 84">
            <g transform="rotate(${compassHeading} 42 42)">
              <path d="M42 42 L20 6 A42 42 0 0 1 64 6 Z" fill="rgba(0,245,212,0.24)" stroke="rgba(0,245,212,0.65)" stroke-width="1"/>
              <polygon points="42,27 33,49 42,43 51,49" fill="#00F5D4" stroke="#061018" stroke-width="2" stroke-linejoin="round" />
            </g>
            ${courseSvg}
            <circle cx="42" cy="42" r="4.5" fill="#F8FAFC" stroke="#080B10" stroke-width="2" />
          </svg>
        `
      })
    );

    if (trackLineRef.current) {
      trackLineRef.current.setLatLngs(trackPoints.map((t) => [t.lat, t.lon] as [number, number]));
    }
    if (targetLineRef.current) {
      if (lockedTarget) {
        targetLineRef.current.setLatLngs([
          [playerLat, playerLon],
          [lockedTarget.lat, lockedTarget.lon]
        ]);
      } else {
        targetLineRef.current.setLatLngs([]);
      }
    }
    if (sightingLineRef.current) {
      if (lockedBearing !== null) {
        const endPt = projectPointByBearing(playerLat, playerLon, lockedBearing, 1200);
        sightingLineRef.current.setLatLngs([
          [playerLat, playerLon],
          [endPt.lat, endPt.lon]
        ]);
      } else {
        sightingLineRef.current.setLatLngs([]);
      }
    }
    if (headingUpRef.current && follow2DRef.current) {
      mapRef.current?.panTo([playerLat, playerLon], { animate: false });
    }
  }, [playerLat, playerLon, playerAccuracy, compassHeading, gpsCourse, trackPoints, lockedTarget, lockedBearing]);

  // 6. FlyTo Sync
  useEffect(() => {
    if (!flyToTrigger || !mapRef.current) return;
    mapRef.current.flyTo([flyToTrigger.lat, flyToTrigger.lon], flyToTrigger.zoom ?? 16, { duration: 0.7 });
  }, [flyToTrigger]);

  // 7a. Snap & follow player center whenever Heading-Up toggles on
  useEffect(() => {
    if (headingUp) {
      follow2DRef.current = true;
      mapRef.current?.panTo([playerLat, playerLon], { animate: false });
    } else {
      follow2DRef.current = false;
    }
  }, [headingUp]);

  // 7b. Re-measure Leaflet viewport whenever container sizing changes
  useEffect(() => {
    const raf = requestAnimationFrame(() => mapRef.current?.invalidateSize({ pan: false }));
    return () => cancelAnimationFrame(raf);
  }, [syntheticLandscape, headingUp, rotSize]);

  return (
    <div ref={wrapperRef} className={`map-2d-wrapper ${tacticalTone ? 'tactical-tone' : ''}`}>
      <div
        ref={divRef}
        className={`leaflet-host ${headingUp ? 'is-rotated' : ''}`}
        style={
          {
            ...(headingUp
              ? {
                  width: `${rotSize}px`,
                  height: `${rotSize}px`,
                  transform: `translate(-50%, -50%) rotate(${-smoothBearing}deg)`
                }
              : {}),
            '--map-counter-rot': `${headingUp ? Math.round(smoothBearing) : 0}deg`
          } as React.CSSProperties
        }
      />
      <div className="tactical-hud-corners" aria-hidden="true">
        <span className="thc tl" />
        <span className="thc tr" />
        <span className="thc bl" />
        <span className="thc br" />
      </div>
      <div className="map-2d-floating-controls">
        <button
          type="button"
          className={headingUp ? 'active' : ''}
          onClick={onToggleHeadingUp}
          title={headingUp ? 'Đang xoay bản đồ 2D theo điện thoại' : 'Bật xoay bản đồ 2D theo hướng điện thoại'}
        >
          {headingUp ? '🧭 Theo máy' : '⬆️ Bắc'}
        </button>
        <button
          type="button"
          onClick={() => {
            follow2DRef.current = true;
            mapRef.current?.flyTo([playerLat, playerLon], 16, { duration: 0.5 });
          }}
          title="Đưa bản đồ về vị trí của tôi"
        >
          🎯 Tôi
        </button>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${lockedTarget ? `${lockedTarget.lat},${lockedTarget.lon}` : `${playerLat},${playerLon}`}`}
          target="_blank"
          rel="noreferrer"
          className="gmaps-ext-btn"
          title="Mở điểm này trong ứng dụng Google Maps gốc"
        >
          🗺️ GMaps
        </a>
      </div>
    </div>
  );
};
