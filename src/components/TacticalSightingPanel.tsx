import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NuiDinhDataset, PoiItem, TacticalTarget, UserPin } from '../types';
import {
  computeBearingDeg,
  formatBearingCardinal,
  formatDistance,
  haversineDistanceM,
  intersectTwoBearings,
  intersectTwoCircles,
  parseFlexibleCoordinateInput,
  projectPointByBearing,
  sampleDemElevation,
  wgs84MetersPerDeg
} from '../utils/geoMath';

export interface PinRequestPayload {
  lat: number;
  lon: number;
  label: string;
  note: string;
  lockTarget?: boolean;
}

interface TacticalSightingPanelProps {
  dataset: NuiDinhDataset;
  playerLat: number;
  playerLon: number;
  compassHeading: number;
  pitchDeg?: number;
  rollDeg?: number;
  useRealSensor?: boolean;
  lockedTarget?: TacticalTarget | null;
  userPins: UserPin[];
  onToggleRealSensor?: (enable: boolean) => void;
  onPinTargets: (items: PinRequestPayload[], closeModal?: boolean) => void;
}

type SightMode = 'project' | 'bearing' | 'circle';
type BearingSubMode = 'forward' | 'resection';

interface ArSnapshot {
  lat: number;
  lon: number;
  heading: number;
  pitch: number;
  label: string;
}

interface ResolvedStation {
  lat: number;
  lon: number;
  label: string;
  valid: boolean;
}

const KEY_LANDMARK_IDS = new Set([
  'verified-la-ban-helipad',
  'osm-node-4789726675',
  'osm-node-5537927361',
  'osm-node-5537927362',
  'verified-suoi-da-thac-ha',
  'verified-ho-ben-suoi',
  'verified-quan-co-kieu',
  'osm-node-5666383122',
  'junc-4way-central',
  'junc-la-ban-turnoff',
  'verified-red-trailhead-suoida',
  'osm-node-5537927353'
]);

function resolveStationByKey(
  key: string,
  customInput: string,
  arSnap: ArSnapshot | null,
  playerLat: number,
  playerLon: number,
  dataset: NuiDinhDataset,
  userPins: UserPin[]
): ResolvedStation {
  if (key === 'current') {
    return { lat: playerLat, lon: playerLon, label: 'Vị trí hiện tại', valid: true };
  }
  if (key === 'ar' && arSnap) {
    return { lat: arSnap.lat, lon: arSnap.lon, label: arSnap.label, valid: true };
  }
  if (key === 'custom') {
    const parsed = parseFlexibleCoordinateInput(customInput);
    if (parsed) {
      return { lat: parsed.lat, lon: parsed.lon, label: `Tọa độ (${parsed.format})`, valid: true };
    }
    return { lat: playerLat, lon: playerLon, label: 'Chưa hợp lệ', valid: false };
  }
  if (key.startsWith('pin:')) {
    const id = key.slice(4);
    const p = userPins.find((x) => x.id === id);
    if (p) return { lat: p.lat, lon: p.lon, label: p.name, valid: true };
  }
  const poi = dataset.pois.find((p) => p.id === key);
  if (poi) return { lat: poi.lat, lon: poi.lon, label: poi.name, valid: true };
  return { lat: playerLat, lon: playerLon, label: 'Vị trí hiện tại', valid: true };
}

