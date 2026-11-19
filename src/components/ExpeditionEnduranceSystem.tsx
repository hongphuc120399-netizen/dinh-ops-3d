import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NuiDinhDataset } from '../types';
import { formatDistance, haversineDistanceM } from '../utils/geoMath';

export type ClimbIntensity = 'normal' | 'steep' | 'hot';

export interface IntensityProfile {
  id: ClimbIntensity;
  label: string;
  shortLabel: string;
  waterEveryMin: number;
  sipMl: number;
  restEveryMin: number;
  restDurationSec: number;
  desc: string;
}

export const INTENSITY_PROFILES: Record<ClimbIntensity, IntensityProfile> = {
  normal: {
    id: 'normal',
    label: '🌿 Vừa phải',
    shortLabel: 'Vừa',
    waterEveryMin: 20,
    sipMl: 150,
    restEveryMin: 40,
    restDurationSec: 180, // 3:00
    desc: 'Trời mát / đường thoải • Nước mỗi 20p • Nghỉ 3:00 mỗi 40p'
  },
  steep: {
    id: 'steep',
    label: '⛰️ Dốc Núi Dinh',
    shortLabel: 'Núi Dinh',
    waterEveryMin: 15,
    sipMl: 150,
    restEveryMin: 35,
    restDurationSec: 210, // 3:30
    desc: 'Chuẩn leo dốc Thứ 7 • Nước mỗi 15p • Nghỉ 3:30 mỗi 35p'
  },
  hot: {
    id: 'hot',
    label: '🔥 Nắng gắt / Dốc đứng',
    shortLabel: 'Gắt',
    waterEveryMin: 12,
    sipMl: 180,
    restEveryMin: 25,
    restDurationSec: 240, // 4:00
    desc: 'Nắng trưa / dốc >25° • Nước+điện giải mỗi 12p • Nghỉ 4:00 mỗi 25p'
  }
};

export interface MissionSessionState {
  active: boolean;
  startedAtMs: number;
  intensity: ClimbIntensity;
  waterTotalMl: number;
  waterDrunkMl: number;
  waterSipsCount: number;
  nextWaterAtMs: number;
  nextRestAtMs: number;
  restEndAtMs: number | null;
  restDurationSec: number;
  restReadyNotice: boolean;
  restCount: number;
  totalRestSec: number;
  lastEleM: number | null;
  accumulatedGainM: number;
  soundEnabled: boolean;
}

export const MISSION_STORAGE_KEY = 'dinh_mission_session_v1';

// Verified safe water & resupply stops on Nui Dinh (strictly excluding quarry hazards!)
const SAFE_WATER_STOP_IDS = new Set([
  'verified-quan-co-kieu',
  'verified-ong-rung-camping',
  'verified-suoi-da-thac-ha',
  'zone-suoi-tien-upper',
  'verified-ho-ben-suoi',
  'osm-node-5537927361',
  'osm-node-5537927362'
]);

export function createInitialMissionState(
  intensity: ClimbIntensity,
  waterTotalMl: number,
  currentEleM: number,
  nowMs = Date.now()
): MissionSessionState {
  const prof = INTENSITY_PROFILES[intensity];
  return {
    active: true,
    startedAtMs: nowMs,
    intensity,
    waterTotalMl,
    waterDrunkMl: 0,
    waterSipsCount: 0,
    nextWaterAtMs: nowMs + prof.waterEveryMin * 60_000,
    nextRestAtMs: nowMs + prof.restEveryMin * 60_000,
    restEndAtMs: null,
    restDurationSec: prof.restDurationSec,
    restReadyNotice: false,
    restCount: 0,
    totalRestSec: 0,
    lastEleM: currentEleM,
    accumulatedGainM: 0,
    soundEnabled: true
  };
}

