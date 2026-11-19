import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NuiDinhDataset, TacticalTarget } from '../types';
import {
  calibrateVerticalFovDeg,
  computeBearingDeg,
  computeGroundTiltRangeM,
  computeStadiametricRangeM,
  formatBearingCardinal,
  formatDistance,
  haversineDistanceM,
  projectPointByBearing,
  raycastDemDistance,
  sampleDemElevation
} from '../utils/geoMath';
import type { PinRequestPayload } from './TacticalSightingPanel';

export type ArRangeMode = 'ground' | 'dem3d' | 'stadia' | 'calibrate';
export type ArCaptureSlot = 'A' | 'B' | 'proj' | 'free';

interface ArCalibration {
  pitchOffsetDeg: number;
  eyeHeightM: number;
  vFovDeg: number;
  verifiedAt?: string;
}

const AR_CAL_KEY = 'dinh_ar_rangefinder_cal_v1';

function loadArCalibration(): ArCalibration {
  try {
    const raw = localStorage.getItem(AR_CAL_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ArCalibration>;
      return {
        pitchOffsetDeg: Number.isFinite(p.pitchOffsetDeg) ? Number(p.pitchOffsetDeg) : 0,
        eyeHeightM: Number.isFinite(p.eyeHeightM) && Number(p.eyeHeightM) >= 0.5 ? Number(p.eyeHeightM) : 1.6,
        vFovDeg: Number.isFinite(p.vFovDeg) && Number(p.vFovDeg) >= 20 ? Number(p.vFovDeg) : 46,
        verifiedAt: typeof p.verifiedAt === 'string' ? p.verifiedAt : undefined
      };
    }
  } catch {
    // ignore storage errors
  }
  return { pitchOffsetDeg: 0, eyeHeightM: 1.6, vFovDeg: 46 };
}

function saveArCalibration(cal: ArCalibration) {
  try {
    localStorage.setItem(AR_CAL_KEY, JSON.stringify(cal));
  } catch {
    // ignore
  }
}

const KEY_AR_POI_IDS = new Set([
  'verified-la-ban-helipad',
  'osm-node-4789726675',
  'osm-node-5537927361',
  'osm-node-5537927362',
  'verified-suoi-da-thac-ha',
  'verified-ho-ben-suoi',
  'verified-quan-co-kieu',
  'osm-node-5666383122',
  'junc-4way-central'
]);

const STADIA_PRESETS = [
  { label: 'Người 1.7m', h: 1.7 },
  { label: 'Cọc/Cửa 2.0m', h: 2.0 },
  { label: 'Xe máy 1.1m', h: 1.1 },
  { label: 'Cột điện 10m', h: 10.0 }
];

export interface ArRangefinderOverlayProps {
  dataset: NuiDinhDataset;
  playerLat: number;
  playerLon: number;
  playerAccuracy: number | null;
  compassHeading: number;
  pitchDeg: number;
  rollDeg: number;
  useRealSensor: boolean;
  lockedTarget: TacticalTarget | null;
  captureSlot?: ArCaptureSlot;
  onToggleRealSensor: (enable: boolean) => void;
  onCaptureBearing?: (slot: 'A' | 'B' | 'proj', headingDeg: number, pitchDeg: number) => void;
  onPinTarget: (item: PinRequestPayload) => void;
  onClose: () => void;
}

