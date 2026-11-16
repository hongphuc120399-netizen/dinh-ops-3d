import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NuiDinhDataset, TacticalTarget, UserPin } from '../types';
import {
  computeBearingDeg,
  formatBearingCardinal,
  formatDistance,
  haversineDistanceM,
  intersectTwoBearings,
  intersectTwoCircles,
  parseFlexibleCoordinateInput,
  projectPointByBearing,
  sampleDemElevation
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

type SightingSubTab = 'triangulation' | 'ar' | 'project';
type TriMode = 'bearing' | 'circle';

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
  const [subTab, setSubTab] = useState<SightingSubTab>('triangulation');
  const [triMode, setTriMode] = useState<TriMode>('bearing');
  const [noteBanner, setNoteBanner] = useState<string | null>(null);

  // Station A & B States (Default A = current position, B = Dinh La Ban or nearest junction)
  const [stationAKey, setStationAKey] = useState<string>('current');
  const [customAInput, setCustomAInput] = useState<string>('');
  const [stationBKey, setStationBKey] = useState<string>(
    () => dataset.pois[0]?.id || 'current'
  );
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

  // AR Camera Sighting (#6) State
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
    }, 3400);
  }, []);

  const stopArCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setArCamActive(false);
  }, []);

  useEffect(() => {
    if (subTab !== 'ar') {
      stopArCamera();
    }
  }, [subTab, stopArCamera]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (!arCamActive || subTab !== 'ar') return;
    let cancelled = false;

    const startCam = async () => {
      setArCamError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setArCamError('WebView không hỗ trợ mở camera trực tiếp — vẫn dùng được kính ngắm cảm biến.');
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
          `Không bật được camera (${err instanceof Error ? err.message : 'bị từ chối quyền'}). Dùng kính ngắm cảm biến bên dưới.`
        );
      }
    };

    startCam();
    return () => {
      cancelled = true;
    };
  }, [arCamActive, subTab]);

  // Resolve Stations A & B
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

  // Bearing Intersection Calculation
  const bearingResult = useMemo(() => {
    if (!stationA.valid || !stationB.valid) return null;
    const bA = parseFloat(bearingA);
    const bB = parseFloat(bearingB);
    if (!Number.isFinite(bA) || !Number.isFinite(bB)) return null;
    const res = intersectTwoBearings(stationA.lat, stationA.lon, bA, stationB.lat, stationB.lon, bB);
    const ele =
      res.lat !== null && res.lon !== null
        ? Math.round(sampleDemElevation(dataset.dem, dataset.bounds, res.lat, res.lon))
        : null;
    return { ...res, ele };
  }, [stationA, stationB, bearingA, bearingB, dataset]);

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

  // SVG Schematic Projection Builder for Triangulation / Trilateration
  const svgDiagram = useMemo(() => {
    const W = 280;
    const H = 152;
    const pad = 24;
    const mPerLon = 111319.5 * Math.cos(((stationA.lat + stationB.lat) / 2) * (Math.PI / 180));
    const mPerLat = 110605.0;
    const bx = (stationB.lon - stationA.lon) * mPerLon;
    const by = (stationB.lat - stationA.lat) * mPerLat;

    const pts: { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: bx, y: by }
    ];

    let r1 = 0;
    let r2 = 0;
    if (triMode === 'bearing' && bearingResult && bearingResult.lat !== null && bearingResult.lon !== null) {
      pts.push({
        x: (bearingResult.lon - stationA.lon) * mPerLon,
        y: (bearingResult.lat - stationA.lat) * mPerLat
      });
    } else if (triMode === 'circle' && circleResult) {
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
    const bA = ((parseFloat(bearingA) || 0) * Math.PI) / 180;
    const bB = ((parseFloat(bearingB) || 0) * Math.PI) / 180;
    const rayLen = span * 0.85;
    const rayAEnd = toSvg(Math.sin(bA) * rayLen, Math.cos(bA) * rayLen);
    const rayBEnd = toSvg(bx + Math.sin(bB) * rayLen, by + Math.cos(bB) * rayLen);

    const pHit =
      triMode === 'bearing' && bearingResult && bearingResult.lat !== null && bearingResult.lon !== null
        ? toSvg(
            (bearingResult.lon - stationA.lon) * mPerLon,
            (bearingResult.lat - stationA.lat) * mPerLat
          )
        : null;

    const pC1 =
      triMode === 'circle' && circleResult?.p1
        ? toSvg(
            (circleResult.p1.lon - stationA.lon) * mPerLon,
            (circleResult.p1.lat - stationA.lat) * mPerLat
          )
        : null;
    const pC2 =
      triMode === 'circle' && circleResult?.p2
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
  }, [stationA, stationB, triMode, bearingA, bearingB, radiusA, radiusB, bearingResult, circleResult]);

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
      {userPins.map((u) => (
        <option key={`pin:${u.id}`} value={`pin:${u.id}`}>
          🪨 {u.name}
        </option>
      ))}
      {dataset.pois.slice(0, 35).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.ele}m)
        </option>
      ))}
      <option value="custom">✏️ Tự nhập tọa độ...</option>
    </>
  );

  const captureFromAr = (slot: 'A' | 'B') => {
    const h = normHeading;
    const snap: ArSnapshot = {
      lat: playerLat,
      lon: playerLon,
      heading: h,
      pitch: Number(pitchDeg.toFixed(1)),
      label: `AR ${slot} ∠${String(h).padStart(3, '0')}°`
    };
    if (slot === 'A') {
      setArSnapA(snap);
      setStationAKey('ar');
      setBearingA(String(h));
      notify(`📌 Đã chốt Tia A: ${h}° tại vị trí hiện tại!`);
    } else {
      setArSnapB(snap);
      setStationBKey('ar');
      setBearingB(String(h));
      notify(`📌 Đã chốt Tia B: ${h}° tại vị trí hiện tại!`);
    }
  };

  return (
    <div className="toolkit-body eng-toolkit-root">
      <div className="subtab-strip">
        <button
          type="button"
          className={subTab === 'triangulation' ? 'active' : ''}
          onClick={() => setSubTab('triangulation')}
        >
          📐 Giao Hội (#1)
        </button>
        <button type="button" className={subTab === 'ar' ? 'active' : ''} onClick={() => setSubTab('ar')}>
          📷 Ngắm AR (#6)
        </button>
        <button
          type="button"
          className={subTab === 'project' ? 'active' : ''}
          onClick={() => setSubTab('project')}
        >
          🚀 Chiếu 1 Tia
        </button>
      </div>

      {noteBanner && <div className="success-box compact-alert">{noteBanner}</div>}

      {subTab === 'triangulation' && (
        <div className="eng-stack">
          <div className="chip-row">
            <button
              type="button"
              className={triMode === 'bearing' ? 'active' : ''}
              onClick={() => setTriMode('bearing')}
            >
              🔀 Giao 2 Góc Phương Vị
            </button>
            <button
              type="button"
              className={triMode === 'circle' ? 'active' : ''}
              onClick={() => setTriMode('circle')}
            >
              ⭕ Giao 2 Bán Kính (Khoảng cách)
            </button>
          </div>

          <div className="two-col-inputs">
            {/* Station A */}
            <div className="tri-station-card">
              <div className="eng-card-head">
                <strong>🚩 Điểm gốc A</strong>
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
              {triMode === 'bearing' ? (
                <>
                  <label className="tri-lbl">Góc ngắm từ A (0°–359°)</label>
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
                        setStationAKey('current');
                        setBearingA(String(normHeading));
                      }}
                      title="Lấy vị trí & hướng la bàn hiện tại vào Tia A"
                    >
                      🧭
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBearingA(String(((Math.round(parseFloat(bearingA) || 0) + 180) % 360 + 360) % 360))
                      }
                      title="Đảo ngược tia 180° (Back-bearing)"
                    >
                      180°
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="tri-lbl">Bán kính R_A (mét)</label>
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
                <strong>🚩 Điểm gốc B</strong>
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
              {triMode === 'bearing' ? (
                <>
                  <label className="tri-lbl">Góc ngắm từ B (0°–359°)</label>
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
                        setStationBKey('current');
                        setBearingB(String(normHeading));
                      }}
                      title="Lấy vị trí & hướng la bàn hiện tại vào Tia B"
                    >
                      🧭
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBearingB(String(((Math.round(parseFloat(bearingB) || 0) + 180) % 360 + 360) % 360))
                      }
                      title="Đảo ngược tia 180° (Back-bearing)"
                    >
                      180°
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="tri-lbl">Bán kính R_B (mét)</label>
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
              {triMode === 'bearing' ? (
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
                        X
                      </text>
                    </g>
                  )}
                </>
              ) : (
                <>
                  <circle
                    cx={svgDiagram.pA.sx}
                    cy={svgDiagram.pA.sy}
                    r={Math.max(2, svgDiagram.r1Px)}
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="1.6"
                  />
                  <circle
                    cx={svgDiagram.pB.sx}
                    cy={svgDiagram.pB.sy}
                    r={Math.max(2, svgDiagram.r2Px)}
                    fill="none"
                    stroke="#d49b54"
                    strokeWidth="1.6"
                  />
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
          {triMode === 'bearing' && bearingResult && (
            <div className="eng-card">
              {bearingResult.status === 'parallel' || bearingResult.lat === null || bearingResult.lon === null ? (
                <div className="error-box">
                  Hai tia song song hoặc 2 điểm gốc trùng nhau (góc kẹp {bearingResult.crossAngleDeg}°). Hãy đổi góc ngắm khác nhau hoặc di chuyển xa điểm A hơn!
                </div>
              ) : (
                <>
                  <div className="eng-card-head">
                    <strong>
                      {bearingResult.status === 'ok'
                        ? '🎯 Giao Điểm 2 Tia (X)'
                        : '⚠️ Hai tia phân kỳ (giao phía sau góc ngắm)'}
                    </strong>
                    <span className="eng-result-pill">
                      Góc cắt {bearingResult.crossAngleDeg}° • Cao {bearingResult.ele}m
                    </span>
                  </div>
                  <div className="eng-stat-line">
                    Tọa độ: <strong>{bearingResult.lat.toFixed(6)}, {bearingResult.lon.toFixed(6)}</strong>
                    <br />
                    Từ A: <strong>{formatDistance(Math.abs(bearingResult.dist1M))}</strong> • Từ B:{' '}
                    <strong>{formatDistance(Math.abs(bearingResult.dist2M))}</strong> • Đáy AB:{' '}
                    {formatDistance(bearingResult.baselineM)}
                  </div>
                  {bearingResult.crossAngleDeg < 15 && (
                    <span className="knot-warn">
                      ⚠️ Góc cắt nhỏ (&lt;15°) dễ sai số vị trí; góc lý tưởng nhất là 45°–135°.
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
                          label: `Giao Hội (${bearingA}°×${bearingB}°)`,
                          note: `Giao hội từ ${stationA.label} (${bearingA}°) và ${stationB.label} (${bearingB}°) • Góc cắt ${bearingResult.crossAngleDeg}°`
                        }
                      ])
                    }
                  >
                    🎯 Ghim &amp; Khóa Radar Tới Điểm Giao Hội
                  </button>
                </>
              )}
            </div>
          )}

          {triMode === 'circle' && circleResult && (
            <div className="eng-card">
              {circleResult.status === 'concentric' ? (
                <div className="error-box">Hai điểm gốc A và B trùng tọa độ nhau!</div>
              ) : circleResult.status !== 'ok' ? (
                <>
                  <div className="error-box">
                    {circleResult.status === 'too_far'
                      ? `2 vòng tròn KHÔNG chạm nhau (Khoảng cách A–B là ${Math.round(circleResult.baselineM)}m > tổng R_A + R_B).`
                      : `Vòng tròn nhỏ nằm lọt bên trong vòng lớn (A–B là ${Math.round(circleResult.baselineM)}m < |R_A − R_B|).`}
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
                            note: `Điểm nội suy gần nhất giữa ${stationA.label} và ${stationB.label}`
                          }
                        ])
                      }
                    >
                      📍 Ghim Điểm Gần Nhất Trên Đoạn AB ({circleResult.approx.lat.toFixed(5)}, {circleResult.approx.lon.toFixed(5)})
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="eng-card-head">
                    <strong>⭕ Có 2 Giao Điểm Khả Dĩ (P1 &amp; P2)</strong>
                    <span className="eng-result-pill">A–B: {formatDistance(circleResult.baselineM)}</span>
                  </div>
                  <div className="eng-stat-line">
                    <strong>P1:</strong> {circleResult.p1!.lat.toFixed(6)}, {circleResult.p1!.lon.toFixed(6)} (Cao{' '}
                    {circleResult.e1}m)
                    <br />
                    <strong>P2:</strong> {circleResult.p2!.lat.toFixed(6)}, {circleResult.p2!.lon.toFixed(6)} (Cao{' '}
                    {circleResult.e2}m)
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
                            note: `Giao điểm 1 từ ${stationA.label} (${radiusA}m) & ${stationB.label} (${radiusB}m)`
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
                            note: `Giao điểm 2 từ ${stationA.label} (${radiusA}m) & ${stationB.label} (${radiusB}m)`
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
                      📍 Ghim Cả P1 &amp; P2 Lên 3D
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {subTab === 'ar' && (
        <div className="eng-stack">
          <div className="clino-actions-row">
            <button
              type="button"
              className={`secondary-action-btn ${arCamActive ? 'active-pill-btn' : ''}`}
              onClick={() => (arCamActive ? stopArCamera() : setArCamActive(true))}
            >
              {arCamActive ? '⏹️ Tắt Camera' : '📷 Bật Camera Ngắm AR'}
            </button>
            {onToggleRealSensor && (
              <button
                type="button"
                className={`secondary-action-btn ${useRealSensor ? 'active-pill-btn' : ''}`}
                onClick={() => onToggleRealSensor(!useRealSensor)}
              >
                {useRealSensor ? '🧭 Cảm Biến Thật: BẬT' : '🎛️ Bật Cảm Biến La Bàn'}
              </button>
            )}
          </div>

          {arCamError && <div className="error-box">{arCamError}</div>}

          {/* Optical AR Sighting HUD Viewport */}
          <div className="ar-sight-viewport">
            {arCamActive && <video ref={videoRef} playsInline muted className="ar-video-bg" />}

            <div className="ar-hud-overlay">
              {/* Top Heading Ribbon */}
              <div className="ar-hud-top-bar">
                <span>AZM <strong>{formatBearingCardinal(normHeading)}</strong></span>
                <span>PITCH <strong>{pitchDeg >= 0 ? `+${pitchDeg.toFixed(1)}°` : `${pitchDeg.toFixed(1)}°`}</strong></span>
                <span>ALT <strong>{playerEle}m</strong></span>
              </div>

              {/* Target Alignment Tag */}
              {arTargetInfo && (
                <div className="ar-target-callout">
                  🎯 {lockedTarget?.name}: hướng <strong>{arTargetInfo.brng}°</strong> (lệch{' '}
                  {arTargetInfo.delta >= 0 ? `+${arTargetInfo.delta}°` : `${arTargetInfo.delta}°`} •{' '}
                  {formatDistance(arTargetInfo.dist)})
                </div>
              )}

              {/* Artificial Horizon + Pitch Ladder + Crosshair */}
              <svg viewBox="0 0 240 140" className="ar-reticle-svg" aria-hidden="true">
                <g
                  transform={`translate(120, ${70 + Math.max(-42, Math.min(42, pitchDeg * 1.4))}) rotate(${-rollDeg})`}
                >
                  <line x1="-90" y1="0" x2="-24" y2="0" stroke="rgba(203,213,225,0.68)" strokeWidth="1.4" />
                  <line x1="24" y1="0" x2="90" y2="0" stroke="rgba(203,213,225,0.68)" strokeWidth="1.4" />
                  <line x1="-42" y1="-22" x2="-18" y2="-22" stroke="rgba(148,163,184,0.45)" strokeWidth="1" strokeDasharray="3,2" />
                  <line x1="18" y1="-22" x2="42" y2="-22" stroke="rgba(148,163,184,0.45)" strokeWidth="1" strokeDasharray="3,2" />
                  <line x1="-42" y1="22" x2="-18" y2="22" stroke="rgba(148,163,184,0.45)" strokeWidth="1" strokeDasharray="3,2" />
                  <line x1="18" y1="22" x2="42" y2="22" stroke="rgba(148,163,184,0.45)" strokeWidth="1" strokeDasharray="3,2" />
                </g>
                {/* Fixed Center Mil Reticle */}
                <circle cx="120" cy="70" r="14" fill="none" stroke="rgba(200,162,90,0.85)" strokeWidth="1.2" />
                <line x1="120" y1="48" x2="120" y2="62" stroke="#e2e8f0" strokeWidth="1.4" />
                <line x1="120" y1="78" x2="120" y2="92" stroke="#e2e8f0" strokeWidth="1.4" />
                <line x1="98" y1="70" x2="112" y2="70" stroke="#e2e8f0" strokeWidth="1.4" />
                <line x1="128" y1="70" x2="142" y2="70" stroke="#e2e8f0" strokeWidth="1.4" />
                <circle cx="120" cy="70" r="2" fill="#c8a25a" />
              </svg>

              <div className="ar-hud-bottom-bar">
                <span>NGHIÊNG ROLL {rollDeg.toFixed(1)}°</span>
                <span>ĐỘ DỐC {Math.abs(pitchDeg) < 89 ? `${(Math.tan((pitchDeg * Math.PI) / 180) * 100).toFixed(0)}%` : '∞'}</span>
              </div>
            </div>
          </div>

          {/* Push Captured AR Sight Rays directly into Triangulation */}
          <div className="ar-capture-bar">
            <button type="button" className="secondary-action-btn" onClick={() => captureFromAr('A')}>
              📌 Chốt vào Tia A ({normHeading}°)
            </button>
            <button type="button" className="secondary-action-btn" onClick={() => captureFromAr('B')}>
              📌 Chốt vào Tia B ({normHeading}°)
            </button>
          </div>

          {(arSnapA || arSnapB) && (
            <div className="eng-stat-line">
              {arSnapA && <span>Tia A: <strong>{arSnapA.heading}°</strong> • </span>}
              {arSnapB && <span>Tia B: <strong>{arSnapB.heading}°</strong> • </span>}
              <button
                type="button"
                className="mini-toggle-btn active"
                onClick={() => {
                  setTriMode('bearing');
                  setSubTab('triangulation');
                }}
              >
                📐 Mở Giao Hội ngay →
              </button>
            </div>
          )}

          {/* Quick Range-Elevation Pinning from AR Sight */}
          <div className="eng-card">
            <div className="eng-card-head">
              <strong>📏 Phóng Chiếu &amp; Tính Cao Độ Theo Tâm Ngắm AR</strong>
            </div>
            <div className="calc-input-row">
              <input
                type="number"
                min={1}
                value={arEstDistM}
                onChange={(e) => setArEstDistM(e.target.value)}
                placeholder="Ước lượng cự ly (m)"
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
                      note: `Ngắm từ (${playerLat.toFixed(5)}, ${playerLon.toFixed(5)}) góc ${normHeading}°, cao ${arHeightDeltaM >= 0 ? '+' : ''}${arHeightDeltaM.toFixed(1)}m`
                    }
                  ])
                }
              >
                🎯 Ghim Điểm Ngắm 3D
              </button>
            </div>
            <span className="mono-sub">
              Điểm phóng chiếu: {arProjectedCoord.lat.toFixed(5)}, {arProjectedCoord.lon.toFixed(5)} • Chênh cao ước tính ΔH ≈{' '}
              <strong>{arHeightDeltaM >= 0 ? `+${arHeightDeltaM.toFixed(1)}` : arHeightDeltaM.toFixed(1)} m</strong>
            </span>
          </div>
        </div>
      )}

      {subTab === 'project' && (
        <div className="eng-stack">
          <p className="helper-note">
            Dành cho đề mật thư kiểu trinh sát: <em>"Từ Chùa Hang Tổ đi 350m về hướng 45° Đông Bắc"</em>:
          </p>
          <div className="form-group">
            <label>Điểm gốc xuất phát</label>
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
              <label>Góc phương vị (0°–359°)</label>
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
              </div>
            </div>
            <div className="form-group">
              <label>Khoảng cách (mét)</label>
              <input
                type="number"
                min={1}
                max={25000}
                value={projDistM}
                onChange={(e) => setProjDistM(e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="primary-action-btn full-w"
            onClick={() => {
              if (!projOrigin.valid) {
                notify('⚠️ Tọa độ điểm xuất phát chưa hợp lệ!');
                return;
              }
              const az = parseFloat(projAzimuth) || 0;
              const dist = Math.max(1, parseFloat(projDistM) || 100);
              const dest = projectPointByBearing(projOrigin.lat, projOrigin.lon, az, dist);
              onPinTargets([
                {
                  lat: dest.lat,
                  lon: dest.lon,
                  label: `Đích ${Math.round(dist)}m ∠${Math.round(az)}°`,
                  note: `Chiếu từ "${projOrigin.label}": đi ${dist}m hướng ${az}°`
                }
              ]);
            }}
          >
            🚀 Phóng Chiếu Tọa Độ &amp; Khóa Radar
          </button>
        </div>
      )}
    </div>
  );
};