export function loadSavedMissionState(): MissionSessionState | null {
  try {
    const raw = localStorage.getItem(MISSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MissionSessionState>;
    if (!parsed || parsed.active !== true || !Number.isFinite(parsed.startedAtMs)) return null;
    const intensity: ClimbIntensity =
      parsed.intensity && parsed.intensity in INTENSITY_PROFILES ? parsed.intensity : 'steep';
    const prof = INTENSITY_PROFILES[intensity];
    const now = Date.now();
    return {
      active: true,
      startedAtMs: Number(parsed.startedAtMs),
      intensity,
      waterTotalMl: Number.isFinite(parsed.waterTotalMl) ? Number(parsed.waterTotalMl) : 2000,
      waterDrunkMl: Number.isFinite(parsed.waterDrunkMl) ? Number(parsed.waterDrunkMl) : 0,
      waterSipsCount: Number.isFinite(parsed.waterSipsCount) ? Number(parsed.waterSipsCount) : 0,
      nextWaterAtMs: Number.isFinite(parsed.nextWaterAtMs)
        ? Number(parsed.nextWaterAtMs)
        : now + prof.waterEveryMin * 60_000,
      nextRestAtMs: Number.isFinite(parsed.nextRestAtMs)
        ? Number(parsed.nextRestAtMs)
        : now + prof.restEveryMin * 60_000,
      restEndAtMs: typeof parsed.restEndAtMs === 'number' && Number.isFinite(parsed.restEndAtMs)
        ? parsed.restEndAtMs
        : null,
      restDurationSec: Number.isFinite(parsed.restDurationSec) ? Number(parsed.restDurationSec) : prof.restDurationSec,
      restReadyNotice: Boolean(parsed.restReadyNotice),
      restCount: Number.isFinite(parsed.restCount) ? Number(parsed.restCount) : 0,
      totalRestSec: Number.isFinite(parsed.totalRestSec) ? Number(parsed.totalRestSec) : 0,
      lastEleM: typeof parsed.lastEleM === 'number' ? parsed.lastEleM : null,
      accumulatedGainM: Number.isFinite(parsed.accumulatedGainM) ? Number(parsed.accumulatedGainM) : 0,
      soundEnabled: parsed.soundEnabled !== false
    };
  } catch {
    return null;
  }
}

export function saveMissionState(state: MissionSessionState | null): void {
  try {
    if (!state || !state.active) {
      localStorage.removeItem(MISSION_STORAGE_KEY);
    } else {
      localStorage.setItem(MISSION_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * Pure offline WebAudio chime generator (zero audio files needed!)
 */
function playTacticalChime(kind: 'water' | 'rest-due' | 'rest-done'): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes =
      kind === 'water'
        ? [660, 880]
        : kind === 'rest-due'
          ? [523.25, 659.25, 523.25]
          : [587.33, 783.99, 1046.5];

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'rest-done' ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.0001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.22);
    });
    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 900);
  } catch {
    // ignore WebAudio restrictions
  }
}