export const ArRangefinderOverlay: React.FC<ArRangefinderOverlayProps> = ({
  dataset,
  playerLat,
  playerLon,
  playerAccuracy,
  compassHeading,
  pitchDeg,
  rollDeg,
  useRealSensor,
  lockedTarget,
  captureSlot = 'free',
  onToggleRealSensor,
  onCaptureBearing,
  onPinTarget,
  onClose
}) => {
  const [mode, setMode] = useState<ArRangeMode>(() => (captureSlot !== 'free' ? 'dem3d' : 'ground'));
  const [lastMeasureMode, setLastMeasureMode] = useState<'ground' | 'stadia'>('ground');
  const [cal, setCal] = useState<ArCalibration>(() => loadArCalibration());
  const [camActive, setCamActive] = useState<boolean>(true);
  const [camError, setCamError] = useState<string | null>(null);
  const [videoRotateDeg, setVideoRotateDeg] = useState<0 | 90 | -90>(0);
  const [statusToast, setStatusToast] = useState<string | null>(null);

  // Simulator test sliders (only shown when hardware sensor is off on PC/Web)
  const [simPitch, setSimPitch] = useState<number>(-14);
  const [simHeadingOffset, setSimHeadingOffset] = useState<number>(0);

  // Ground 2-Tap (Base -> Top) State
  const [lockedBaseDistM, setLockedBaseDistM] = useState<number | null>(null);
  const [lockedBasePitch, setLockedBasePitch] = useState<number | null>(null);
  const [lockedTopPitch, setLockedTopPitch] = useState<number | null>(null);

  // Stadiametric Caliper State
  const [stadiaObjH, setStadiaObjH] = useState<number>(1.7);
  const [stadiaBracketFrac, setStadiaBracketFrac] = useState<number>(0.36);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const flashMsg = useCallback((msg: string) => {
    setStatusToast(msg);
    window.setTimeout(() => {
      setStatusToast((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const updateCal = useCallback((patch: Partial<ArCalibration>) => {
    setCal((prev) => {
      const next = { ...prev, ...patch };
      saveArCalibration(next);
      return next;
    });
  }, []);

  // Camera lifecycle (requests landscape 16:9 HD environment stream)
  useEffect(() => {
    if (!camActive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const start = async () => {
      setCamError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCamError('Trình duyệt không hỗ trợ mở camera — vẫn đo được bằng cảm biến góc & DEM 3D.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          const vid = videoRef.current;
          vid.srcObject = stream;
          vid.onloadedmetadata = () => {
            // If running inside CSS synthetic-landscape on a portrait-locked OS, stream arrives portrait
            // (videoHeight > videoWidth) while stage is landscape -> auto-rotate -90° for upright horizon!
            const inSyntheticLandscape = Boolean(document.querySelector('.app-shell.synthetic-landscape'));
            if (inSyntheticLandscape && vid.videoHeight > vid.videoWidth) {
              setVideoRotateDeg(-90);
            }
          };
          await vid.play().catch(() => {});
        }
      } catch (err) {
        setCamError(
          `Không bật được camera (${err instanceof Error ? err.message : 'từ chối quyền'}). Dùng lưới ngắm cảm biến.`
        );
      }
    };
    start();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [camActive]);

  // Active Attitude (Real calibrated hardware or Simulator slider)
  const rawPitch = useRealSensor ? pitchDeg : simPitch;
  const effPitch = rawPitch - cal.pitchOffsetDeg;
  const effRoll = useRealSensor ? rollDeg : 0;
  const effHeading = (((useRealSensor ? compassHeading : compassHeading + simHeadingOffset) % 360) + 360) % 360;
  const normHeading = Math.round(effHeading) % 360;

  const playerEle = useMemo(
    () => Math.round(sampleDemElevation(dataset.dem, dataset.bounds, playerLat, playerLon)),
    [dataset, playerLat, playerLon]
  );

  // 1. Ground-Base Tilt Rangefinder
  const groundRange = useMemo(
    () => computeGroundTiltRangeM(cal.eyeHeightM, effPitch),
    [cal.eyeHeightM, effPitch]
  );

  const measuredObjectHeightM = useMemo(() => {
    if (lockedBaseDistM === null || lockedBasePitch === null) return null;
    const topDeg = lockedTopPitch ?? effPitch;
    const radTop = (Math.max(-85, Math.min(85, topDeg)) * Math.PI) / 180;
    const radBase = (Math.max(-85, Math.min(85, lockedBasePitch)) * Math.PI) / 180;
    return lockedBaseDistM * Math.abs(Math.tan(radTop) - Math.tan(radBase));
  }, [lockedBaseDistM, lockedBasePitch, lockedTopPitch, effPitch]);

  // 2. 3D DEM Terrain Ray-Marching Rangefinder (Copernicus GLO-30 256x256)
  const demRange = useMemo(
    () => raycastDemDistance(dataset, playerLat, playerLon, cal.eyeHeightM, effHeading, effPitch, 5000),
    [dataset, playerLat, playerLon, cal.eyeHeightM, effHeading, effPitch]
  );

  // 3. Stadiametric Optical Caliper Rangefinder
  const stadiaDistM = useMemo(
    () => computeStadiametricRangeM(stadiaObjH, stadiaBracketFrac, cal.vFovDeg),
    [stadiaObjH, stadiaBracketFrac, cal.vFovDeg]
  );

  // Live Floating AR Landmark Tags (visual proof of compass & pitch alignment against real peaks!)
  const arLandmarkTags = useMemo(() => {
    const hFov = cal.vFovDeg * 1.65; // approximate landscape horizontal FOV
    const list: { id: string; label: string; distText: string; xPct: number; yPct: number; isLocked: boolean }[] = [];
    const originEle = sampleDemElevation(dataset.dem, dataset.bounds, playerLat, playerLon) + cal.eyeHeightM;

    const addItem = (id: string, name: string, lat: number, lon: number, isLocked: boolean) => {
      const dist = haversineDistanceM(playerLat, playerLon, lat, lon);
      if (dist < 15 || dist > 8500) return;
      const brng = computeBearingDeg(playerLat, playerLon, lat, lon);
      const dAz = ((brng - effHeading + 540) % 360) - 180;
      if (Math.abs(dAz) > hFov * 0.52) return;
      const targetEle = sampleDemElevation(dataset.dem, dataset.bounds, lat, lon);
      const targetPitch = (Math.atan2(targetEle - originEle, dist) * 180) / Math.PI;
      const dPitch = targetPitch - effPitch;
      if (Math.abs(dPitch) > cal.vFovDeg * 0.65) return;

      const xPct = 50 + (dAz / hFov) * 100;
      const yPct = 50 - (dPitch / cal.vFovDeg) * 100;
      const shortName = name
        .replace(/\([^)]*\)/g, '')
        .replace(/Bãi Đáp Trực Thăng Đỉnh La Bàn/i, 'Đỉnh La Bàn')
        .trim()
        .slice(0, 20);
      list.push({ id, label: shortName, distText: formatDistance(dist), xPct, yPct, isLocked });
    };

    if (lockedTarget) {
      addItem(lockedTarget.id, `🎯 ${lockedTarget.name}`, lockedTarget.lat, lockedTarget.lon, true);
    }
    for (const poi of dataset.pois) {
      if (!KEY_AR_POI_IDS.has(poi.id)) continue;
      if (lockedTarget?.id === poi.id) continue;
      addItem(poi.id, poi.name, poi.lat, poi.lon, false);
    }
    return list.slice(0, 5);
  }, [dataset, playerLat, playerLon, effHeading, effPitch, cal.eyeHeightM, cal.vFovDeg, lockedTarget]);

  // Overall Live Accuracy Indicator Badge
  const accuracyBadge = useMemo(() => {
    const rollTilted = Math.abs(effRoll) > 6.5;
    if (!useRealSensor) {
      return { level: 'warn' as const, text: '🎛️ GIẢ LẬP (Bật Cảm Biến để đo thật)' };
    }
    if (rollTilted) {
      return { level: 'warn' as const, text: `⚠️ Máy nghiêng ${effRoll.toFixed(0)}° — giữ vạch ngang xanh` };
    }
    if (mode === 'ground') {
      if (!groundRange.valid) return { level: 'bad' as const, text: '🔴 Ngắm xuống chân vật' };
      const errTxt = `±${groundRange.errorAt1DegM < 1 ? groundRange.errorAt1DegM.toFixed(2) : groundRange.errorAt1DegM.toFixed(1)}m`;
      if (groundRange.confidence === 'high') return { level: 'ok' as const, text: `🟢 CHÍNH XÁC CAO (${errTxt})` };
      if (groundRange.confidence === 'medium') return { level: 'warn' as const, text: `🟡 KHÁ (${errTxt})` };
      return { level: 'bad' as const, text: `🔴 Góc quá nông (${errTxt})` };
    }
    if (mode === 'dem3d') {
      if (!demRange.hit) return { level: 'warn' as const, text: '🟡 Hạ góc chạm sườn núi 3D' };
      const gpsTxt = playerAccuracy ? `GPS ±${Math.round(playerAccuracy)}m` : 'DEM 30m';
      return {
        level: playerAccuracy && playerAccuracy > 30 ? ('warn' as const) : ('ok' as const),
        text: `🟢 KHỚP DEM 3D (${gpsTxt})`
      };
    }
    if (mode === 'stadia') {
      return {
        level: cal.verifiedAt ? ('ok' as const) : ('warn' as const),
        text: cal.verifiedAt ? `🟢 vFOV ${cal.vFovDeg}° ĐÃ CHUẨN` : `🟡 vFOV ${cal.vFovDeg}° (Nên khớp 3m)`
      };
    }
    return {
      level: 'ok' as const,
      text: `Tare ${cal.pitchOffsetDeg >= 0 ? '+' : ''}${cal.pitchOffsetDeg.toFixed(1)}° • h=${cal.eyeHeightM.toFixed(2)}m`
    };
  }, [useRealSensor, effRoll, mode, groundRange, demRange, playerAccuracy, cal]);

  // Pin active measured point onto 3D map
  const handlePinCurrentMeasure = () => {
    if (mode === 'dem3d' && demRange.hit) {
      onPinTarget({
        lat: demRange.lat,
        lon: demRange.lon,
        label: `Tia AR ${formatDistance(demRange.horizDistM)} ∠${normHeading}°`,
        note: `Bắn tia AR lên DEM 3D: cự ly ngang ${Math.round(demRange.horizDistM)}m, cao ${demRange.targetEle}m (ΔH ${demRange.eleDiffM >= 0 ? '+' : ''}${demRange.eleDiffM}m)`
      });
      onClose();
      return;
    }

    const activeDist =
      mode === 'ground'
        ? lockedBaseDistM ?? (groundRange.valid ? groundRange.horizDistM : null)
        : mode === 'stadia'
          ? stadiaDistM
          : null;

    if (!activeDist || activeDist <= 0) {
      flashMsg('⚠️ Chưa có số đo hợp lệ để ghim!');
      return;
    }
    const dest = projectPointByBearing(playerLat, playerLon, normHeading, activeDist);
    const heightNote =
      mode === 'ground' && measuredObjectHeightM !== null ? `, cao H≈${measuredObjectHeightM.toFixed(1)}m` : '';
    onPinTarget({
      lat: dest.lat,
      lon: dest.lon,
      label: `AR ${formatDistance(activeDist)} ∠${normHeading}°`,
      note: `Đo AR (${mode === 'ground' ? 'Chân vật' : 'Khung vật'}): D=${activeDist.toFixed(1)}m${heightNote}, hướng ${normHeading}°`
    });
    onClose();
  };

  // 1-Tap Calibration against known real-world distance (e.g. 3.0m = 5 tiles of 60cm, or 5.0m)
  const handleQuickCalibrateKnownDist = (knownDistM: number) => {
    if (lastMeasureMode === 'stadia') {
      const nextFov = calibrateVerticalFovDeg(stadiaObjH, stadiaBracketFrac, knownDistM);
      updateCal({ vFovDeg: nextFov, verifiedAt: new Date().toLocaleTimeString('vi-VN') });
      flashMsg(`✅ Đã khớp ống kính vFOV = ${nextFov}° theo mốc ${knownDistM}m! Sai số giờ chỉ ~1–3%.`);
      setMode('stadia');
      return;
    }
    if (effPitch >= -1.0) {
      flashMsg('⚠️ Hãy chĩa tâm ngắm xuống chân tường cách đúng ' + knownDistM + 'm trước khi bấm Khớp!');
      return;
    }
    const solvedH = Number((knownDistM * Math.tan((Math.abs(effPitch) * Math.PI) / 180)).toFixed(2));
    if (solvedH < 0.4 || solvedH > 3.2) {
      flashMsg(`⚠️ Góc hiện tại (${effPitch.toFixed(1)}°) cho h=${solvedH}m bất thường — bấm "Về 0°" trước!`);
      return;
    }
    updateCal({ eyeHeightM: solvedH, verifiedAt: new Date().toLocaleTimeString('vi-VN') });
    flashMsg(`✅ Đã hiệu chuẩn h_cầm = ${solvedH.toFixed(2)}m theo mốc ${knownDistM}m thực tế!`);
    setMode('ground');
  };

  const isLevel = Math.abs(effRoll) <= 3.0;

  return (
    <div className="ar-fullscreen-overlay" role="dialog" aria-label="Camera AR Đo Khoảng Cách Nằm Ngang">
      {/* Full-bleed Camera Background */}
      <div className="ar-fs-video-stage">
        {camActive && (
          <video
            ref={videoRef}
            playsInline
            muted
            className={`ar-fs-video ${
              videoRotateDeg === 90 ? 'is-rot-90' : videoRotateDeg === -90 ? 'is-rot-neg90' : ''
            }`}
          />
        )}
        <div className="ar-fs-vignette" />
      </div>

      {/* TOP SLIM TELEMETRY BAR (Landscape) */}
      <header className="ar-fs-topbar">
        <div className="ar-fs-metrics">
          <span>
            HƯỚNG <strong>{formatBearingCardinal(normHeading)}</strong>
          </span>
          <span>
            GÓC <strong>{effPitch >= 0 ? `+${effPitch.toFixed(1)}°` : `${effPitch.toFixed(1)}°`}</strong>
          </span>
          <span className={isLevel ? 'ar-ok-txt' : 'ar-warn-txt'}>
            CÂN <strong>{effRoll.toFixed(1)}°</strong>
          </span>
          <span className="ar-hide-sm">
            CAO <strong>{playerEle}m</strong>
          </span>
        </div>

        <div className={`ar-fs-acc-pill level-${accuracyBadge.level}`}>{accuracyBadge.text}</div>

        <div className="ar-fs-top-actions">
          <button
            type="button"
            className="ar-mini-btn"
            onClick={() => setVideoRotateDeg((r) => (r === 0 ? 90 : r === 90 ? -90 : 0))}
            title="Xoay khung video nếu máy khóa xoay bị lệch 90°"
          >
            🔄 {videoRotateDeg === 0 ? '0°' : `${videoRotateDeg}°`}
          </button>
          <button type="button" className="ar-close-btn" onClick={onClose}>
            ✕ Đóng
          </button>
        </div>
      </header>

      {/* MAIN 3-COLUMN LANDSCAPE COCKPIT (Left Modes | Open Center Optics | Right Actions) */}
      <div className="ar-fs-body">
        {/* LEFT THUMB RAIL: Mode Switcher */}
        <aside className="ar-fs-left-rail">
          <button
            type="button"
            className={`ar-mode-btn ${mode === 'ground' ? 'active' : ''}`}
            onClick={() => {
              setMode('ground');
              setLastMeasureMode('ground');
            }}
          >
            <strong>🎯 Chân Vật</strong>
            <small>2–40m • +Đo cao</small>
          </button>
          <button
            type="button"
            className={`ar-mode-btn ${mode === 'dem3d' ? 'active' : ''}`}
            onClick={() => setMode('dem3d')}
          >
            <strong>⛰️ Địa Hình 3D</strong>
            <small>50m–5km Núi Dinh</small>
          </button>
          <button
            type="button"
            className={`ar-mode-btn ${mode === 'stadia' ? 'active' : ''}`}
            onClick={() => {
              setMode('stadia');
              setLastMeasureMode('stadia');
            }}
          >
            <strong>📏 Khung Vật</strong>
            <small>So vật chuẩn</small>
          </button>
          <button
            type="button"
            className={`ar-mode-btn ${mode === 'calibrate' ? 'active' : ''}`}
            onClick={() => setMode('calibrate')}
          >
            <strong>🔧 Kiểm Chuẩn</strong>
            <small>Tare &amp; Test 3m</small>
          </button>
        </aside>

        {/* CENTER OPEN OPTICS VIEWPORT */}
        <main className="ar-fs-center">
          {camError && <div className="ar-fs-toast is-err">{camError}</div>}
          {statusToast && <div className="ar-fs-toast">{statusToast}</div>}

          {/* Real-Time AR Landmark Tags (Proof of Compass & Pitch Accuracy on Nui Dinh!) */}
          {arLandmarkTags.map((tag) => (
            <div
              key={tag.id}
              className={`ar-poi-tag ${tag.isLocked ? 'is-locked' : ''}`}
              style={{ left: `${tag.xPct}%`, top: `${tag.yPct}%` }}
            >
              <span>{tag.label}</span>
              <strong>{tag.distText}</strong>
            </div>
          ))}

          {/* Artificial Horizon + Level Bar + Center Crosshair */}
          <svg viewBox="0 0 400 220" className="ar-fs-reticle" aria-hidden="true">
            {/* Rotating Horizon Line */}
            <g
              transform={`translate(200, ${110 + Math.max(-72, Math.min(72, effPitch * 2.2))}) rotate(${-effRoll})`}
            >
              <line
                x1="-145"
                y1="0"
                x2="-36"
                y2="0"
                stroke={isLevel ? '#4ade80' : '#fbbf24'}
                strokeWidth="1.6"
                strokeOpacity="0.82"
              />
              <line
                x1="36"
                y1="0"
                x2="145"
                y2="0"
                stroke={isLevel ? '#4ade80' : '#fbbf24'}
                strokeWidth="1.6"
                strokeOpacity="0.82"
              />
              <text x="-142" y="-5" fill={isLevel ? '#4ade80' : '#fbbf24'} fontSize="8.5" fontWeight="bold">
                0° CHÂN TRỜI
              </text>
            </g>

            {/* Stadiametric Top/Bottom Caliper Brackets (Mode: Khung Vật — exact 110 = 50% of 220 viewBox height) */}
            {mode === 'stadia' && (
              <g>
                <line
                  x1="120"
                  y1={110 - stadiaBracketFrac * 110}
                  x2="280"
                  y2={110 - stadiaBracketFrac * 110}
                  stroke="#38bdf8"
                  strokeWidth="2.2"
                />
                <line
                  x1="120"
                  y1={110 + stadiaBracketFrac * 110}
                  x2="280"
                  y2={110 + stadiaBracketFrac * 110}
                  stroke="#38bdf8"
                  strokeWidth="2.2"
                />
                <line
                  x1="120"
                  y1={110 - stadiaBracketFrac * 110}
                  x2="120"
                  y2={110 + stadiaBracketFrac * 110}
                  stroke="rgba(56, 189, 248, 0.45)"
                  strokeDasharray="4,4"
                />
                <line
                  x1="280"
                  y1={110 - stadiaBracketFrac * 110}
                  x2="280"
                  y2={110 + stadiaBracketFrac * 110}
                  stroke="rgba(56, 189, 248, 0.45)"
                  strokeDasharray="4,4"
                />
              </g>
            )}

            {/* Fixed Center Crosshair */}
            <circle cx="200" cy="110" r="18" fill="none" stroke="rgba(255, 214, 10, 0.9)" strokeWidth="1.5" />
            <line x1="200" y1="78" x2="200" y2="100" stroke="#f8fafc" strokeWidth="1.6" />
            <line x1="200" y1="120" x2="200" y2="142" stroke="#f8fafc" strokeWidth="1.6" />
            <line x1="168" y1="110" x2="190" y2="110" stroke="#f8fafc" strokeWidth="1.6" />
            <line x1="210" y1="110" x2="232" y2="110" stroke="#f8fafc" strokeWidth="1.6" />
            <circle cx="200" cy="110" r="2.4" fill="#ffd60a" />
          </svg>

          {/* BIG CENTER DISTANCE READOUT PILL */}
          {mode !== 'calibrate' && (
            <div className="ar-fs-readout-pill">
              {mode === 'ground' && (
                <>
                  {lockedBaseDistM !== null ? (
                    <div className="ar-readout-main">
                      <span>
                        Cự ly D = <strong>{formatDistance(lockedBaseDistM)}</strong>
                      </span>
                      <span className="ar-readout-sep">•</span>
                      <span>
                        Chiều cao H ≈{' '}
                        <strong>
                          {measuredObjectHeightM !== null ? `${measuredObjectHeightM.toFixed(2)} m` : '--'}
                        </strong>
                      </span>
                    </div>
                  ) : groundRange.valid ? (
                    <div className="ar-readout-main">
                      <span>
                        Khoảng cách D ≈ <strong>{formatDistance(groundRange.horizDistM)}</strong>
                      </span>
                      <span className="ar-readout-err">
                        (±
                        {groundRange.errorAt1DegM < 1
                          ? groundRange.errorAt1DegM.toFixed(2)
                          : groundRange.errorAt1DegM.toFixed(1)}
                        m)
                      </span>
                    </div>
                  ) : (
                    <div className="ar-readout-hint">{groundRange.reason}</div>
                  )}
                  <div className="ar-readout-sub">
                    {lockedBaseDistM !== null
                      ? 'Đã khóa chân vật — nâng tâm ngắm lên ĐỈNH vật để đọc chiều cao H'
                      : `Chiều cao cầm máy h = ${cal.eyeHeightM.toFixed(2)}m • Đặt dấu + đúng CHÂN vật trên đất`}
                  </div>
                </>
              )}

              {mode === 'dem3d' && (
                <>
                  {demRange.hit ? (
                    <>
                      <div className="ar-readout-main">
                        <span>
                          Tia DEM 3D: <strong>{formatDistance(demRange.horizDistM)}</strong>
                        </span>
                        <span className="ar-readout-sep">•</span>
                        <span>
                          Cao <strong>{demRange.targetEle}m</strong> (
                          {demRange.eleDiffM >= 0 ? `+${demRange.eleDiffM}m` : `${demRange.eleDiffM}m`})
                        </span>
                      </div>
                      <div className="ar-readout-sub">
                        Tọa độ tia chạm núi: {demRange.lat.toFixed(5)}, {demRange.lon.toFixed(5)} • Đường chim bay{' '}
                        {formatDistance(demRange.slantDistM)}
                      </div>
                    </>
                  ) : (
                    <div className="ar-readout-hint">{demRange.reason}</div>
                  )}
                </>
              )}

              {mode === 'stadia' && (
                <>
                  <div className="ar-readout-main">
                    <span>
                      Khoảng cách D ≈ <strong>{formatDistance(stadiaDistM)}</strong>
                    </span>
                    <span className="ar-readout-sep">•</span>
                    <span>
                      Vật chuẩn <strong>{stadiaObjH}m</strong>
                    </span>
                  </div>
                  <div className="ar-readout-sub">
                    Kéo thanh bên phải cho 2 vạch xanh kẹp khít từ chân tới đỉnh vật (vFOV {cal.vFovDeg}°)
                  </div>
                </>
              )}
            </div>
          )}

          {/* Calibration Guide Docked at BOTTOM so the center crosshair (+) stays 100% open while aiming! */}
          {mode === 'calibrate' && (
            <div className="ar-cal-center-card">
              <div className="ar-cal-head-row">
                <strong>🔍 Kiểm chứng &amp; hiệu chuẩn 10 giây</strong>
                <span className="ar-cal-live-pill">
                  Đo thử:{' '}
                  <b>
                    {lastMeasureMode === 'stadia'
                      ? formatDistance(stadiaDistM)
                      : groundRange.valid
                        ? formatDistance(groundRange.horizDistM)
                        : 'Nghiêng xuống chân tường'}
                  </b>
                </span>
              </div>
              <ol>
                <li>
                  <b>Tare 0°:</b> Dựng thẳng máy nhìn ngang chân trời → bấm <b>🎯 Về 0°</b> bên phải.
                </li>
                <li>
                  <b>Test 3m / 5m tại nhà:</b> Đếm <b>5 viên gạch 60cm = 3.0m</b>, chĩa <code>+</code> vào chân tường → bấm{' '}
                  <b>✅ Khớp 3.0m</b> (hoặc <b>5.0m</b>).
                </li>
                <li>
                  <b>Khớp thực địa Núi Dinh:</b> Chĩa về <b>Đỉnh La Bàn / Bao Quan</b> xem nhãn AR có trùng đỉnh núi thật không.
                </li>
              </ol>
              <div className="ar-cal-summary">
                Tare <strong>{cal.pitchOffsetDeg >= 0 ? '+' : ''}{cal.pitchOffsetDeg.toFixed(1)}°</strong> • h_cầm{' '}
                <strong>{cal.eyeHeightM.toFixed(2)}m</strong> • vFOV <strong>{cal.vFovDeg}°</strong>
                {cal.verifiedAt ? ` • Đã khớp ${cal.verifiedAt}` : ''}
              </div>
            </div>
          )}

          {/* Simulator Sliders ONLY when hardware sensor is OFF (for PC/Web testing) */}
          {!useRealSensor && mode !== 'calibrate' && (
            <div className="ar-sim-strip">
              <label>
                Góc ngắm: <b>{simPitch}°</b>
                <input
                  type="range"
                  min={-45}
                  max={35}
                  step={0.5}
                  value={simPitch}
                  onChange={(e) => setSimPitch(Number(e.target.value))}
                />
              </label>
              <label>
                Xoay hướng: <b>{normHeading}°</b>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={simHeadingOffset}
                  onChange={(e) => setSimHeadingOffset(Number(e.target.value))}
                />
              </label>
            </div>
          )}
        </main>

        {/* RIGHT THUMB RAIL: Contextual 1-Tap Actions */}
        <aside className="ar-fs-right-rail">
          {mode === 'ground' && (
            <>
              <button
                type="button"
                className="ar-act-btn primary"
                disabled={!groundRange.valid && lockedBaseDistM === null}
                onClick={() => {
                  if (groundRange.valid) {
                    setLockedBaseDistM(groundRange.horizDistM);
                    setLockedBasePitch(effPitch);
                    setLockedTopPitch(null);
                    flashMsg(`📌 Đã khóa khoảng cách D = ${formatDistance(groundRange.horizDistM)}! Giờ ngẩng lên đỉnh để đo cao H.`);
                  }
                }}
              >
                📌 Chốt Chân (D)
              </button>
              <button
                type="button"
                className="ar-act-btn"
                disabled={lockedBaseDistM === null}
                onClick={() => {
                  setLockedTopPitch(effPitch);
                  flashMsg(`✅ Đã chốt chiều cao H ≈ ${measuredObjectHeightM?.toFixed(2)}m!`);
                }}
              >
                🌲 Chốt Đỉnh (H)
              </button>
              {lockedBaseDistM !== null && (
                <button
                  type="button"
                  className="ar-act-btn"
                  onClick={() => {
                    setLockedBaseDistM(null);
                    setLockedBasePitch(null);
                    setLockedTopPitch(null);
                  }}
                >
                  ↺ Đo vật mới
                </button>
              )}
              <button type="button" className="ar-act-btn accent" onClick={handlePinCurrentMeasure}>
                🎯 Ghim Lên 3D
              </button>
            </>
          )}

          {mode === 'dem3d' && (
            <>
              <button
                type="button"
                className="ar-act-btn primary"
                disabled={!demRange.hit}
                onClick={handlePinCurrentMeasure}
              >
                🎯 Ghim Điểm Tia
              </button>
              {onCaptureBearing && (
                <>
                  {captureSlot === 'proj' ? (
                    <button
                      type="button"
                      className="ar-act-btn accent"
                      onClick={() => {
                        onCaptureBearing('proj', normHeading, effPitch);
                        onClose();
                      }}
                    >
                      📌 Chốt Hướng {normHeading}°
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`ar-act-btn ${captureSlot === 'A' ? 'accent' : ''}`}
                        onClick={() => {
                          onCaptureBearing('A', normHeading, effPitch);
                          onClose();
                        }}
                      >
                        📌 Chốt Tia A ({normHeading}°)
                      </button>
                      <button
                        type="button"
                        className={`ar-act-btn ${captureSlot === 'B' ? 'accent' : ''}`}
                        onClick={() => {
                          onCaptureBearing('B', normHeading, effPitch);
                          onClose();
                        }}
                      >
                        📌 Chốt Tia B ({normHeading}°)
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {mode === 'stadia' && (
            <>
              <div className="ar-stadia-presets">
                {STADIA_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={stadiaObjH === p.h ? 'active' : ''}
                    onClick={() => setStadiaObjH(p.h)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="ar-stadia-slider-box">
                <span>Độ mở khung ({Math.round(stadiaBracketFrac * 100)}%)</span>
                <input
                  type="range"
                  min={0.08}
                  max={0.86}
                  step={0.01}
                  value={stadiaBracketFrac}
                  onChange={(e) => setStadiaBracketFrac(Number(e.target.value))}
                />
              </div>
              <button type="button" className="ar-act-btn primary" onClick={handlePinCurrentMeasure}>
                🎯 Ghim Lên 3D
              </button>
            </>
          )}

          {mode === 'calibrate' && (
            <>
              <button
                type="button"
                className="ar-act-btn primary"
                onClick={() => {
                  updateCal({ pitchOffsetDeg: Number(rawPitch.toFixed(2)) });
                  flashMsg(`🎯 Đã đặt góc ngang hiện tại (${rawPitch.toFixed(1)}°) làm mốc 0.0°!`);
                }}
              >
                🎯 Về 0° (Tare)
              </button>
              <div className="ar-stepper-row">
                <button
                  type="button"
                  onClick={() => updateCal({ eyeHeightM: Math.max(0.6, Number((cal.eyeHeightM - 0.05).toFixed(2))) })}
                >
                  −
                </button>
                <span>h={cal.eyeHeightM.toFixed(2)}m</span>
                <button
                  type="button"
                  onClick={() => updateCal({ eyeHeightM: Math.min(2.5, Number((cal.eyeHeightM + 0.05).toFixed(2))) })}
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className="ar-act-btn accent"
                onClick={() => handleQuickCalibrateKnownDist(3.0)}
              >
                ✅ Khớp 3.0m
              </button>
              <button
                type="button"
                className="ar-act-btn"
                onClick={() => handleQuickCalibrateKnownDist(5.0)}
              >
                ✅ Khớp 5.0m
              </button>
              <button
                type="button"
                className="ar-act-btn"
                onClick={() => {
                  const def = { pitchOffsetDeg: 0, eyeHeightM: 1.6, vFovDeg: 46 };
                  setCal(def);
                  saveArCalibration(def);
                  flashMsg('↺ Đã khôi phục thông số hiệu chuẩn mặc định');
                }}
              >
                ↺ Mặc định
              </button>
            </>
          )}

          {/* Persistent Bottom-Right Hardware Quick Toggles */}
          <div className="ar-fs-hw-row">
            <button
              type="button"
              className={camActive ? 'active' : ''}
              onClick={() => setCamActive((v) => !v)}
            >
              📷 {camActive ? 'Tắt' : 'Bật'}
            </button>
            <button
              type="button"
              className={useRealSensor ? 'active' : ''}
              onClick={() => onToggleRealSensor(!useRealSensor)}
            >
              🧭 {useRealSensor ? 'Thật' : 'Test'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