export const TacticalSightingPanel: React.FC<TacticalSightingPanelProps> = ({
  dataset,
  playerLat,
  playerLon,
  compassHeading,
  pitchDeg = 0,
  rollDeg = 0,
  useRealSensor = false,
  lockedTarget = null,
  userPins,
  onToggleRealSensor,
  onPinTargets
}) => {
  const [mode, setMode] = useState<SightMode>('bearing');
  const [bearingSubMode, setBearingSubMode] = useState<BearingSubMode>('forward');
  const [noteBanner, setNoteBanner] = useState<string | null>(null);

  // Organize ALL 84 POIs cleanly with Key Landmarks prioritized first (fixes .slice(0, 35) truncation!)
  const { keyPois, otherPois } = useMemo(() => {
    const keyList: PoiItem[] = [];
    const rest: PoiItem[] = [];
    for (const p of dataset.pois) {
      if (KEY_LANDMARK_IDS.has(p.id)) keyList.push(p);
      else rest.push(p);
    }
    return { keyPois: keyList, otherPois: rest };
  }, [dataset.pois]);

  const laBanId = useMemo(
    () => dataset.pois.find((p) => p.id === 'verified-la-ban-helipad')?.id || dataset.pois[0]?.id || 'current',
    [dataset.pois]
  );
  const baoQuanId = useMemo(
    () => dataset.pois.find((p) => p.id === 'osm-node-4789726675')?.id || dataset.pois[1]?.id || laBanId,
    [dataset.pois, laBanId]
  );

  // Station A & B States
  const [stationAKey, setStationAKey] = useState<string>('current');
  const [customAInput, setCustomAInput] = useState<string>('');
  const [stationBKey, setStationBKey] = useState<string>(() => laBanId);
  const [customBInput, setCustomBInput] = useState<string>('');

  // Bearing Triangulation Angles & Circle Radii
  const [bearingA, setBearingA] = useState<string>('35');
  const [bearingB, setBearingB] = useState<string>('310');
  const [radiusA, setRadiusA] = useState<string>('450');
  const [radiusB, setRadiusB] = useState<string>('520');

  // Single-Ray Projection State
  const [projOriginKey, setProjOriginKey] = useState<string>('current');
  const [projCustomInput, setProjCustomInput] = useState<string>('');
  const [projAzimuth, setProjAzimuth] = useState<string>(() =>
    String(Math.round(((compassHeading % 360) + 360) % 360))
  );
  const [projDistM, setProjDistM] = useState<string>('350');

  // Inline AR Camera Sighting Drawer (no tab switching required!)
  const [showArDrawer, setShowArDrawer] = useState<boolean>(false);
  const [arTargetSlot, setArTargetSlot] = useState<'A' | 'B' | 'proj' | 'free'>('free');
  const [arCamActive, setArCamActive] = useState<boolean>(false);
  const [arCamError, setArCamError] = useState<string | null>(null);
  const [arSnapA, setArSnapA] = useState<ArSnapshot | null>(null);
  const [arSnapB, setArSnapB] = useState<ArSnapshot | null>(null);
  const [arEstDistM, setArEstDistM] = useState<string>('250');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const playerEle = useMemo(
    () => Math.round(sampleDemElevation(dataset.dem, dataset.bounds, playerLat, playerLon)),
    [dataset, playerLat, playerLon]
  );

  const notify = useCallback((msg: string) => {
    setNoteBanner(msg);
    window.setTimeout(() => {
      setNoteBanner((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const stopArCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setArCamActive(false);
  }, []);

  useEffect(() => {
    if (!showArDrawer) {
      stopArCamera();
    }
  }, [showArDrawer, stopArCamera]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!arCamActive || !showArDrawer) return;
    let cancelled = false;

    const startCam = async () => {
      setArCamError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setArCamError('Máy không mở được camera trực tiếp — vẫn ngắm chuẩn theo cảm biến la bàn bên dưới.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        setArCamError(
          `Không bật được camera (${err instanceof Error ? err.message : 'từ chối quyền'}) — vẫn dùng được kính ngắm cảm biến.`
        );
      }
    };

    startCam();
    return () => {
      cancelled = true;
    };
  }, [arCamActive, showArDrawer]);

  const handleSwitchBearingSubMode = (next: BearingSubMode) => {
    setBearingSubMode(next);
    if (next === 'resection') {
      // Standing at unknown position sighting 2 known peaks -> auto-select 2 prominent peaks if currently on 'current'
      if (stationAKey === 'current' || stationAKey === 'ar') {
        setStationAKey(laBanId);
      }
      if (stationBKey === 'current' || stationBKey === 'ar' || stationBKey === laBanId) {
        setStationBKey(baoQuanId);
      }
    } else if (stationAKey === laBanId && stationBKey === baoQuanId) {
      setStationAKey('current');
    }
  };

  const openInlineArFor = (slot: 'A' | 'B' | 'proj' | 'free') => {
    setArTargetSlot(slot);
    setShowArDrawer(true);
    setArCamActive(true);
    if (!useRealSensor && onToggleRealSensor) {
      onToggleRealSensor(true);
    }
  };

  // Resolve Stations A, B & Projection Origin
  const stationA = useMemo(
    () => resolveStationByKey(stationAKey, customAInput, arSnapA, playerLat, playerLon, dataset, userPins),
    [stationAKey, customAInput, arSnapA, playerLat, playerLon, dataset, userPins]
  );
  const stationB = useMemo(
    () => resolveStationByKey(stationBKey, customBInput, arSnapB, playerLat, playerLon, dataset, userPins),
    [stationBKey, customBInput, arSnapB, playerLat, playerLon, dataset, userPins]
  );
  const projOrigin = useMemo(
    () => resolveStationByKey(projOriginKey, projCustomInput, arSnapA, playerLat, playerLon, dataset, userPins),
    [projOriginKey, projCustomInput, arSnapA, playerLat, playerLon, dataset, userPins]
  );

  // Effective bearings (Resection automatically inverts sighting angles by +180° -> zero human error!)
  const effectiveBearingA = useMemo(() => {
    const raw = parseFloat(bearingA);
    if (!Number.isFinite(raw)) return NaN;
    return bearingSubMode === 'resection' ? (((raw + 180) % 360) + 360) % 360 : ((raw % 360) + 360) % 360;
  }, [bearingA, bearingSubMode]);

  const effectiveBearingB = useMemo(() => {
    const raw = parseFloat(bearingB);
    if (!Number.isFinite(raw)) return NaN;
    return bearingSubMode === 'resection' ? (((raw + 180) % 360) + 360) % 360 : ((raw % 360) + 360) % 360;
  }, [bearingB, bearingSubMode]);

  // Bearing Intersection Calculation
  const bearingResult = useMemo(() => {
    if (!stationA.valid || !stationB.valid) return null;
    if (!Number.isFinite(effectiveBearingA) || !Number.isFinite(effectiveBearingB)) return null;
    const res = intersectTwoBearings(
      stationA.lat,
      stationA.lon,
      effectiveBearingA,
      stationB.lat,
      stationB.lon,
      effectiveBearingB
    );
    const ele =
      res.lat !== null && res.lon !== null
        ? Math.round(sampleDemElevation(dataset.dem, dataset.bounds, res.lat, res.lon))
        : null;
    return { ...res, ele };
  }, [stationA, stationB, effectiveBearingA, effectiveBearingB, dataset]);

  // Circle Intersection Calculation
  const circleResult = useMemo(() => {
    if (!stationA.valid || !stationB.valid) return null;
    const rA = parseFloat(radiusA);
    const rB = parseFloat(radiusB);
    if (!Number.isFinite(rA) || !Number.isFinite(rB) || rA <= 0 || rB <= 0) return null;
    const res = intersectTwoCircles(stationA.lat, stationA.lon, rA, stationB.lat, stationB.lon, rB);
    const e1 = res.p1 ? Math.round(sampleDemElevation(dataset.dem, dataset.bounds, res.p1.lat, res.p1.lon)) : null;
    const e2 = res.p2 ? Math.round(sampleDemElevation(dataset.dem, dataset.bounds, res.p2.lat, res.p2.lon)) : null;
    return { ...res, e1, e2 };
  }, [stationA, stationB, radiusA, radiusB, dataset]);

  // Live Single-Ray Preview (shows exact destination coordinate & DEM elevation before pinning!)
  const projPreview = useMemo(() => {
    if (!projOrigin.valid) return null;
    const az = parseFloat(projAzimuth);
    const dist = parseFloat(projDistM);
    if (!Number.isFinite(az) || !Number.isFinite(dist) || dist <= 0) return null;
    const dest = projectPointByBearing(projOrigin.lat, projOrigin.lon, az, dist);
    const originEle = Math.round(sampleDemElevation(dataset.dem, dataset.bounds, projOrigin.lat, projOrigin.lon));
    const destEle = Math.round(sampleDemElevation(dataset.dem, dataset.bounds, dest.lat, dest.lon));
    return { ...dest, az: ((az % 360) + 360) % 360, dist, destEle, eleDiff: destEle - originEle };
  }, [projOrigin, projAzimuth, projDistM, dataset]);

  // SVG Schematic Projection Builder using exact WGS84 ellipsoid scaling
  const svgDiagram = useMemo(() => {
    const W = 280;
    const H = 144;
    const pad = 22;
    const { mPerLat, mPerLon } = wgs84MetersPerDeg((stationA.lat + stationB.lat) / 2);
    const bx = (stationB.lon - stationA.lon) * mPerLon;
    const by = (stationB.lat - stationA.lat) * mPerLat;

    const pts: { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: bx, y: by }
    ];

    let r1 = 0;
    let r2 = 0;
    if (mode === 'bearing' && bearingResult && bearingResult.lat !== null && bearingResult.lon !== null) {
      pts.push({
        x: (bearingResult.lon - stationA.lon) * mPerLon,
        y: (bearingResult.lat - stationA.lat) * mPerLat
      });
    } else if (mode === 'circle' && circleResult) {
      r1 = Math.max(1, parseFloat(radiusA) || 1);
      r2 = Math.max(1, parseFloat(radiusB) || 1);
      pts.push({ x: -r1, y: -r1 }, { x: r1, y: r1 }, { x: bx - r2, y: by - r2 }, { x: bx + r2, y: by + r2 });
      if (circleResult.p1) {
        pts.push({
          x: (circleResult.p1.lon - stationA.lon) * mPerLon,
          y: (circleResult.p1.lat - stationA.lat) * mPerLat
        });
      }
      if (circleResult.p2) {
        pts.push({
          x: (circleResult.p2.lon - stationA.lon) * mPerLon,
          y: (circleResult.p2.lat - stationA.lat) * mPerLat
        });
      }
    }

    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const span = Math.max(50, maxX - minX, maxY - minY);
    const scale = (Math.min(W, H) - pad * 2) / span;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const toSvg = (xM: number, yM: number) => ({
      sx: W / 2 + (xM - midX) * scale,
      sy: H / 2 - (yM - midY) * scale
    });

    const pA = toSvg(0, 0);
    const pB = toSvg(bx, by);
    const bA = ((Number.isFinite(effectiveBearingA) ? effectiveBearingA : 0) * Math.PI) / 180;
    const bB = ((Number.isFinite(effectiveBearingB) ? effectiveBearingB : 0) * Math.PI) / 180;
    const rayLen = span * 0.85;
    const rayAEnd = toSvg(Math.sin(bA) * rayLen, Math.cos(bA) * rayLen);
    const rayBEnd = toSvg(bx + Math.sin(bB) * rayLen, by + Math.cos(bB) * rayLen);

    const pHit =
      mode === 'bearing' && bearingResult && bearingResult.lat !== null && bearingResult.lon !== null
        ? toSvg(
            (bearingResult.lon - stationA.lon) * mPerLon,
            (bearingResult.lat - stationA.lat) * mPerLat
          )
        : null;

    const pC1 =
      mode === 'circle' && circleResult?.p1
        ? toSvg(
            (circleResult.p1.lon - stationA.lon) * mPerLon,
            (circleResult.p1.lat - stationA.lat) * mPerLat
          )
        : null;
    const pC2 =
      mode === 'circle' && circleResult?.p2
        ? toSvg(
            (circleResult.p2.lon - stationA.lon) * mPerLon,
            (circleResult.p2.lat - stationA.lat) * mPerLat
          )
        : null;

    return {
      W,
      H,
      pA,
      pB,
      rayAEnd,
      rayBEnd,
      pHit,
      pC1,
      pC2,
      r1Px: r1 * scale,
      r2Px: r2 * scale
    };
  }, [
    stationA,
    stationB,
    mode,
    effectiveBearingA,
    effectiveBearingB,
    radiusA,
    radiusB,
    bearingResult,
    circleResult
  ]);

  // AR HUD Target Metrics
  const normHeading = ((Math.round(compassHeading) % 360) + 360) % 360;
  const arTargetInfo = useMemo(() => {
    if (!lockedTarget) return null;
    const brng = computeBearingDeg(playerLat, playerLon, lockedTarget.lat, lockedTarget.lon);
    const delta = ((brng - compassHeading + 540) % 360) - 180;
    const dist = haversineDistanceM(playerLat, playerLon, lockedTarget.lat, lockedTarget.lon);
    return { brng: Math.round(brng), delta: Math.round(delta), dist };
  }, [lockedTarget, playerLat, playerLon, compassHeading]);

  const arEstD = Math.max(1, parseFloat(arEstDistM) || 250);
  const arHeightDeltaM = arEstD * Math.tan((Math.max(-80, Math.min(80, pitchDeg)) * Math.PI) / 180);
  const arProjectedCoord = projectPointByBearing(playerLat, playerLon, normHeading, arEstD);

  const renderStationOptions = (snap: ArSnapshot | null) => (
    <>
      <option value="current">
        📍 Vị trí hiện tại ({playerLat.toFixed(4)}, {playerLon.toFixed(4)})
      </option>
      {snap && (
        <option value="ar">
          📷 {snap.label} ({Math.round(snap.heading)}°)
        </option>
      )}
      <optgroup label="⭐ Mốc Trọng Yếu Núi Dinh">
        {keyPois.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.ele}m)
          </option>
        ))}
      </optgroup>
      {userPins.length > 0 && (
        <optgroup label={`🪨 Ghim Của Tôi (${userPins.length})`}>
          {userPins.map((u) => (
            <option key={`pin:${u.id}`} value={`pin:${u.id}`}>
              🪨 {u.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={`⛰️ Tất Cả Địa Danh Khác (${otherPois.length})`}>
        {otherPois.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.ele}m)
          </option>
        ))}
      </optgroup>
      <option value="custom">✏️ Tự nhập tọa độ / Plus Code...</option>
    </>
  );

  const captureFromAr = (slot: 'A' | 'B' | 'proj') => {
    const h = normHeading;
    if (slot === 'proj') {
      setProjAzimuth(String(h));
      setShowArDrawer(false);
      notify(`📌 Đã chốt góc ngắm ${h}° vào Chiếu 1 Tia!`);
      return;
    }

    const snap: ArSnapshot = {
      lat: playerLat,
      lon: playerLon,
      heading: h,
      pitch: Number(pitchDeg.toFixed(1)),
      label: `AR ${slot} ∠${String(h).padStart(3, '0')}°`
    };
    if (slot === 'A') {
      if (bearingSubMode === 'forward') {
        setArSnapA(snap);
        setStationAKey('ar');
      }
      setBearingA(String(h));
      notify(`📌 Đã chốt góc Tia A: ${h}°!`);
    } else {
      if (bearingSubMode === 'forward') {
        setArSnapB(snap);
        setStationBKey('ar');
      }
      setBearingB(String(h));
      notify(`📌 Đã chốt góc Tia B: ${h}°!`);
    }
    setShowArDrawer(false);
  };

  return (
    <div className="toolkit-body eng-toolkit-root">
      {/* 1-Row Unified Mission Selector + Inline AR Toggle */}
      <div className="subtab-strip">
        <button
          type="button"
          className={mode === 'project' ? 'active' : ''}
          onClick={() => setMode('project')}
        >
          🧭 1 Điểm + Hướng
        </button>
        <button
          type="button"
          className={mode === 'bearing' ? 'active' : ''}
          onClick={() => setMode('bearing')}
        >
          📐 2 Góc Giao Hội
        </button>
        <button
          type="button"
          className={mode === 'circle' ? 'active' : ''}
          onClick={() => setMode('circle')}
        >
          ⭕ 2 Khoảng Cách
        </button>
        <button
          type="button"
          className={showArDrawer ? 'active' : ''}
          onClick={() => {
            if (showArDrawer) {
              setShowArDrawer(false);
            } else {
              openInlineArFor(mode === 'project' ? 'proj' : 'free');
            }
          }}
        >
          📷 AR
        </button>
      </div>

      {noteBanner && <div className="success-box compact-alert">{noteBanner}</div>}

      {/* Inline AR Sighting Drawer (opens right here in 1 tap — zero tab bouncing!) */}
      {showArDrawer && (
        <div className="inline-ar-drawer">
          <div className="clino-actions-row">
            <button
              type="button"
              className={`secondary-action-btn ${arCamActive ? 'active-pill-btn' : ''}`}
              onClick={() => (arCamActive ? stopArCamera() : setArCamActive(true))}
            >
              {arCamActive ? '⏹️ Tắt Camera' : '📷 Bật Camera'}
            </button>
            {onToggleRealSensor && (
              <button
                type="button"
                className={`secondary-action-btn ${useRealSensor ? 'active-pill-btn' : ''}`}
                onClick={() => onToggleRealSensor(!useRealSensor)}
              >
                {useRealSensor ? '🧭 La Bàn Thật: BẬT' : '🎛️ Bật La Bàn Thật'}
              </button>
            )}
            <button type="button" className="secondary-action-btn" onClick={() => setShowArDrawer(false)}>
              ✕ Đóng AR
            </button>
          </div>

          {arCamError && <div className="error-box">{arCamError}</div>}

          <div className="ar-sight-viewport">
            {arCamActive && <video ref={videoRef} playsInline muted className="ar-video-bg" />}
            <div className="ar-hud-overlay">
              <div className="ar-hud-top-bar">
                <span>
                  AZM <strong>{formatBearingCardinal(normHeading)}</strong>
                </span>
                <span>
                  DỐC <strong>{pitchDeg >= 0 ? `+${pitchDeg.toFixed(1)}°` : `${pitchDeg.toFixed(1)}°`}</strong>
                </span>
                <span>
                  ALT <strong>{playerEle}m</strong>
                </span>
              </div>

              {arTargetInfo && (
                <div className="ar-target-callout">
                  🎯 {lockedTarget?.name}: {arTargetInfo.brng}° (lệch{' '}
                  {arTargetInfo.delta >= 0 ? `+${arTargetInfo.delta}°` : `${arTargetInfo.delta}°`} •{' '}
                  {formatDistance(arTargetInfo.dist)})
                </div>
              )}

              <svg viewBox="0 0 240 120" className="ar-reticle-svg" aria-hidden="true">
                <g transform={`translate(120, ${60 + Math.max(-36, Math.min(36, pitchDeg * 1.3))}) rotate(${-rollDeg})`}>
                  <line x1="-88" y1="0" x2="-22" y2="0" stroke="rgba(203,213,225,0.68)" strokeWidth="1.4" />
                  <line x1="22" y1="0" x2="88" y2="0" stroke="rgba(203,213,225,0.68)" strokeWidth="1.4" />
                </g>
                <circle cx="120" cy="60" r="13" fill="none" stroke="rgba(200,162,90,0.88)" strokeWidth="1.3" />
                <line x1="120" y1="40" x2="120" y2="53" stroke="#e2e8f0" strokeWidth="1.4" />
                <line x1="120" y1="67" x2="120" y2="80" stroke="#e2e8f0" strokeWidth="1.4" />
                <line x1="100" y1="60" x2="113" y2="60" stroke="#e2e8f0" strokeWidth="1.4" />
                <line x1="127" y1="60" x2="140" y2="60" stroke="#e2e8f0" strokeWidth="1.4" />
                <circle cx="120" cy="60" r="2" fill="#c8a25a" />
              </svg>
            </div>
          </div>

          {arTargetSlot === 'A' || arTargetSlot === 'B' ? (
            <button
              type="button"
              className="primary-action-btn full-w"
              onClick={() => captureFromAr(arTargetSlot)}
            >
              📌 Chốt Góc Ngắm ({normHeading}°) Vào Điểm {arTargetSlot}
            </button>
          ) : arTargetSlot === 'proj' ? (
            <button
              type="button"
              className="primary-action-btn full-w"
              onClick={() => captureFromAr('proj')}
            >
              📌 Chốt Hướng {normHeading}° Vào Chiếu 1 Tia
            </button>
          ) : (
            <>
              <div className="ar-capture-bar">
                <button type="button" className="secondary-action-btn" onClick={() => captureFromAr('A')}>
                  📌 Chốt Tia A ({normHeading}°)
                </button>
                <button type="button" className="secondary-action-btn" onClick={() => captureFromAr('B')}>
                  📌 Chốt Tia B ({normHeading}°)
                </button>
              </div>
              <div className="calc-input-row">
                <input
                  type="number"
                  min={1}
                  value={arEstDistM}
                  onChange={(e) => setArEstDistM(e.target.value)}
                  placeholder="Cự ly ước lượng (m)"
                />
                <button
                  type="button"
                  className="primary-action-btn"
                  onClick={() =>
                    onPinTargets([
                      {
                        lat: arProjectedCoord.lat,
                        lon: arProjectedCoord.lon,
                        label: `Ngắm AR ${arEstD}m ∠${normHeading}°`,
                        note: `Ngắm AR hướng ${normHeading}°, cự ly ${arEstD}m, ΔH ≈ ${arHeightDeltaM >= 0 ? '+' : ''}${arHeightDeltaM.toFixed(1)}m`
                      }
                    ])
                  }
                >
                  🎯 Ghim Điểm Ngắm ({arEstD}m)
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* MODE 1: Single-Ray Projection ("Từ mốc A đi X mét về hướng Y độ") */}
      {mode === 'project' && (
        <div className="eng-stack">
          <div className="tri-mode-explain">
            Dùng khi đề cho kiểu: <strong>“Từ Chùa Hang Tổ đi 350m hướng 45° Đông Bắc”</strong>.
          </div>
          <div className="form-group">
            <label>1. Chọn điểm xuất phát</label>
            <select value={projOriginKey} onChange={(e) => setProjOriginKey(e.target.value)}>
              {renderStationOptions(arSnapA)}
            </select>
          </div>
          {projOriginKey === 'custom' && (
            <input
              type="text"
              value={projCustomInput}
              onChange={(e) => setProjCustomInput(e.target.value)}
              placeholder="Nhập tọa độ điểm xuất phát (Lat, Lon hoặc Plus Code)"
            />
          )}

          <div className="two-col-inputs">
            <div className="form-group">
              <label>2. Hướng đi (0°–359°)</label>
              <div className="tri-angle-row">
                <input
                  type="number"
                  min={0}
                  max={360}
                  value={projAzimuth}
                  onChange={(e) => setProjAzimuth(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setProjAzimuth(String(normHeading))}
                  title="Lấy góc la bàn hiện tại"
                >
                  🧭
                </button>
                <button
                  type="button"
                  onClick={() => openInlineArFor('proj')}
                  title="Mở camera AR ngắm hướng"
                >
                  📷
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>3. Khoảng cách (mét)</label>
              <input
                type="number"
                min={1}
                max={25000}
                value={projDistM}
                onChange={(e) => setProjDistM(e.target.value)}
              />
            </div>
          </div>

          {projPreview && (
            <div className="eng-card">
              <div className="eng-card-head">
                <strong>🎯 Đích Dự Kiến ({formatBearingCardinal(projPreview.az)})</strong>
                <span className="eng-result-pill">
                  Cao {projPreview.destEle}m ({projPreview.eleDiff >= 0 ? `+${projPreview.eleDiff}m` : `${projPreview.eleDiff}m`})
                </span>
              </div>
              <div className="eng-stat-line">
                Tọa độ WGS84: <strong>{projPreview.lat.toFixed(6)}, {projPreview.lon.toFixed(6)}</strong>
              </div>
              <button
                type="button"
                className="primary-action-btn full-w"
                onClick={() =>
                  onPinTargets([
                    {
                      lat: projPreview.lat,
                      lon: projPreview.lon,
                      label: `Đích ${Math.round(projPreview.dist)}m ∠${Math.round(projPreview.az)}°`,
                      note: `Chiếu từ "${projOrigin.label}": đi ${projPreview.dist}m hướng ${Math.round(projPreview.az)}°`
                    }
                  ])
                }
              >
                🎯 Ghim &amp; Khóa Radar Tới Đích Này
              </button>
            </div>
          )}
        </div>
      )}

      {/* MODE 2 & 3: Two-Bearing Triangulation (Forward/Resection) or Two-Circle Trilateration */}
      {(mode === 'bearing' || mode === 'circle') && (
        <div className="eng-stack">
          {mode === 'bearing' && (
            <>
              <div className="chip-row">
                <button
                  type="button"
                  className={bearingSubMode === 'forward' ? 'active' : ''}
                  onClick={() => handleSwitchBearingSubMode('forward')}
                >
                  🎯 Tìm Đích X (Ngắm từ 2 nơi)
                </button>
                <button
                  type="button"
                  className={bearingSubMode === 'resection' ? 'active' : ''}
                  onClick={() => handleSwitchBearingSubMode('resection')}
                >
                  📍 Tìm Vị Trí TÔI (Ngắm 2 đỉnh núi)
                </button>
              </div>
              <div className="tri-mode-explain">
                {bearingSubMode === 'forward'
                  ? 'Đứng ở A ngắm tới đích X, sang B ngắm tới X → tìm tọa độ X.'
                  : 'Đứng 1 chỗ ngắm về 2 mốc A & B đã biết → app tự đảo ngược 180° để tìm đúng vị trí bạn đang đứng!'}
              </div>
            </>
          )}

          <div className="two-col-inputs">
            {/* Station A */}
            <div className="tri-station-card">
              <div className="eng-card-head">
                <strong>🚩 Mốc A</strong>
                {mode === 'bearing' && (
                  <button
                    type="button"
                    className="ota-mini-link"
                    onClick={() => openInlineArFor('A')}
                  >
                    📷 Ngắm AR
                  </button>
                )}
              </div>
              <select value={stationAKey} onChange={(e) => setStationAKey(e.target.value)}>
                {renderStationOptions(arSnapA)}
              </select>
              {stationAKey === 'custom' && (
                <input
                  type="text"
                  value={customAInput}
                  onChange={(e) => setCustomAInput(e.target.value)}
                  placeholder="Lat, Lon hoặc Plus Code"
                />
              )}
              {mode === 'bearing' ? (
                <>
                  <label className="tri-lbl">
                    {bearingSubMode === 'resection' ? 'Góc bạn ngắm thấy A' : 'Góc từ A ngắm đích'}
                  </label>
                  <div className="tri-angle-row">
                    <input
                      type="number"
                      min={0}
                      max={359}
                      value={bearingA}
                      onChange={(e) => setBearingA(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (bearingSubMode === 'forward') setStationAKey('current');
                        setBearingA(String(normHeading));
                      }}
                      title="Chốt góc la bàn hiện tại vào A"
                    >
                      🧭
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="tri-lbl">Cách A bao nhiêu mét?</label>
                  <input
                    type="number"
                    min={1}
                    max={25000}
                    value={radiusA}
                    onChange={(e) => setRadiusA(e.target.value)}
                  />
                </>
              )}
            </div>

            {/* Station B */}
            <div className="tri-station-card">
              <div className="eng-card-head">
                <strong>🚩 Mốc B</strong>
                {mode === 'bearing' && (
                  <button
                    type="button"
                    className="ota-mini-link"
                    onClick={() => openInlineArFor('B')}
                  >
                    📷 Ngắm AR
                  </button>
                )}
              </div>
              <select value={stationBKey} onChange={(e) => setStationBKey(e.target.value)}>
                {renderStationOptions(arSnapB)}
              </select>
              {stationBKey === 'custom' && (
                <input
                  type="text"
                  value={customBInput}
                  onChange={(e) => setCustomBInput(e.target.value)}
                  placeholder="Lat, Lon hoặc Plus Code"
                />
              )}
              {mode === 'bearing' ? (
                <>
                  <label className="tri-lbl">
                    {bearingSubMode === 'resection' ? 'Góc bạn ngắm thấy B' : 'Góc từ B ngắm đích'}
                  </label>
                  <div className="tri-angle-row">
                    <input
                      type="number"
                      min={0}
                      max={359}
                      value={bearingB}
                      onChange={(e) => setBearingB(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (bearingSubMode === 'forward') setStationBKey('current');
                        setBearingB(String(normHeading));
                      }}
                      title="Chốt góc la bàn hiện tại vào B"
                    >
                      🧭
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="tri-lbl">Cách B bao nhiêu mét?</label>
                  <input
                    type="number"
                    min={1}
                    max={25000}
                    value={radiusB}
                    onChange={(e) => setRadiusB(e.target.value)}
                  />
                </>
              )}
            </div>
          </div>

          {/* Live Geometric SVG Schematic */}
          <div className="triangulation-svg-box">
            <svg
              width={svgDiagram.W}
              height={svgDiagram.H}
              viewBox={`0 0 ${svgDiagram.W} ${svgDiagram.H}`}
              className="triangulation-svg"
            >
              <line
                x1={svgDiagram.pA.sx}
                y1={svgDiagram.pA.sy}
                x2={svgDiagram.pB.sx}
                y2={svgDiagram.pB.sy}
                stroke="rgba(148,163,184,0.35)"
                strokeDasharray="3,3"
              />
              {mode === 'bearing' ? (
                <>
                  <line
                    x1={svgDiagram.pA.sx}
                    y1={svgDiagram.pA.sy}
                    x2={svgDiagram.pHit ? svgDiagram.pHit.sx : svgDiagram.rayAEnd.sx}
                    y2={svgDiagram.pHit ? svgDiagram.pHit.sy : svgDiagram.rayAEnd.sy}
                    stroke="#38BDF8"
                    strokeWidth="2"
                  />
                  <line
                    x1={svgDiagram.pB.sx}
                    y1={svgDiagram.pB.sy}
                    x2={svgDiagram.pHit ? svgDiagram.pHit.sx : svgDiagram.rayBEnd.sx}
                    y2={svgDiagram.pHit ? svgDiagram.pHit.sy : svgDiagram.rayBEnd.sy}
                    stroke="#d49b54"
                    strokeWidth="2"
                  />
                  {svgDiagram.pHit && (
                    <g>
                      <circle cx={svgDiagram.pHit.sx} cy={svgDiagram.pHit.sy} r="5.5" fill="#c26d68" stroke="#fff" strokeWidth="1.5" />
                      <text x={svgDiagram.pHit.sx + 7} y={svgDiagram.pHit.sy - 4} fill="#fef08a" fontSize="10" fontWeight="bold">
                        {bearingSubMode === 'resection' ? 'TÔI' : 'X'}
                      </text>
                    </g>
                  )}
                </>
              ) : (
                <>
                  <circle cx={svgDiagram.pA.sx} cy={svgDiagram.pA.sy} r={Math.max(2, svgDiagram.r1Px)} fill="none" stroke="#38BDF8" strokeWidth="1.6" />
                  <circle cx={svgDiagram.pB.sx} cy={svgDiagram.pB.sy} r={Math.max(2, svgDiagram.r2Px)} fill="none" stroke="#d49b54" strokeWidth="1.6" />
                  {svgDiagram.pC1 && (
                    <g>
                      <circle cx={svgDiagram.pC1.sx} cy={svgDiagram.pC1.sy} r="4.5" fill="#4ade80" stroke="#fff" strokeWidth="1.2" />
                      <text x={svgDiagram.pC1.sx + 6} y={svgDiagram.pC1.sy - 3} fill="#bbf7d0" fontSize="9.5" fontWeight="bold">
                        P1
                      </text>
                    </g>
                  )}
                  {svgDiagram.pC2 && (
                    <g>
                      <circle cx={svgDiagram.pC2.sx} cy={svgDiagram.pC2.sy} r="4.5" fill="#facc15" stroke="#fff" strokeWidth="1.2" />
                      <text x={svgDiagram.pC2.sx + 6} y={svgDiagram.pC2.sy + 9} fill="#fef08a" fontSize="9.5" fontWeight="bold">
                        P2
                      </text>
                    </g>
                  )}
                </>
              )}
              <circle cx={svgDiagram.pA.sx} cy={svgDiagram.pA.sy} r="4" fill="#38BDF8" />
              <text x={svgDiagram.pA.sx - 11} y={svgDiagram.pA.sy - 5} fill="#bae6fd" fontSize="10" fontWeight="bold">
                A
              </text>
              <circle cx={svgDiagram.pB.sx} cy={svgDiagram.pB.sy} r="4" fill="#d49b54" />
              <text x={svgDiagram.pB.sx + 6} y={svgDiagram.pB.sy + 10} fill="#fde68a" fontSize="10" fontWeight="bold">
                B
              </text>
            </svg>
          </div>

          {/* Results */}
          {mode === 'bearing' && bearingResult && (
            <div className="eng-card">
              {bearingResult.status === 'parallel' || bearingResult.lat === null || bearingResult.lon === null ? (
                <div className="error-box">
                  2 tia song song hoặc 2 mốc trùng nhau (góc kẹp {bearingResult.crossAngleDeg}°). Chọn 2 mốc khác nhau hoặc góc ngắm lệch rõ hơn!
                </div>
              ) : (
                <>
                  <div className="eng-card-head">
                    <strong>
                      {bearingResult.status === 'ok'
                        ? bearingSubMode === 'resection'
                          ? '📍 Vị Trí Của Bạn (Giao Hội Nghịch)'
                          : '🎯 Giao Điểm 2 Tia (X)'
                        : '⚠️ Hai tia cắt ngược phía sau (kiểm tra lại góc ngắm)'}
                    </strong>
                    <span className="eng-result-pill">
                      Góc cắt {bearingResult.crossAngleDeg}° • {bearingResult.ele}m
                    </span>
                  </div>
                  <div className="eng-stat-line">
                    Tọa độ: <strong>{bearingResult.lat.toFixed(6)}, {bearingResult.lon.toFixed(6)}</strong>
                    <br />
                    Cách A: <strong>{formatDistance(Math.abs(bearingResult.dist1M))}</strong> • Cách B:{' '}
                    <strong>{formatDistance(Math.abs(bearingResult.dist2M))}</strong>
                  </div>
                  {bearingResult.crossAngleDeg < 15 && (
                    <span className="knot-warn">
                      ⚠️ Góc cắt nhỏ (&lt;15°) dễ sai số; góc lý tưởng nhất là 45°–135°.
                    </span>
                  )}
                  <button
                    type="button"
                    className="primary-action-btn full-w"
                    onClick={() =>
                      onPinTargets([
                        {
                          lat: bearingResult.lat!,
                          lon: bearingResult.lon!,
                          label:
                            bearingSubMode === 'resection'
                              ? `Vị trí Giao Hội (${bearingA}°×${bearingB}°)`
                              : `Giao Hội (${bearingA}°×${bearingB}°)`,
                          note: `${bearingSubMode === 'resection' ? 'Nghịch (tự +180°)' : 'Thuận'} từ ${stationA.label} (${bearingA}°) & ${stationB.label} (${bearingB}°) • Góc cắt ${bearingResult.crossAngleDeg}°`
                        }
                      ])
                    }
                  >
                    🎯 Ghim &amp; Khóa Radar Tới Giao Điểm
                  </button>
                </>
              )}
            </div>
          )}

          {mode === 'circle' && circleResult && (
            <div className="eng-card">
              {circleResult.status === 'concentric' ? (
                <div className="error-box">Hai mốc A và B trùng tọa độ nhau!</div>
              ) : circleResult.status !== 'ok' ? (
                <>
                  <div className="error-box">
                    {circleResult.status === 'too_far'
                      ? `2 vòng tròn KHÔNG cắt nhau (A–B dài ${Math.round(circleResult.baselineM)}m > tổng R_A + R_B).`
                      : `Vòng tròn nhỏ nằm lọt trong vòng lớn (A–B dài ${Math.round(circleResult.baselineM)}m < |R_A − R_B|).`}
                  </div>
                  {circleResult.approx && (
                    <button
                      type="button"
                      className="secondary-action-btn full-w"
                      onClick={() =>
                        onPinTargets([
                          {
                            lat: circleResult.approx!.lat,
                            lon: circleResult.approx!.lon,
                            label: 'Điểm gần đúng AB',
                            note: `Nội suy gần nhất giữa ${stationA.label} và ${stationB.label}`
                          }
                        ])
                      }
                    >
                      📍 Ghim Điểm Gần Nhất ({circleResult.approx.lat.toFixed(5)}, {circleResult.approx.lon.toFixed(5)})
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="eng-card-head">
                    <strong>⭕ 2 Giao Điểm Khả Dĩ (P1 &amp; P2)</strong>
                    <span className="eng-result-pill">A–B: {formatDistance(circleResult.baselineM)}</span>
                  </div>
                  <div className="eng-stat-line">
                    <strong>P1:</strong> {circleResult.p1!.lat.toFixed(6)}, {circleResult.p1!.lon.toFixed(6)} ({circleResult.e1}m)
                    <br />
                    <strong>P2:</strong> {circleResult.p2!.lat.toFixed(6)}, {circleResult.p2!.lon.toFixed(6)} ({circleResult.e2}m)
                  </div>
                  <div className="clino-actions-row">
                    <button
                      type="button"
                      className="secondary-action-btn"
                      onClick={() =>
                        onPinTargets([
                          {
                            lat: circleResult.p1!.lat,
                            lon: circleResult.p1!.lon,
                            label: `Giao P1 (${radiusA}m/${radiusB}m)`,
                            note: `Từ ${stationA.label} (${radiusA}m) & ${stationB.label} (${radiusB}m)`
                          }
                        ])
                      }
                    >
                      🎯 Ghim P1
                    </button>
                    <button
                      type="button"
                      className="secondary-action-btn"
                      onClick={() =>
                        onPinTargets([
                          {
                            lat: circleResult.p2!.lat,
                            lon: circleResult.p2!.lon,
                            label: `Giao P2 (${radiusA}m/${radiusB}m)`,
                            note: `Từ ${stationA.label} (${radiusA}m) & ${stationB.label} (${radiusB}m)`
                          }
                        ])
                      }
                    >
                      🎯 Ghim P2
                    </button>
                    <button
                      type="button"
                      className="primary-action-btn"
                      onClick={() =>
                        onPinTargets([
                          {
                            lat: circleResult.p2!.lat,
                            lon: circleResult.p2!.lon,
                            label: `Giao P2 (${radiusA}m/${radiusB}m)`,
                            note: `Giao điểm 2 từ ${stationA.label} & ${stationB.label}`,
                            lockTarget: false
                          },
                          {
                            lat: circleResult.p1!.lat,
                            lon: circleResult.p1!.lon,
                            label: `Giao P1 (${radiusA}m/${radiusB}m)`,
                            note: `Giao điểm 1 từ ${stationA.label} & ${stationB.label}`,
                            lockTarget: true
                          }
                        ])
                      }
                    >
                      📍 Ghim Cả 2
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