export function formatMmSs(totalSec: number): string {
  const s = Math.max(0, Math.ceil(totalSec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function formatHhMmSs(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Recommends exact recovery countdown duration (seconds) based on climb intensity & recent vertical gain
 * Sports physiology sweet spot: 2:00–5:00 clears calf lactate & drops HR to Zone 1–2 without letting muscles go cold!
 */
export function recommendRestDurationSec(intensity: ClimbIntensity, recentGainM: number): number {
  const base = INTENSITY_PROFILES[intensity].restDurationSec;
  if (recentGainM >= 180) return Math.min(300, base + 60);
  if (recentGainM >= 100) return Math.min(270, base + 30);
  return base;
}

export function getRecoveryPhaseTip(elapsedRestSec: number, remainingSec: number): string {
  if (remainingSec <= 45) {
    return '🦵 Sắp hết giờ nghỉ: Đứng dậy xoay cổ chân, giữ cơ ấm (không ngồi bệt lâu kẻo cứng giò), đeo lại balo!';
  }
  if (elapsedRestSec < 60) {
    return '🫁 Hạ nhịp tim: Hít sâu 4s — Giữ 2s — Thở ra chậm 6s. Thả lỏng vai & 2 tay cho nhịp tim về vùng bền.';
  }
  return '💧 Tiếp sức giữa nghỉ: Uống từng ngụm nhỏ 150–200ml nước/điện giải, lắc nhẹ bắp chân cho tan axit lactic.';
}

/* ============================================================================
   1. PRE-START MISSION LAUNCH MODAL ("▶ BẮT ĐẦU — ẨN TOÀN BỘ TEST ĐỂ LEO THẬT")
   ============================================================================ */
interface MissionStartModalProps {
  onConfirmStart: (intensity: ClimbIntensity, waterTotalMl: number, clearOldTrack: boolean) => void;
  onClose: () => void;
}

export const MissionStartModal: React.FC<MissionStartModalProps> = React.memo(
  ({ onConfirmStart, onClose }) => {
    const [intensity, setIntensity] = useState<ClimbIntensity>('steep');
    const [waterTotalMl, setWaterTotalMl] = useState<number>(2000);
    const [clearOldTrack, setClearOldTrack] = useState<boolean>(true);
    const prof = INTENSITY_PROFILES[intensity];

    return (
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="tactical-sheet mission-start-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-header">
            <div>
              <h3>🚀 Bắt Đầu Chuyến Leo Núi Dinh Thật</h3>
              <span className="mono-sub">
                Tự ẩn toàn bộ công cụ Test • Khóa GPS &amp; La bàn thật • Bật đồng hồ tiếp nước &amp; nghỉ phục hồi
              </span>
            </div>
            <button type="button" className="icon-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="mission-setup-section">
            <label className="mission-lbl">1. Chọn nhịp leo &amp; thời tiết hôm nay</label>
            <div className="mission-intensity-grid">
              {(Object.values(INTENSITY_PROFILES) as IntensityProfile[]).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`mission-int-card ${intensity === p.id ? 'active' : ''}`}
                  onClick={() => setIntensity(p.id)}
                >
                  <strong>{p.label}</strong>
                  <small>
                    💧 {p.waterEveryMin}p • ⏸️ {formatMmSs(p.restDurationSec)} / {p.restEveryMin}p
                  </small>
                </button>
              ))}
            </div>
            <div className="mission-prof-note">{prof.desc}</div>
          </div>

          <div className="mission-setup-section">
            <label className="mission-lbl">2. Lượng nước bạn mang theo trong balo</label>
            <div className="mission-water-chips">
              {[1500, 2000, 2500, 3000].map((ml) => (
                <button
                  key={ml}
                  type="button"
                  className={waterTotalMl === ml ? 'active' : ''}
                  onClick={() => setWaterTotalMl(ml)}
                >
                  {(ml / 1000).toFixed(1)} Lít
                </button>
              ))}
            </div>
          </div>

          <label className="mission-check-row">
            <input
              type="checkbox"
              checked={clearOldTrack}
              onChange={(e) => setClearOldTrack(e.target.checked)}
            />
            <span>Xóa vết chân test cũ để ghi chặng leo thật từ 0.0m (vẫn giữ nguyên các điểm đã Ghim)</span>
          </label>

          <button
            type="button"
            className="mission-launch-cta"
            onClick={() => onConfirmStart(intensity, waterTotalMl, clearOldTrack)}
          >
            ▶ BẮT ĐẦU LEO THẬT NGAY (ẨN CHẾ ĐỘ TEST)
          </button>
        </div>
      </div>
    );
  }
);

/* ============================================================================
   2. ISOLATED 1Hz LIVE ENDURANCE HUD + RECOVERY COUNTDOWN + DASHBOARD MODAL
      (Owns its own 1s timer so App & Terrain3DView NEVER re-render at 1Hz!)
   ============================================================================ */
interface ExpeditionHudProps {
  mission: MissionSessionState;
  dataset: NuiDinhDataset;
  playerLat: number;
  playerLon: number;
  playerEle: number;
  playerAccuracy: number | null;
  totalTrackDistanceM: number;
  zenMode: boolean;
  showDashboard: boolean;
  onUpdateMission: (updater: (prev: MissionSessionState) => MissionSessionState) => void;
  onToggleDashboard: (open: boolean) => void;
  onNavigateToWater: (lat: number, lon: number, ele: number, name: string) => void;
  onRefreshGps: () => void;
  onEndMission: () => void;
  onToast: (msg: string) => void;
}

export const ExpeditionEnduranceHud: React.FC<ExpeditionHudProps> = React.memo(
  ({
    mission,
    dataset,
    playerLat,
    playerLon,
    playerEle,
    playerAccuracy,
    totalTrackDistanceM,
    zenMode,
    showDashboard,
    onUpdateMission,
    onToggleDashboard,
    onNavigateToWater,
    onRefreshGps,
    onEndMission,
    onToast
  }) => {
    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    const [confirmEndStep, setConfirmEndStep] = useState<boolean>(false);

    // Track last fired alert deadlines so chimes/vibrations fire ONCE per cycle cleanly
    const alertedWaterAtRef = useRef<number>(0);
    const alertedRestAtRef = useRef<number>(0);
    const alertedRestDoneRef = useRef<number>(0);

    // Isolated 1Hz wall-clock heartbeat (ZERO parent re-renders!)
    useEffect(() => {
      const id = window.setInterval(() => {
        setNowMs(Date.now());
      }, 1000);
      return () => window.clearInterval(id);
    }, []);

    // Track real cumulative elevation gain (with >= 4m hysteresis to ignore GPS jitter)
    useEffect(() => {
      if (mission.lastEleM === null) {
        onUpdateMission((prev) => ({ ...prev, lastEleM: playerEle }));
        return;
      }
      const delta = playerEle - mission.lastEleM;
      if (delta >= 4) {
        onUpdateMission((prev) => ({
          ...prev,
          lastEleM: playerEle,
          accumulatedGainM: prev.accumulatedGainM + Math.round(delta)
        }));
      } else if (delta <= -6) {
        onUpdateMission((prev) => ({ ...prev, lastEleM: playerEle }));
      }
    }, [playerEle, mission.lastEleM, onUpdateMission]);

    const prof = INTENSITY_PROFILES[mission.intensity];
    const isResting = mission.restEndAtMs !== null;
    const elapsedClimbSec = Math.max(0, Math.floor((nowMs - mission.startedAtMs) / 1000));
    const waterRemainSec = Math.floor((mission.nextWaterAtMs - nowMs) / 1000);
    const restDueRemainSec = Math.floor((mission.nextRestAtMs - nowMs) / 1000);
    const restCountdownSec = isResting && mission.restEndAtMs !== null
      ? Math.max(0, Math.ceil((mission.restEndAtMs - nowMs) / 1000))
      : 0;
    const waterDue = !isResting && waterRemainSec <= 0;
    const restDue = !isResting && restDueRemainSec <= 0;

    // Trigger tactile vibration + offline WebAudio chime when deadlines hit 00:00
    useEffect(() => {
      if (waterDue && alertedWaterAtRef.current !== mission.nextWaterAtMs) {
        alertedWaterAtRef.current = mission.nextWaterAtMs;
        if (navigator.vibrate) navigator.vibrate([85, 70, 85]);
        if (mission.soundEnabled) playTacticalChime('water');
      }
    }, [waterDue, mission.nextWaterAtMs, mission.soundEnabled]);

    useEffect(() => {
      if (restDue && alertedRestAtRef.current !== mission.nextRestAtMs) {
        alertedRestAtRef.current = mission.nextRestAtMs;
        if (navigator.vibrate) navigator.vibrate([100, 70, 100, 70, 100]);
        if (mission.soundEnabled) playTacticalChime('rest-due');
      }
    }, [restDue, mission.nextRestAtMs, mission.soundEnabled]);

    // Auto-complete active recovery countdown when it hits 00:00 -> alert "Đủ độ bền tiếp tục đi!"
    useEffect(() => {
      if (
        isResting &&
        mission.restEndAtMs !== null &&
        nowMs >= mission.restEndAtMs &&
        alertedRestDoneRef.current !== mission.restEndAtMs
      ) {
        alertedRestDoneRef.current = mission.restEndAtMs;
        if (navigator.vibrate) navigator.vibrate([130, 70, 130, 70, 240]);
        if (mission.soundEnabled) playTacticalChime('rest-done');
        const nextNow = Date.now();
        onUpdateMission((prev) => ({
          ...prev,
          restEndAtMs: null,
          restReadyNotice: true,
          restCount: prev.restCount + 1,
          totalRestSec: prev.totalRestSec + prev.restDurationSec,
          nextRestAtMs: nextNow + INTENSITY_PROFILES[prev.intensity].restEveryMin * 60_000
        }));
      }
    }, [isResting, mission.restEndAtMs, mission.soundEnabled, nowMs, onUpdateMission]);

    // Nearest verified water / resupply point on Nui Dinh
    const nearestWaterStop = useMemo(() => {
      let best: { name: string; lat: number; lon: number; ele: number; distM: number } | null = null;
      for (const poi of dataset.pois) {
        if (!SAFE_WATER_STOP_IDS.has(poi.id)) continue;
        const d = haversineDistanceM(playerLat, playerLon, poi.lat, poi.lon);
        if (!best || d < best.distM) {
          best = { name: poi.name, lat: poi.lat, lon: poi.lon, ele: poi.ele, distM: d };
        }
      }
      return best;
    }, [dataset.pois, playerLat, playerLon]);

    const handleDrinkWater = useCallback(
      (ml?: number) => {
        const amount = ml ?? INTENSITY_PROFILES[mission.intensity].sipMl;
        const t = Date.now();
        if (navigator.vibrate) navigator.vibrate(20);
        onUpdateMission((prev) => ({
          ...prev,
          waterDrunkMl: prev.waterDrunkMl + amount,
          waterSipsCount: prev.waterSipsCount + 1,
          nextWaterAtMs: t + INTENSITY_PROFILES[prev.intensity].waterEveryMin * 60_000
        }));
        onToast(`💧 Đã ghi tiếp nước +${amount}ml • Lần tới sau ${INTENSITY_PROFILES[mission.intensity].waterEveryMin} phút`);
      },
      [mission.intensity, onUpdateMission, onToast]
    );

    const handleStartRest = useCallback(
      (customSec?: number) => {
        const dur = customSec ?? recommendRestDurationSec(mission.intensity, mission.accumulatedGainM);
        const t = Date.now();
        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        onUpdateMission((prev) => ({
          ...prev,
          restEndAtMs: t + dur * 1000,
          restDurationSec: dur,
          restReadyNotice: false
        }));
        onToggleDashboard(false);
        onToast(`⏸️ Bắt đầu đếm ngược nghỉ phục hồi ${formatMmSs(dur)} — giữ nhịp thở sâu!`);
      },
      [mission.intensity, mission.accumulatedGainM, onUpdateMission, onToggleDashboard, onToast]
    );

    const handleExtendRest = useCallback(
      (addSec: number) => {
        onUpdateMission((prev) => {
          if (!prev.restEndAtMs) return prev;
          return {
            ...prev,
            restEndAtMs: prev.restEndAtMs + addSec * 1000,
            restDurationSec: prev.restDurationSec + addSec
          };
        });
      },
      [onUpdateMission]
    );

    const handleResumeEarly = useCallback(() => {
      const t = Date.now();
      if (navigator.vibrate) navigator.vibrate(25);
      onUpdateMission((prev) => {
        const remaining = prev.restEndAtMs ? Math.max(0, Math.round((prev.restEndAtMs - t) / 1000)) : 0;
        const actualRested = Math.max(0, prev.restDurationSec - remaining);
        return {
          ...prev,
          restEndAtMs: null,
          restReadyNotice: false,
          restCount: prev.restCount + (actualRested >= 20 ? 1 : 0),
          totalRestSec: prev.totalRestSec + actualRested,
          nextRestAtMs: t + INTENSITY_PROFILES[prev.intensity].restEveryMin * 60_000
        };
      });
      onToast('▶ Đã tiếp tục hành quân — đồng hồ nghỉ lượt mới đã chạy!');
    }, [onUpdateMission, onToast]);

    const handleSnoozeRest = useCallback(() => {
      const t = Date.now();
      onUpdateMission((prev) => ({
        ...prev,
        nextRestAtMs: t + 10 * 60_000
      }));
      onToast('⏱️ Đã dời nhắc nghỉ thêm 10 phút');
    }, [onUpdateMission, onToast]);

    const waterRemainingMl = Math.max(0, mission.waterTotalMl - mission.waterDrunkMl);
    const waterRemainPct = Math.max(0, Math.min(100, Math.round((waterRemainingMl / Math.max(1, mission.waterTotalMl)) * 100)));
    const restElapsedSec = Math.max(0, mission.restDurationSec - restCountdownSec);
    const restProgressPct =
      mission.restDurationSec > 0
        ? Math.min(100, Math.max(0, Math.round((restElapsedSec / mission.restDurationSec) * 100)))
        : 0;
    const recommendedSec = recommendRestDurationSec(mission.intensity, mission.accumulatedGainM);

    return (
      <>
        {/* 1. COMPACT FLOATING ENDURANCE MICRO-STRIP (Top-center under HUD — never blocks 3D view!) */}
        {!zenMode && !isResting && (
          <div className={`mission-live-strip ${waterDue ? 'is-water-due' : restDue ? 'is-rest-due' : ''}`}>
            <button
              type="button"
              className="mls-seg mls-elapsed"
              onClick={() => onToggleDashboard(true)}
              title="Mở bảng quản lý sức bền & tiếp nước"
            >
              <span className="mls-live-dot" />
              <strong>{formatHhMmSs(elapsedClimbSec)}</strong>
              <small>↗+{mission.accumulatedGainM}m</small>
            </button>

            <span className="mls-sep" />

            {waterDue ? (
              <button type="button" className="mls-action-pill is-water" onClick={() => handleDrinkWater()}>
                💧 UỐNG NGAY (+{prof.sipMl}ml)
              </button>
            ) : (
              <button
                type="button"
                className="mls-seg"
                onClick={() => handleDrinkWater()}
                title="Chạm để ghi đã uống nước & đặt lại đồng hồ tiếp nước"
              >
                <span>💧</span>
                <strong>{formatMmSs(waterRemainSec)}</strong>
                <small>{waterRemainPct}%</small>
              </button>
            )}

            <span className="mls-sep" />

            {restDue ? (
              <div className="mls-due-group">
                <button type="button" className="mls-action-pill is-rest" onClick={() => handleStartRest()}>
                  ⏸️ NGHỈ ({formatMmSs(recommendedSec)})
                </button>
                <button type="button" className="mls-mini-snooze" onClick={handleSnoozeRest} title="Đi thêm 10 phút nữa">
                  +10p
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="mls-seg"
                onClick={() => handleStartRest()}
                title="Chạm để bắt đầu đồng hồ đếm ngược nghỉ phục hồi ngay"
              >
                <span>⏸️</span>
                <strong>{formatMmSs(restDueRemainSec)}</strong>
              </button>
            )}
          </div>
        )}

        {/* 2. ACTIVE RECOVERY COUNTDOWN BANNER ("ĐỒNG HỒ ĐẾM NGƯỢC NGHỈ PHỤC HỒI") */}
        {isResting && (
          <div className="rest-countdown-card" role="status" aria-live="polite">
            <div className="rcc-top">
              <div className="rcc-title">
                <span>⏸️ ĐANG NGHỈ PHỤC HỒI ĐỘ BỀN</span>
                <small>
                  Mục tiêu {formatMmSs(mission.restDurationSec)} • Đã nghỉ {mission.restCount} lần
                </small>
              </div>
              <div className="rcc-timer">{formatMmSs(restCountdownSec)}</div>
            </div>

            <div className="rcc-progress-track">
              <div className="rcc-progress-fill" style={{ width: `${restProgressPct}%` }} />
            </div>

            <div className="rcc-tip">{getRecoveryPhaseTip(restElapsedSec, restCountdownSec)}</div>

            <div className="rcc-actions">
              <button type="button" className="rcc-btn water" onClick={() => handleDrinkWater()}>
                💧 Đã uống +{prof.sipMl}ml
              </button>
              <button type="button" className="rcc-btn" onClick={() => handleExtendRest(60)}>
                +1 phút
              </button>
              <button type="button" className="rcc-btn resume" onClick={handleResumeEarly}>
                ▶ Đủ sức • Đi tiếp
              </button>
            </div>
          </div>
        )}

        {/* 3. REST COMPLETE WAKE BANNER ("✅ ĐỦ ĐỘ BỀN — TIẾP TỤC HÀNH QUÂN!") */}
        {!isResting && mission.restReadyNotice && (
          <div className="rest-ready-banner">
            <div className="rrb-text">
              <strong>✅ HẾT GIỜ NGHỈ — ĐỦ ĐỘ BỀN TIẾP TỤC ĐI!</strong>
              <small>Nhịp tim đã ổn định &amp; cơ vẫn còn ấm — xuất phát ngay kẻo nguội cơ nhé!</small>
            </div>
            <button
              type="button"
              className="rrb-go-btn"
              onClick={() => onUpdateMission((prev) => ({ ...prev, restReadyNotice: false }))}
            >
              ▶ LÊN ĐƯỜNG
            </button>
          </div>
        )}

        {/* 4. FULL ENDURANCE & HYDRATION DASHBOARD SHEET (Portaled to .app-shell for full z-index & opacity) */}
        {showDashboard &&
          createPortal(
            <div
              className="sheet-backdrop"
              onClick={() => {
                setConfirmEndStep(false);
                onToggleDashboard(false);
              }}
            >
              <div className="tactical-sheet mission-dash-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="sheet-header">
                <div>
                  <h3>💧 Sức Bền &amp; Hành Quân Thực Địa</h3>
                  <span className="mono-sub">
                    Đang chạy chế độ Leo Thật (GPS {playerAccuracy !== null ? `±${Math.round(playerAccuracy)}m` : '--'})
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-close-btn"
                  onClick={() => {
                    setConfirmEndStep(false);
                    onToggleDashboard(false);
                  }}
                >
                  ✕
                </button>
              </div>

              {/* 4 Key Live Climb KPIs */}
              <div className="mission-kpi-grid">
                <div className="mission-kpi">
                  <span>Thời gian leo</span>
                  <strong>{formatHhMmSs(elapsedClimbSec)}</strong>
                </div>
                <div className="mission-kpi">
                  <span>Quãng đường</span>
                  <strong>{formatDistance(totalTrackDistanceM)}</strong>
                </div>
                <div className="mission-kpi">
                  <span>Cao độ / Đã leo</span>
                  <strong>
                    {playerEle}m <small>(↗+{mission.accumulatedGainM}m)</small>
                  </strong>
                </div>
                <div className="mission-kpi">
                  <span>Đã nghỉ phục hồi</span>
                  <strong>
                    {mission.restCount} lần <small>({Math.round(mission.totalRestSec / 60)}p)</small>
                  </strong>
                </div>
              </div>

              {/* Hydration Tank Card */}
              <div className="mission-card">
                <div className="mission-card-head">
                  <strong>
                    💧 Bình Nước Balo: Còn {waterRemainingMl} / {mission.waterTotalMl} ml ({waterRemainPct}%)
                  </strong>
                  <span className={`mission-pill ${waterDue ? 'is-due' : ''}`}>
                    {waterDue ? 'ĐẾN GIỜ UỐNG!' : `Tiếp sau ${formatMmSs(waterRemainSec)}`}
                  </span>
                </div>
                <div className="mission-water-bar">
                  <div
                    className={`mission-water-fill ${waterRemainPct <= 25 ? 'is-low' : ''}`}
                    style={{ width: `${waterRemainPct}%` }}
                  />
                </div>
                <div className="mission-btn-row">
                  <button type="button" className="primary-action-btn" onClick={() => handleDrinkWater(150)}>
                    💧 +150ml
                  </button>
                  <button type="button" className="secondary-action-btn" onClick={() => handleDrinkWater(250)}>
                    💧 +250ml
                  </button>
                  <button
                    type="button"
                    className="secondary-action-btn"
                    onClick={() => {
                      onUpdateMission((prev) => ({
                        ...prev,
                        waterDrunkMl: 0,
                        waterTotalMl: Math.max(prev.waterTotalMl, 2000)
                      }));
                      onToast('🔄 Đã nạp đầy bình nước 100%!');
                    }}
                  >
                    🔄 Đầy bình
                  </button>
                </div>
                {nearestWaterStop && (
                  <div className="mission-water-stop">
                    <span>
                      Điểm tiếp nước gần nhất: <b>{nearestWaterStop.name.replace(/^[^\p{L}\d]+/u, '')}</b> (
                      {formatDistance(nearestWaterStop.distM)})
                    </span>
                    <button
                      type="button"
                      className="ota-mini-link"
                      onClick={() => {
                        onToggleDashboard(false);
                        onNavigateToWater(
                          nearestWaterStop.lat,
                          nearestWaterStop.lon,
                          nearestWaterStop.ele,
                          nearestWaterStop.name
                        );
                      }}
                    >
                      🎯 Dẫn đường
                    </button>
                  </div>
                )}
              </div>

              {/* Manual Rest Countdown Launcher */}
              <div className="mission-card">
                <div className="mission-card-head">
                  <strong>⏸️ Đồng Hồ Đếm Ngược Nghỉ Phục Hồi</strong>
                  <span className={`mission-pill ${restDue ? 'is-due-amber' : ''}`}>
                    {isResting
                      ? `Đang nghỉ: ${formatMmSs(restCountdownSec)}`
                      : restDue
                        ? 'NÊN NGHỈ NGAY!'
                        : `Lượt tới: ${formatMmSs(restDueRemainSec)}`}
                  </span>
                </div>
                <div className="mission-rest-presets">
                  <button type="button" onClick={() => handleStartRest(120)}>
                    ⚡ 2:00<small>Thở nhanh</small>
                  </button>
                  <button
                    type="button"
                    className="recommended"
                    onClick={() => handleStartRest(recommendedSec)}
                  >
                    ⛰️ {formatMmSs(recommendedSec)}
                    <small>Khuyên dùng</small>
                  </button>
                  <button type="button" onClick={() => handleStartRest(300)}>
                    🔥 5:00<small>Dốc đứng</small>
                  </button>
                  <button type="button" onClick={() => handleStartRest(600)}>
                    🍱 10:00<small>Nghỉ trạm</small>
                  </button>
                </div>
              </div>

              {/* Live Profile Switch + Sound + GPS Reacquire */}
              <div className="mission-card">
                <div className="mission-card-head">
                  <strong>⚙️ Nhịp Hành Quân &amp; Vệ Tinh</strong>
                  <button
                    type="button"
                    className="ota-mini-link"
                    onClick={() => onUpdateMission((prev) => ({ ...prev, soundEnabled: !prev.soundEnabled }))}
                  >
                    {mission.soundEnabled ? '🔔 Chuông nhắc: BẬT' : '🔇 Chuông nhắc: TẮT'}
                  </button>
                </div>
                <div className="mission-water-chips">
                  {(Object.values(INTENSITY_PROFILES) as IntensityProfile[]).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={mission.intensity === p.id ? 'active' : ''}
                      onClick={() => {
                        const t = Date.now();
                        onUpdateMission((prev) => ({
                          ...prev,
                          intensity: p.id,
                          nextWaterAtMs: Math.min(prev.nextWaterAtMs, t + p.waterEveryMin * 60_000),
                          nextRestAtMs: Math.min(prev.nextRestAtMs, t + p.restEveryMin * 60_000)
                        }));
                        onToast(`Đã đổi nhịp sang ${p.label}`);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="mission-footer-actions">
                  <button
                    type="button"
                    className="secondary-action-btn"
                    onClick={() => {
                      onRefreshGps();
                      onToast('🛰️ Đang làm mới tín hiệu vệ tinh GNSS...');
                    }}
                  >
                    🔄 Bắt lại vệ tinh GNSS
                  </button>
                  {!confirmEndStep ? (
                    <button
                      type="button"
                      className="mission-end-btn"
                      onClick={() => setConfirmEndStep(true)}
                    >
                      ⏹️ Kết thúc chuyến leo
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="mission-end-btn is-confirm"
                      onClick={() => {
                        setConfirmEndStep(false);
                        onToggleDashboard(false);
                        onEndMission();
                      }}
                    >
                      ✅ Xác nhận kết thúc
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.querySelector('.app-shell') || document.body
        )}
      </>
    );
  }
);
