import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import rawDataset from './data/nuiDinhDataset.json';
import type {
  Camera3DMode,
  ImportedGpxTrack,
  Map2DStyle,
  NuiDinhDataset,
  SafetyAlert,
  TacticalPalette,
  TacticalRouteResult,
  TacticalTarget,
  Terrain3DSkin,
  TrackPoint,
  UserPin,
  ViewMode
} from './types';
import {
  computeBearingDeg,
  computeCameraAttitude,
  computeTacticalTrailRoute,
  evaluateSafetyAlerts,
  formatBearingCardinal,
  formatClockDirection,
  formatDistance,
  haversineDistanceM,
  minDistanceToPowerlinesM,
  sampleDemElevation,
  trimRouteFromPlayer
} from './utils/geoMath';
import {
  countCachedTiles,
  loadPersistedSession,
  vaultSet,
  type TacticalSessionBackup
} from './utils/offlineVault';
import {
  applyOtaBundle,
  checkGithubOtaUpdate,
  confirmOtaBootSuccess,
  getCurrentOtaRuntimeInfo,
  isRemoteNewer,
  loadOtaSettings,
  type AvailableOtaUpdate
} from './utils/otaUpdater';
import { APP_BUILD_INFO } from './version';
import { resolveRouteColor, Terrain3DView } from './components/Terrain3DView';
import { Hybrid2DMap } from './components/Hybrid2DMap';
import {
  PIN_CATEGORIES,
  PinsAndPoisSheet,
  PrecisionHomingOverlay,
  QuickPinModal,
  ReconToolkitModal
} from './components/TacticalPanels';
import {
  FloatingCompassWidget,
  LeftEdgeDirectionArrow,
  TacticalCompassModal,
  TacticalCompassTape
} from './components/CompassSystem';

const dataset = rawDataset as unknown as NuiDinhDataset;

function formatSpecOpsClock(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Gimbal-lock-free 3D W3C DeviceOrientation matrix (Z-X'-Y'' intrinsic) projected onto horizontal EN plane.
 * Keeps compass smooth across Portrait/Landscape tilts from 0° to 90°.
 */
function computeTiltCompensatedHeading(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number
): number {
  const degToRad = Math.PI / 180;
  const a = alphaDeg * degToRad;
  const b = betaDeg * degToRad;
  const g = gammaDeg * degToRad;
  const s = screenAngleDeg * degToRad;

  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);

  // Device forward vector blending screen-up (+X/+Y depending on orientation) and camera forward (-Z_dev)
  const vx = Math.sin(s);
  const vy = Math.cos(s);
  const vz = -1;

  const east = (ca * cg - sa * sb * sg) * vx + (-sa * cb) * vy + (ca * sg + sa * sb * cg) * vz;
  const north = (sa * cg + ca * sb * sg) * vx + (ca * cb) * vy + (sa * sg - ca * sb * cg) * vz;

  if (east * east + north * north < 1e-5) {
    return (((360 - alphaDeg + screenAngleDeg) % 360) + 360) % 360;
  }
  return (((Math.atan2(east, north) * 180) / Math.PI) % 360 + 360) % 360;
}

const PALETTE_ORDER: TacticalPalette[] = ['slate', 'olive', 'amber', 'vivid'];
const PALETTE_META: Record<TacticalPalette, { short: string; label: string }> = {
  slate: { short: 'XÁM', label: 'Xám Đặc Nhiệm (Ít màu)' },
  olive: { short: 'RÊU', label: 'Rêu Quân Sự' },
  amber: { short: 'ĐÊM', label: 'Đêm Hổ Phách' },
  vivid: { short: 'GỐC', label: 'Đa Sắc (4 Tuyến)' }
};

const SIM_PRESETS = [
  { id: 'hbs', label: '⛺ Hồ Bên Suối Dinh', lat: 10.51615, lon: 107.11735 },
  { id: 'suoida', label: '🌊 Suối Đá Thác Hạ', lat: 10.518913, lon: 107.119888 },
  { id: 'cokieu', label: '🥤 Quán Cô Kiều', lat: 10.509993, lon: 107.129453 },
  { id: 'hangto', label: '⛩️ Chùa Hang Tổ', lat: 10.531285, lon: 107.128697 },
  { id: 'ongrung', label: '🔀 Ngã 4 Trail • Ong Rừng', lat: 10.538299, lon: 107.14041 },
  { id: 'laban', label: '🚁 Đỉnh La Bàn (495m)', lat: 10.53875, lon: 107.12942 },
  { id: 'baoquan', label: '⛰️ Đỉnh Bao Quan (504m)', lat: 10.556903, lon: 107.132801 },
  { id: 'military', label: '⛔ Sát Trường Bắn (Test Báo Động)', lat: 10.5519, lon: 107.1012 }
];

const TacticalClock: React.FC<{ compact?: boolean }> = React.memo(({ compact = false }) => {
  const [text, setText] = useState<string>(() => formatSpecOpsClock());
  useEffect(() => {
    const timer = window.setInterval(() => setText(formatSpecOpsClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (compact) return <>{text.slice(0, 5)}</>;
  return (
    <span className="tactical-clock-chip" title="Đồng hồ tác chiến 24h">
      {text}
    </span>
  );
});

export const App: React.FC = () => {
  // View & Layer Controls
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [skin3D, setSkin3D] = useState<Terrain3DSkin>(() => {
    if (typeof window === 'undefined') return 'tactical';
    const saved = localStorage.getItem('dinh_3d_skin_v1') as Terrain3DSkin | null;
    return saved && ['tactical', 'topo', 'satellite', 'night'].includes(saved) ? saved : 'tactical';
  });
  const [cameraMode, setCameraMode] = useState<Camera3DMode>('orbit');
  const [verticalScale, setVerticalScale] = useState<number>(() => {
    if (typeof window === 'undefined') return 1.45;
    const saved = Number(localStorage.getItem('dinh_3d_vscale_v1'));
    return Number.isFinite(saved) && saved >= 0.8 && saved <= 2.5 ? saved : 1.45;
  });
  const [map2DStyle, setMap2DStyle] = useState<Map2DStyle>(() => {
    if (typeof window === 'undefined') return 'google-hybrid';
    const saved = localStorage.getItem('dinh_2d_style_v1') as Map2DStyle | null;
    return saved && ['google-hybrid', 'google-terrain', 'opentopo', 'offline-vector'].includes(saved)
      ? saved
      : 'google-hybrid';
  });
  const [headingUp, setHeadingUp] = useState<boolean>(false);
  const [tacticalTone2D, setTacticalTone2D] = useState<boolean>(true);
  const [palette, setPalette] = useState<TacticalPalette>(() => {
    if (typeof window === 'undefined') return 'slate';
    const saved = localStorage.getItem('dinh_tactical_palette_v1') as TacticalPalette | null;
    return saved && ['slate', 'olive', 'amber', 'vivid'].includes(saved) ? saved : 'slate';
  });
  const [showAllTrails, setShowAllTrails] = useState<boolean>(true);
  const [showPois, setShowPois] = useState<boolean>(true);
  const [visibleRoutes, setVisibleRoutes] = useState<Record<string, boolean>>({
    red: true,
    yellow: true,
    blue: true,
    green: true
  });
  const [showLayerPopover, setShowLayerPopover] = useState(false);

  // GPS & Sensor State
  const [isSimMode, setIsSimMode] = useState<boolean>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('dinh_gps_real_mode_v1') !== '1' : true
  );
  const [simAutoWalk, setSimAutoWalk] = useState<boolean>(false);
  const [simDrawerOpen, setSimDrawerOpen] = useState<boolean>(false);
  const [playerLat, setPlayerLat] = useState<number>(10.531285); // Start at Chua Hang To on Red Route!
  const [playerLon, setPlayerLon] = useState<number>(107.128697);
  const [playerAccuracy, setPlayerAccuracy] = useState<number | null>(3.5);
  const [compassHeading, setCompassHeading] = useState<number>(18);
  const [gpsCourse, setGpsCourse] = useState<number | null>(18);
  const [speedMps, setSpeedMps] = useState<number | null>(0);
  const [pitchDeg, setPitchDeg] = useState<number>(0);
  const [rollDeg, setRollDeg] = useState<number>(0);
  const [useRealCompassSensor, setUseRealCompassSensor] = useState<boolean>(false);
  const smoothHeadingRef = useRef<number>(18);
  if (!useRealCompassSensor && isSimMode) {
    smoothHeadingRef.current = compassHeading;
  }
  const [gpsStatusMsg, setGpsStatusMsg] = useState<string>('Chế độ Giả lập Thực địa');
  const [gpsFixCount, setGpsFixCount] = useState<number>(0);
  const [lastGpsFixTime, setLastGpsFixTime] = useState<number | null>(null);
  const [gpsPermState, setGpsPermState] = useState<'prompt' | 'granted' | 'denied' | 'unknown'>('unknown');
  const [gpsPrecisionNote, setGpsPrecisionNote] = useState<string | null>(null);
  const isSimModeRef = useRef<boolean>(isSimMode);
  isSimModeRef.current = isSimMode;
  const manualGpsRefreshRef = useRef<(() => void) | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // Tactical Data State (Persisted in IndexedDB!)
  const [userPins, setUserPins] = useState<UserPin[]>([]);
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [isRecordingTrack, setIsRecordingTrack] = useState<boolean>(true);
  const [importedGpx, setImportedGpx] = useState<ImportedGpxTrack[]>([]);
  const [lockedTarget, setLockedTarget] = useState<TacticalTarget | null>(null);
  const [lockedBearing, setLockedBearing] = useState<number | null>(null);
  const [activeRoute, setActiveRoute] = useState<TacticalRouteResult | null>(null);
  const [simRouteWalking, setSimRouteWalking] = useState<boolean>(false);
  const [cachedTileCount, setCachedTileCount] = useState<number>(0);
  const [vaultHydrated, setVaultHydrated] = useState<boolean>(false);

  // Modals & Popovers
  const [pendingPinCoords, setPendingPinCoords] = useState<{ lat: number; lon: number; ele: number } | null>(null);
  const [showPinsSheet, setShowPinsSheet] = useState<boolean>(false);
  const [showToolkitModal, setShowToolkitModal] = useState<boolean>(false);
  const [toolkitInitialTab, setToolkitInitialTab] = useState<
    'decode' | 'engineering' | 'bearing' | 'offline' | 'ota'
  >('decode');
  const [availableOta, setAvailableOta] = useState<AvailableOtaUpdate | null>(null);
  const [apkReleaseUrl, setApkReleaseUrl] = useState<string | null>(null);
  const [showPrecisionRadar, setShowPrecisionRadar] = useState<boolean>(false);
  const [showCompassModal, setShowCompassModal] = useState<boolean>(false);
  const [flyToTrigger, setFlyToTrigger] = useState<{
    lat: number;
    lon: number;
    zoom?: number;
    seq: number;
  } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Landscape Orientation Lock & Ultra-Compact HUD States
  const [zenMode, setZenMode] = useState<boolean>(false);
  const [forceLandscape, setForceLandscape] = useState<boolean>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('dinh_force_landscape_v1') !== '0' : true
  );
  const [isOsPortrait, setIsOsPortrait] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false
  );
  const syntheticLandscape = forceLandscape && isOsPortrait;
  const syntheticLandscapeRef = useRef<boolean>(syntheticLandscape);
  syntheticLandscapeRef.current = syntheticLandscape;
  const [dismissedPortraitHint, setDismissedPortraitHint] = useState<boolean>(false);
  const [dismissedQuickOta, setDismissedQuickOta] = useState<boolean>(false);
  const [dismissedApkNudge, setDismissedApkNudge] = useState<boolean>(false);
  const [nativeApkVer, setNativeApkVer] = useState<string | null>(null);
  const [quickOtaProgress, setQuickOtaProgress] = useState<number | null>(null);
  const [dismissedWarnTitle, setDismissedWarnTitle] = useState<string | null>(null);
  const [dismissedOutGpsHint, setDismissedOutGpsHint] = useState<boolean>(false);
  const [expandedSafety, setExpandedSafety] = useState<boolean>(false);
  const [isMapDragging, setIsMapDragging] = useState<boolean>(false);
  const [isHudIdle, setIsHudIdle] = useState<boolean>(false);
  const needAttitudeRef = useRef<boolean>(false);
  needAttitudeRef.current = showCompassModal || showToolkitModal;
  const liveAttitudeRef = useRef<{ pitch: number; roll: number }>({ pitch: 0, roll: 0 });

  const playerEle = useMemo(
    () => Math.round(sampleDemElevation(dataset.dem, dataset.bounds, playerLat, playerLon)),
    [playerLat, playerLon]
  );

  const triggerToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  const triggerFlyTo = useCallback((lat: number, lon: number, zoom?: number) => {
    setFlyToTrigger({ lat, lon, zoom, seq: Date.now() });
  }, []);

  const refreshTileCount = useCallback(() => {
    countCachedTiles().then(setCachedTileCount);
  }, []);

  // Landscape Lock & OS Orientation Synchronization
  useEffect(() => {
    type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
    const tryLockLandscape = () => {
      if (!forceLandscape) return;
      const orientation = window.screen?.orientation as LockableOrientation | undefined;
      orientation?.lock?.('landscape')?.catch(() => {});
    };

    const syncViewportState = () => {
      setIsOsPortrait(window.innerHeight > window.innerWidth);
    };

    syncViewportState();
    tryLockLandscape();

    const onFirstPointerDown = () => {
      tryLockLandscape();
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    };
    window.addEventListener('pointerdown', onFirstPointerDown, { once: true });
    window.addEventListener('resize', syncViewportState);
    window.addEventListener('orientationchange', syncViewportState);

    return () => {
      window.removeEventListener('pointerdown', onFirstPointerDown);
      window.removeEventListener('resize', syncViewportState);
      window.removeEventListener('orientationchange', syncViewportState);
    };
  }, [forceLandscape]);

  // Auto-Dim Idle HUD (clock isolated in TacticalClock so 1Hz tick never re-renders App!)
  useEffect(() => {
    let idleTimer: number | null = null;
    const resetIdle = () => {
      setIsHudIdle((prev) => (prev ? false : prev));
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setIsHudIdle(true), 6000);
    };
    resetIdle();
    window.addEventListener('pointerdown', resetIdle, { passive: true });

    return () => {
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      window.removeEventListener('pointerdown', resetIdle);
    };
  }, []);

  // Sync latest hardware attitude immediately when opening Compass or Toolkit/AR modal
  useEffect(() => {
    if (showCompassModal || showToolkitModal) {
      setPitchDeg(Number(liveAttitudeRef.current.pitch.toFixed(1)));
      setRollDeg(Number(liveAttitudeRef.current.roll.toFixed(1)));
    }
  }, [showCompassModal, showToolkitModal]);

  const handleSelectPalette = useCallback(
    (next: TacticalPalette) => {
      setPalette(next);
      try {
        localStorage.setItem('dinh_tactical_palette_v1', next);
      } catch {
        // ignore storage failures
      }
      triggerToast(`🎨 Tông màu: ${PALETTE_META[next].label}`);
    },
    [triggerToast]
  );

  const handleCyclePalette = useCallback(() => {
    const idx = PALETTE_ORDER.indexOf(palette);
    const next = PALETTE_ORDER[(idx + 1) % PALETTE_ORDER.length];
    handleSelectPalette(next);
  }, [palette, handleSelectPalette]);

  const handleToggleForceLandscape = useCallback(() => {
    type LockableOrientation = ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
      unlock?: () => void;
    };
    const next = !forceLandscape;
    setForceLandscape(next);
    try {
      localStorage.setItem('dinh_force_landscape_v1', next ? '1' : '0');
    } catch {
      // ignore storage failures
    }
    const orientation = window.screen?.orientation as LockableOrientation | undefined;
    if (next) {
      setDismissedPortraitHint(false);
      orientation?.lock?.('landscape')?.catch(() => {});
      triggerToast('↔️ Đã khóa giao diện Nằm Ngang mặc định');
    } else {
      orientation?.unlock?.();
      triggerToast('📱 Đã mở xoay theo chiều điện thoại');
    }
  }, [forceLandscape, triggerToast]);

  const handleQuickOtaApply = useCallback(async () => {
    if (!availableOta || quickOtaProgress !== null) return;
    setQuickOtaProgress(1);
    try {
      const res = await applyOtaBundle({
        bundleUrl: availableOta.bundleUrl,
        version: availableOta.version,
        note: availableOta.note,
        source: 'github',
        sha256: availableOta.sha256,
        onProgress: (pct) => setQuickOtaProgress(pct)
      });
      if (!res.appliedNative) {
        triggerToast(`✅ Đã tải v${availableOta.version}! Đang làm mới bản web...`);
        window.setTimeout(() => window.location.reload(), 600);
      }
    } catch (err) {
      setQuickOtaProgress(null);
      triggerToast(`⚠️ Lỗi OTA: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [availableOta, quickOtaProgress, triggerToast]);

  // 1. Confirm OTA watchdog ready, inspect native APK version & load Offline Session
  useEffect(() => {
    confirmOtaBootSuccess();
    getCurrentOtaRuntimeInfo()
      .then((info) => {
        if (info.isNative) {
          setNativeApkVer(info.nativeApkVersion);
        }
      })
      .catch(() => {});
    loadPersistedSession()
      .then(
        ({
          pins,
          track,
          gpxList,
          lockedTarget: savedTarget,
          lockedBearing: savedBearing,
          activeRoute: savedRoute
        }) => {
          if (pins.length > 0) setUserPins(pins);
          if (track.length > 0) setTrackPoints(track);
          if (gpxList.length > 0) setImportedGpx(gpxList);
          if (savedTarget) setLockedTarget(savedTarget);
          if (savedBearing !== null) setLockedBearing(savedBearing);
          if (savedRoute) setActiveRoute(savedRoute);
        }
      )
      .finally(() => {
        setVaultHydrated(true);
      });
    refreshTileCount();

    const onNetChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', onNetChange);
    window.addEventListener('offline', onNetChange);
    return () => {
      window.removeEventListener('online', onNetChange);
      window.removeEventListener('offline', onNetChange);
    };
  }, [refreshTileCount]);

  // Silent background GitHub OTA check when device is online
  useEffect(() => {
    if (!isOnline) return;
    const settings = loadOtaSettings();
    if (!settings.autoCheckGithub) return;
    let cancelled = false;
    checkGithubOtaUpdate()
      .then((res) => {
        if (cancelled) return;
        if (res.apkDownloadUrl) setApkReleaseUrl(res.apkDownloadUrl);
        if (res.otaUpdate && res.otaUpdate.isNewer) {
          setAvailableOta(res.otaUpdate);
        }
      })
      .catch(() => {
        // fail silently when offline or repo has no releases yet
      });
    return () => {
      cancelled = true;
    };
  }, [isOnline]);

  // Persist pins, track, gpx, lockedTarget, lockedBearing automatically to IndexedDB AFTER hydration
  useEffect(() => {
    if (!vaultHydrated) return;
    vaultSet('user_pins', userPins);
  }, [userPins, vaultHydrated]);

  useEffect(() => {
    if (!vaultHydrated) return;
    vaultSet('active_track', trackPoints);
  }, [trackPoints, vaultHydrated]);

  useEffect(() => {
    if (!vaultHydrated) return;
    vaultSet('imported_gpx', importedGpx);
  }, [importedGpx, vaultHydrated]);

  useEffect(() => {
    if (!vaultHydrated) return;
    vaultSet('locked_target', lockedTarget);
  }, [lockedTarget, vaultHydrated]);

  useEffect(() => {
    if (!vaultHydrated) return;
    vaultSet('locked_bearing', lockedBearing);
  }, [lockedBearing, vaultHydrated]);

  useEffect(() => {
    if (!vaultHydrated) return;
    vaultSet('active_route', activeRoute);
  }, [activeRoute, vaultHydrated]);

  // Persist user's GPS Real vs Sim preference & map skin preferences locally for instant Offline restart in forest
  useEffect(() => {
    try {
      localStorage.setItem('dinh_gps_real_mode_v1', isSimMode ? '0' : '1');
    } catch {
      // Ignore storage warnings
    }
  }, [isSimMode]);

  useEffect(() => {
    try {
      localStorage.setItem('dinh_3d_skin_v1', skin3D);
    } catch {
      // Ignore storage warnings
    }
  }, [skin3D]);

  useEffect(() => {
    try {
      localStorage.setItem('dinh_2d_style_v1', map2DStyle);
    } catch {
      // Ignore storage warnings
    }
  }, [map2DStyle]);

  useEffect(() => {
    try {
      localStorage.setItem('dinh_3d_vscale_v1', String(verticalScale));
    } catch {
      // Ignore storage warnings
    }
  }, [verticalScale]);

  // 2. Screen WakeLock for Continuous Trail Tracking
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    if (isRecordingTrack && 'wakeLock' in navigator) {
      navigator.wakeLock
        .request('screen')
        .then((wl) => {
          wakeLock = wl;
        })
        .catch(() => {});
    }
    return () => {
      wakeLock?.release().catch(() => {});
    };
  }, [isRecordingTrack]);

  // 3a-pre. Startup Auto-Field Detection (If already near Nui Dinh within 15km & permission granted, switch to Real GPS!)
  useEffect(() => {
    let cancelled = false;
    const LA_BAN_LAT = 10.53875;
    const LA_BAN_LON = 107.12942;

    const handleProbeFix = (lat: number, lon: number, acc: number) => {
      if (cancelled) return;
      const dToNuiDinh = haversineDistanceM(lat, lon, LA_BAN_LAT, LA_BAN_LON);
      if (dToNuiDinh <= 15000) {
        const switchingFromSim = isSimModeRef.current;
        if (switchingFromSim) {
          setTrackPoints([]);
        }
        setPlayerLat(lat);
        setPlayerLon(lon);
        setPlayerAccuracy(acc);
        setGpsFixCount((c) => c + 1);
        setLastGpsFixTime(Date.now());
        setIsSimMode(false);
        if (switchingFromSim) {
          triggerToast('🛰️ Phát hiện bạn đang ở khu vực Núi Dinh — Đã tự động bật GPS Thật!');
        }
      }
    };

    const probeFieldLocation = async () => {
      try {
        if (Capacitor.isNativePlatform()) {
          const perm = await Geolocation.checkPermissions();
          if (cancelled) return;
          if (perm.location === 'granted') {
            setGpsPermState('granted');
            setGpsPrecisionNote('Vị trí Chính xác (Fine GNSS)');
            const pos = await Geolocation.getCurrentPosition({
              enableHighAccuracy: false,
              maximumAge: 60000,
              timeout: 6000
            });
            handleProbeFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
          } else if (perm.coarseLocation === 'granted') {
            setGpsPermState('granted');
            setGpsPrecisionNote('Chỉ có Vị trí gần đúng — Cần bật Chính xác');
          } else if (perm.location === 'denied') {
            setGpsPermState('denied');
          } else {
            setGpsPermState('prompt');
          }
          return;
        }

        if (navigator.permissions?.query) {
          const permStatus = await navigator.permissions.query({ name: 'geolocation' });
          if (cancelled) return;
          setGpsPermState(permStatus.state);
          if (permStatus.state === 'granted' && 'geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(
              (pos) => handleProbeFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
              () => {},
              { enableHighAccuracy: false, maximumAge: 60000, timeout: 6000 }
            );
          }
        }
      } catch {
        // Ignore silent field probe errors
      }
    };

    void probeFieldLocation();
    return () => {
      cancelled = true;
    };
  }, [triggerToast]);

  // 3a. Dual-Engine Real Hardware GNSS WatchPosition (Capacitor Native + Web GNSS Fallback)
  useEffect(() => {
    if (isSimMode) {
      manualGpsRefreshRef.current = null;
      setGpsStatusMsg('🎮 Đang bật Giả lập Thực địa Núi Dinh');
      return;
    }

    let cancelled = false;
    let nativeWatchId: string | null = null;
    let webWatchId: number | null = null;
    let webFallbackWatchId: number | null = null;
    let reacquireInterval: number | null = null;
    let prevPos: { lat: number; lon: number } | null = null;
    let lastFineFixAt = 0;

    setGpsStatusMsg('🛰️ Đang xin quyền & bắt vệ tinh GNSS...');

    const acceptGpsFix = (coords: {
      latitude: number;
      longitude: number;
      accuracy: number;
      heading: number | null;
      speed: number | null;
    }) => {
      if (cancelled || isSimModeRef.current) return;
      const { latitude, longitude, accuracy, heading, speed } = coords;
      const now = Date.now();
      // Ignore noisy >120m cell-tower jumps when we already have a fresh (<6s) fine GPS lock (<30m)
      if (accuracy > 120 && now - lastFineFixAt < 6000) return;
      if (accuracy <= 30) lastFineFixAt = now;

      setPlayerLat(latitude);
      setPlayerLon(longitude);
      setPlayerAccuracy(accuracy);
      setSpeedMps(speed);
      setGpsFixCount((c) => c + 1);
      setLastGpsFixTime(now);
      setGpsPermState('granted');
      setGpsStatusMsg(`🛰️ GPS Thật (±${Math.round(accuracy)}m)`);

      if (heading !== null && !Number.isNaN(heading) && (speed ?? 0) > 0.4) {
        setGpsCourse(heading);
      } else if (prevPos) {
        const moved = haversineDistanceM(prevPos.lat, prevPos.lon, latitude, longitude);
        if (moved > 2.5) {
          setGpsCourse(computeBearingDeg(prevPos.lat, prevPos.lon, latitude, longitude));
        }
      }
      prevPos = { lat: latitude, lon: longitude };
    };

    const requestImmediateWebFixes = () => {
      if (!('geolocation' in navigator)) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => acceptGpsFix(pos.coords),
        () => {},
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 6000 }
      );
      navigator.geolocation.getCurrentPosition(
        (pos) => acceptGpsFix(pos.coords),
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
      );
    };

    const startWebWatch = (highAccuracy: boolean) => {
      if (!('geolocation' in navigator) || cancelled) return;
      const id = navigator.geolocation.watchPosition(
        (pos) => acceptGpsFix(pos.coords),
        (err) => {
          if (cancelled) return;
          if (err.code === 1) {
            setGpsPermState('denied');
            setGpsStatusMsg('⚠️ Bị từ chối quyền Vị trí (Kiểm tra Cài đặt)');
          } else if (highAccuracy && !webFallbackWatchId) {
            setGpsStatusMsg('🌲 Tán rừng rậm làm chậm GNSS — Đang dùng GPS hỗ trợ...');
            startWebWatch(false);
          } else {
            setGpsStatusMsg(`⚠️ Lỗi GPS: ${err.message}`);
          }
        },
        {
          enableHighAccuracy: highAccuracy,
          maximumAge: highAccuracy ? 1000 : 12000,
          timeout: highAccuracy ? 15000 : 12000
        }
      );
      if (highAccuracy) webWatchId = id;
      else webFallbackWatchId = id;
    };

    const initGpsEngines = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          let perm = await Geolocation.checkPermissions();
          if (cancelled) return;
          if (perm.location !== 'granted') {
            perm = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
            if (cancelled) return;
          }

          if (perm.location === 'granted') {
            setGpsPermState('granted');
            setGpsPrecisionNote('Vị trí Chính xác (Fine GNSS)');
          } else if (perm.coarseLocation === 'granted') {
            setGpsPermState('granted');
            setGpsPrecisionNote('Android chỉ cấp Vị trí gần đúng — hãy bật "Chính xác" trong Cài đặt');
          } else {
            setGpsPermState('denied');
            setGpsPrecisionNote('Chưa cấp quyền Vị trí');
            setGpsStatusMsg('⚠️ Vui lòng cấp quyền Vị trí cho Dinh Ops 3D trong Cài đặt Android');
            return;
          }

          const kickNativeFixes = () => {
            Geolocation.getCurrentPosition({
              enableHighAccuracy: false,
              maximumAge: 60000,
              timeout: 6000
            })
              .then((pos) => acceptGpsFix(pos.coords))
              .catch(() => {});

            Geolocation.getCurrentPosition({
              enableHighAccuracy: true,
              maximumAge: 0,
              timeout: 20000
            })
              .then((pos) => acceptGpsFix(pos.coords))
              .catch(() => {});
          };

          manualGpsRefreshRef.current = kickNativeFixes;
          kickNativeFixes();

          const watchPromiseId = await Geolocation.watchPosition(
            {
              enableHighAccuracy: true,
              maximumAge: 1000,
              timeout: 15000,
              minimumUpdateInterval: 1000
            },
            (pos, err) => {
              if (cancelled) return;
              if (pos) {
                acceptGpsFix(pos.coords);
              } else if (err) {
                const msg = err?.message || String(err);
                if (/timeout/i.test(msg)) {
                  setGpsStatusMsg('🌲 Chờ vệ tinh dưới tán cây — Đang bù vị trí nhanh...');
                  Geolocation.getCurrentPosition({
                    enableHighAccuracy: false,
                    maximumAge: 15000,
                    timeout: 8000
                  })
                    .then((p) => acceptGpsFix(p.coords))
                    .catch(() => {});
                } else {
                  setGpsStatusMsg(`⚠️ GPS Native: ${msg}`);
                }
              }
            }
          );

          if (cancelled) {
            void Geolocation.clearWatch({ id: watchPromiseId });
          } else {
            nativeWatchId = watchPromiseId;
          }
          return;
        } catch {
          // Fall back cleanly to WebView Geolocation API if Capacitor bridge fails
        }
      }

      if (!('geolocation' in navigator)) {
        setGpsStatusMsg('⚠️ Thiết bị không hỗ trợ GPS');
        return;
      }

      manualGpsRefreshRef.current = requestImmediateWebFixes;
      requestImmediateWebFixes();
      startWebWatch(true);
    };

    void initGpsEngines();

    const onVisibilityRestore = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        manualGpsRefreshRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityRestore);

    // Periodic fine GNSS nudge every 25s in case canopy lock dropped temporarily
    reacquireInterval = window.setInterval(() => {
      if (!cancelled) manualGpsRefreshRef.current?.();
    }, 25000);

    return () => {
      cancelled = true;
      manualGpsRefreshRef.current = null;
      document.removeEventListener('visibilitychange', onVisibilityRestore);
      if (reacquireInterval !== null) window.clearInterval(reacquireInterval);
      if (nativeWatchId !== null) {
        void Geolocation.clearWatch({ id: nativeWatchId });
      }
      if (webWatchId !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(webWatchId);
      }
      if (webFallbackWatchId !== null && 'geolocation' in navigator) {
        navigator.geolocation.clearWatch(webFallbackWatchId);
      }
    };
  }, [isSimMode]);

  // 3b. Real Hardware Magnetometer & Accelerometer Spirit Level (Android deviceorientationabsolute + iOS webkitCompassHeading)
  const isSimWalkActiveRef = useRef<boolean>(false);
  const liveCompassRef = useRef<number>(compassHeading);
  liveCompassRef.current = compassHeading;

  useEffect(() => {
    if (!useRealCompassSensor && isSimMode) {
      liveAttitudeRef.current = { pitch: 0, roll: 0 };
      setPitchDeg(0);
      setRollDeg(0);
      return;
    }

    let hasAbsolute = false;
    let smoothPitch = liveAttitudeRef.current.pitch;
    let smoothRoll = liveAttitudeRef.current.roll;
    let committedPitch = smoothPitch;
    let committedRoll = smoothRoll;
    let hasAttitude = false;
    let pendingRafId = 0;
    let pendingHeadingCommit: number | null = null;
    let pendingAttitudeCommit = false;

    const getScreenAngle = () =>
      typeof window.screen?.orientation?.angle === 'number' ? window.screen.orientation.angle : 0;

    // Coalesce all high-frequency 60–200Hz hardware sensor events into at most 1 clean vsync commit!
    const scheduleFlush = () => {
      if (pendingRafId) return;
      pendingRafId = window.requestAnimationFrame(() => {
        pendingRafId = 0;
        if (pendingHeadingCommit !== null) {
          const h = pendingHeadingCommit;
          pendingHeadingCommit = null;
          setCompassHeading(h);
        }
        if (pendingAttitudeCommit && needAttitudeRef.current) {
          pendingAttitudeCommit = false;
          const pRounded = Math.round(smoothPitch * 10) / 10;
          const rRounded = Math.round(smoothRoll * 10) / 10;
          if (Math.abs(pRounded - committedPitch) >= 0.2) {
            committedPitch = pRounded;
            setPitchDeg(pRounded);
          }
          if (Math.abs(rRounded - committedRoll) >= 0.25) {
            committedRoll = rRounded;
            setRollDeg(rRounded);
          }
        } else {
          pendingAttitudeCommit = false;
        }
      });
    };

    const pushFilteredAttitude = (beta: number, gamma: number, screenAngle: number) => {
      const { pitchDeg: rawPitch, rollDeg: rawRoll } = computeCameraAttitude(beta, gamma, screenAngle);
      if (!hasAttitude) {
        smoothPitch = rawPitch;
        smoothRoll = rawRoll;
        hasAttitude = true;
      } else {
        smoothPitch += (rawPitch - smoothPitch) * 0.24;
        const dRoll = ((rawRoll - smoothRoll + 540) % 360) - 180;
        smoothRoll = ((smoothRoll + dRoll * 0.24 + 540) % 360) - 180;
      }
      liveAttitudeRef.current.pitch = smoothPitch;
      liveAttitudeRef.current.roll = smoothRoll;
      // Zero React re-renders on main 3D/2D map screen when neither Compass nor Toolkit/AR is open!
      if (needAttitudeRef.current) {
        pendingAttitudeCommit = true;
        scheduleFlush();
      }
    };

    const pushFilteredHeading = (rawDeg: number) => {
      if (isSimWalkActiveRef.current) {
        smoothHeadingRef.current = liveCompassRef.current;
        return;
      }
      const prev = smoothHeadingRef.current;
      const delta = ((rawDeg - prev + 540) % 360) - 180;
      const next = (prev + delta * 0.16 + 360) % 360;
      smoothHeadingRef.current = next;
      if (Math.abs(((next - liveCompassRef.current + 540) % 360) - 180) >= 1.5) {
        pendingHeadingCommit = Math.round(next);
        scheduleFlush();
      }
    };

    const handleAbsoluteOrientation = (ev: DeviceOrientationEvent) => {
      const angle = syntheticLandscapeRef.current ? 90 : getScreenAngle();
      if (ev.alpha !== null && !Number.isNaN(ev.alpha)) {
        hasAbsolute = true;
        const tilted = computeTiltCompensatedHeading(ev.alpha, ev.beta ?? 0, ev.gamma ?? 0, angle);
        pushFilteredHeading(tilted);
      }
      if (ev.beta !== null || ev.gamma !== null) {
        pushFilteredAttitude(ev.beta ?? 0, ev.gamma ?? 0, angle);
      }
    };

    const handleRelativeOrWebkit = (ev: DeviceOrientationEvent) => {
      const angle = syntheticLandscapeRef.current ? 90 : getScreenAngle();
      // Skip duplicate attitude processing when deviceorientationabsolute already fires on Android
      if (!hasAbsolute && (ev.beta !== null || ev.gamma !== null)) {
        pushFilteredAttitude(ev.beta ?? 0, ev.gamma ?? 0, angle);
      }

      const webkitH = (ev as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof webkitH === 'number' && !Number.isNaN(webkitH)) {
        pushFilteredHeading((((webkitH + angle) % 360) + 360) % 360);
      } else if (!hasAbsolute && ev.alpha !== null) {
        const tilted = computeTiltCompensatedHeading(ev.alpha, ev.beta ?? 0, ev.gamma ?? 0, angle);
        pushFilteredHeading(tilted);
      }
    };

    window.addEventListener(
      'deviceorientationabsolute' as keyof WindowEventMap,
      handleAbsoluteOrientation as EventListener
    );
    window.addEventListener('deviceorientation', handleRelativeOrWebkit);

    return () => {
      if (pendingRafId) window.cancelAnimationFrame(pendingRafId);
      window.removeEventListener(
        'deviceorientationabsolute' as keyof WindowEventMap,
        handleAbsoluteOrientation as EventListener
      );
      window.removeEventListener('deviceorientation', handleRelativeOrWebkit);
    };
  }, [useRealCompassSensor, isSimMode]);

  const handleToggleRealCompass = useCallback(
    async (enable: boolean) => {
      if (!enable) {
        setUseRealCompassSensor(false);
        return;
      }
      const DevOrient = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (typeof DevOrient.requestPermission === 'function') {
        try {
          const perm = await DevOrient.requestPermission();
          if (perm !== 'granted') {
            triggerToast('⚠️ Trình duyệt từ chối quyền cảm biến La bàn!');
            return;
          }
        } catch {
          triggerToast('⚠️ Không thể xin quyền cảm biến La bàn trên trình duyệt này');
          return;
        }
      }
      setUseRealCompassSensor(true);
      triggerToast('🧭 Đã bật cảm biến Từ kế & Thước thủy thật của thiết bị!');
    },
    [triggerToast]
  );

  const handleToggleHeadingUp = useCallback(() => {
    const next = !headingUp;
    setHeadingUp(next);
    if (navigator.vibrate) navigator.vibrate(15);
    if (next) {
      if (!isSimMode && !useRealCompassSensor) {
        void handleToggleRealCompass(true);
      } else {
        triggerToast(
          isSimMode
            ? '🧭 Đã bật H-UP theo hướng Giả lập (Chỉnh thanh La bàn trong TEST để xoay)'
            : '🧭 Đang xoay bản đồ theo hướng điện thoại (Heading-Up)'
        );
      }
    } else {
      triggerToast('⬆️ Đã khóa bản đồ chuẩn hướng Bắc');
    }
  }, [headingUp, isSimMode, useRealCompassSensor, handleToggleRealCompass, triggerToast]);

  // 4. Simulator Walk Engine (Walk along Red Route or toward clicked target!)
  const simDestRef = useRef<{ lat: number; lon: number } | null>(null);
  const redRouteFlatPoints = useMemo(() => {
    const red = dataset.routes.find((r) => r.id === 'red');
    if (!red) return [];
    const pts: [number, number][] = [];
    for (const seg of red.segments) {
      for (const p of seg) pts.push(p);
    }
    return pts;
  }, []);
  const simRouteIdxRef = useRef<number>(0);

  useEffect(() => {
    if (!isSimMode || !simAutoWalk || redRouteFlatPoints.length < 2) return;
    const timer = window.setInterval(() => {
      const nextIdx = (simRouteIdxRef.current + 1) % redRouteFlatPoints.length;
      const [nLat, nLon] = redRouteFlatPoints[nextIdx];
      setPlayerLat((curLat) => {
        setPlayerLon((curLon) => {
          const brng = computeBearingDeg(curLat, curLon, nLat, nLon);
          setGpsCourse(brng);
          setCompassHeading(brng);
          setSpeedMps(2.2);
          return nLon;
        });
        return nLat;
      });
      simRouteIdxRef.current = nextIdx;
    }, 650);
    return () => window.clearInterval(timer);
  }, [isSimMode, simAutoWalk, redRouteFlatPoints]);

  const simMoveIntervalRef = useRef<number | null>(null);
  const simRouteWalkIntervalRef = useRef<number | null>(null);
  isSimWalkActiveRef.current =
    isSimMode && (simAutoWalk || simRouteWalking || simMoveIntervalRef.current !== null);

  const stopSimWalks = useCallback(() => {
    if (simMoveIntervalRef.current) {
      window.clearInterval(simMoveIntervalRef.current);
      simMoveIntervalRef.current = null;
    }
    if (simRouteWalkIntervalRef.current) {
      window.clearInterval(simRouteWalkIntervalRef.current);
      simRouteWalkIntervalRef.current = null;
    }
    setSimRouteWalking(false);
    setSpeedMps(0);
  }, []);

  // Smooth walk to clicked 3D/2D destination in Simulator mode (direct move)
  const handleSimMoveTo = useCallback(
    (destLat: number, destLon: number) => {
      stopSimWalks();
      simDestRef.current = { lat: destLat, lon: destLon };
      const brng = computeBearingDeg(playerLat, playerLon, destLat, destLon);
      setCompassHeading(Math.round(brng));
      setGpsCourse(Math.round(brng));
      setSpeedMps(2.5);

      let step = 0;
      const totalSteps = 18;
      const startLat = playerLat;
      const startLon = playerLon;
      simMoveIntervalRef.current = window.setInterval(() => {
        step++;
        const t = step / totalSteps;
        const lat = startLat + (destLat - startLat) * t;
        const lon = startLon + (destLon - startLon) * t;
        setPlayerLat(Number(lat.toFixed(6)));
        setPlayerLon(Number(lon.toFixed(6)));
        if (step >= totalSteps) {
          if (simMoveIntervalRef.current) window.clearInterval(simMoveIntervalRef.current);
          simMoveIntervalRef.current = null;
          setSpeedMps(0);
        }
      }, 90);
    },
    [playerLat, playerLon, stopSimWalks]
  );

  // Smoothly walk player along computed GTA V trail vertices in Simulator mode
  const handleSimFollowRoute = useCallback(
    (routePoints: [number, number][]) => {
      stopSimWalks();
      if (routePoints.length < 2) return;

      // Downsample evenly across waypoints so preview completes smoothly (~50-75 steps)
      const stride = Math.max(1, Math.floor(routePoints.length / 68));
      const walkPts: [number, number][] = [];
      for (let i = 1; i < routePoints.length - 1; i += stride) {
        walkPts.push(routePoints[i]);
      }
      walkPts.push(routePoints[routePoints.length - 1]);

      let idx = 0;
      let prevLat = routePoints[0][0];
      let prevLon = routePoints[0][1];
      setSimRouteWalking(true);

      simRouteWalkIntervalRef.current = window.setInterval(() => {
        if (idx >= walkPts.length) {
          stopSimWalks();
          return;
        }
        const [nLat, nLon] = walkPts[idx];
        const brng = computeBearingDeg(prevLat, prevLon, nLat, nLon);
        setCompassHeading(Math.round(brng));
        setGpsCourse(Math.round(brng));
        setSpeedMps(2.8);
        setPlayerLat(Number(nLat.toFixed(6)));
        setPlayerLon(Number(nLon.toFixed(6)));
        prevLat = nLat;
        prevLon = nLon;
        idx++;
        if (idx >= walkPts.length) {
          stopSimWalks();
        }
      }, 125);
    },
    [stopSimWalks]
  );

  const handleClearGtaRoute = useCallback(() => {
    stopSimWalks();
    setActiveRoute((prev) => {
      if (prev) {
        setLockedTarget((lt) => (lt?.id === prev.id ? null : lt));
      }
      return null;
    });
  }, [stopSimWalks]);

  const handleStartGtaRoute = useCallback(
    (destLat: number, destLon: number, destEle: number, customName?: string) => {
      setSimAutoWalk(false);
      stopSimWalks();
      const route = computeTacticalTrailRoute(
        dataset,
        playerLat,
        playerLon,
        destLat,
        destLon,
        customName || `Đích (${destEle}m)`
      );
      setActiveRoute(route);
      setLockedTarget({
        id: route.id,
        name: route.destName,
        lat: route.destLat,
        lon: route.destLon,
        ele: route.destEle,
        category: 'checkpoint',
        note: route.snappedToTrail
          ? `Lộ trình GTA V bám mạng lưới trail (${formatDistance(route.totalDistanceM)}, +${route.ascentM}m)`
          : `Đường thẳng địa hình (${formatDistance(route.totalDistanceM)})`
      });
      triggerFlyTo((playerLat + route.destLat) / 2, (playerLon + route.destLon) / 2);
      triggerToast(
        route.snappedToTrail
          ? `🧭 Lộ trình bám trail GTA: ${formatDistance(route.totalDistanceM)} (+${route.ascentM}m • ~${route.etaMinutes}p)`
          : `🧭 Đường đi trực tiếp: ${formatDistance(route.totalDistanceM)} (~${route.etaMinutes}p)`
      );
      if (isSimMode && route.points.length >= 2) {
        handleSimFollowRoute(route.points);
      }
    },
    [dataset, playerLat, playerLon, isSimMode, stopSimWalks, handleSimFollowRoute, triggerFlyTo, triggerToast]
  );

  // Cleanly trim remaining GTA V route behind player or clear upon arrival (< 14m)
  const activeRouteRef = useRef<TacticalRouteResult | null>(null);
  activeRouteRef.current = activeRoute;
  useEffect(() => {
    const cur = activeRouteRef.current;
    if (!cur) return;
    const distToDest = haversineDistanceM(playerLat, playerLon, cur.destLat, cur.destLon);
    if (distToDest < 14) {
      stopSimWalks();
      setActiveRoute(null);
      setLockedTarget((lt) => (lt?.id === cur.id ? null : lt));
      triggerToast(`🎯 Đã tới "${cur.destName}"!`);
      return;
    }
    setActiveRoute((prev) => (prev ? trimRouteFromPlayer(prev, playerLat, playerLon, dataset) : null));
  }, [playerLat, playerLon, stopSimWalks, triggerToast]);

  useEffect(() => {
    if (!isSimMode) {
      stopSimWalks();
    }
  }, [isSimMode, stopSimWalks]);

  // 5. Record Breadcrumb Tracklog Automatically when Player Moves > 4m (ignore > 500m teleport jumps)
  useEffect(() => {
    if (!vaultHydrated || !isRecordingTrack) return;
    setTrackPoints((prev) => {
      const nextPt: TrackPoint = {
        lat: playerLat,
        lon: playerLon,
        ele: playerEle,
        accuracy: playerAccuracy,
        speedMps,
        gpsCourse,
        timestamp: Date.now()
      };
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        const dist = haversineDistanceM(last.lat, last.lon, playerLat, playerLon);
        if (dist < 4.0) return prev;
        if (dist > 500) return [nextPt];
      }
      return [...prev, nextPt];
    });
  }, [vaultHydrated, playerLat, playerLon, playerEle, playerAccuracy, speedMps, gpsCourse, isRecordingTrack]);

  // Total Tracked Distance (filter out any legacy > 500m teleport jumps)
  const totalTrackDistanceM = useMemo(() => {
    let sum = 0;
    for (let i = 1; i < trackPoints.length; i++) {
      const segDist = haversineDistanceM(
        trackPoints[i - 1].lat,
        trackPoints[i - 1].lon,
        trackPoints[i].lat,
        trackPoints[i].lon
      );
      if (segDist <= 500) {
        sum += segDist;
      }
    }
    return sum;
  }, [trackPoints]);

  // 6. Real-Time Geofence & Off-Trail Safety Alerts
  const safetyAlerts: SafetyAlert[] = useMemo(
    () => evaluateSafetyAlerts(playerLat, playerLon, dataset),
    [playerLat, playerLon]
  );

  useEffect(() => {
    if (safetyAlerts.some((a) => a.level === 'critical')) {
      if (navigator.vibrate) navigator.vibrate([120, 60, 120, 60, 180]);
    }
  }, [safetyAlerts]);

  // 7b. Magnetic Interference Detector (Full 186-Vertex 220kV Powerline Corridor or Magnetometer vs GPS Drift)
  const magneticWarningReason = useMemo(() => {
    const powerDist = minDistanceToPowerlinesM(playerLat, playerLon, dataset);
    if (powerDist < 150) {
      return `Bạn đang cách hành lang đường dây cao thế 220kV chỉ ${Math.round(powerDist)}m. Kim từ kế dễ bị lệch — hãy ưu tiên nhìn mũi tên xanh "Hướng Đi GPS"!`;
    }
    if (!isSimMode && gpsCourse !== null && (speedMps ?? 0) > 0.9) {
      const diff = Math.abs(((compassHeading - gpsCourse + 540) % 360) - 180);
      if (diff > 32) {
        return `Kim từ kế (${compassHeading}°) đang lệch ${Math.round(diff)}° so với hướng di chuyển GPS (${Math.round(gpsCourse)}°). Kiểm tra ốp lưng nam châm hoặc xoay máy hình số 8 để hiệu chuẩn!`;
      }
    }
    return null;
  }, [playerLat, playerLon, isSimMode, gpsCourse, speedMps, compassHeading]);
  const homingMetrics = useMemo(() => {
    if (!lockedTarget) return null;
    const dist = haversineDistanceM(playerLat, playerLon, lockedTarget.lat, lockedTarget.lon);
    const brng = computeBearingDeg(playerLat, playerLon, lockedTarget.lat, lockedTarget.lon);
    const clock = formatClockDirection(brng, compassHeading);
    const eleDiff = Math.round(lockedTarget.ele - playerEle);
    return { dist, brng, clock, eleDiff };
  }, [lockedTarget, playerLat, playerLon, playerEle, compassHeading]);

  // Handlers
  const handleSavePin = useCallback(
    (newPin: UserPin, lockImmediately: boolean) => {
      setUserPins((prev) => [newPin, ...prev]);
      setPendingPinCoords(null);
      if (lockImmediately) {
        setLockedTarget({
          id: newPin.id,
          name: newPin.name,
          lat: newPin.lat,
          lon: newPin.lon,
          ele: newPin.ele,
          category: newPin.category,
          note: newPin.note,
          photoDataUrl: newPin.photoDataUrl
        });
        triggerToast(`🎯 Đã lưu "${newPin.name}" & khóa Radar dẫn đường!`);
      } else {
        triggerToast(`✅ Đã lưu điểm ghim "${newPin.name}" vào bộ nhớ Offline!`);
      }
    },
    [triggerToast]
  );

  const handleInstantPoopOrRockDrop = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate(25);
    setPendingPinCoords({
      lat: playerLat,
      lon: playerLon,
      ele: playerEle
    });
  }, [playerLat, playerLon, playerEle]);

  const handleSelectUserPin = useCallback((pin: UserPin) => {
    setLockedTarget({
      id: pin.id,
      name: pin.name,
      lat: pin.lat,
      lon: pin.lon,
      ele: pin.ele,
      category: pin.category,
      note: pin.note,
      photoDataUrl: pin.photoDataUrl
    });
    setShowPrecisionRadar(true);
  }, []);

  const handleRestoreBackup = useCallback(
    (backup: TacticalSessionBackup) => {
      setUserPins(Array.isArray(backup.userPins) ? backup.userPins : []);
      setTrackPoints(Array.isArray(backup.trackPoints) ? backup.trackPoints : []);
      setImportedGpx(Array.isArray(backup.importedGpx) ? backup.importedGpx : []);
      setLockedTarget(backup.lockedTarget ?? null);
      setLockedBearing(typeof backup.lockedBearing === 'number' ? backup.lockedBearing : null);
      setActiveRoute(backup.activeRoute ?? null);
      if (backup.lockedTarget) {
        triggerFlyTo(backup.lockedTarget.lat, backup.lockedTarget.lon);
      } else if (backup.userPins && backup.userPins.length > 0) {
        triggerFlyTo(backup.userPins[0].lat, backup.userPins[0].lon);
      }
      triggerToast(
        `💾 Đã khôi phục ${backup.userPins?.length ?? 0} Ghim & ${backup.trackPoints?.length ?? 0} điểm Vết chân!`
      );
    },
    [triggerFlyTo, triggerToast]
  );

  const handleBacktrackStart = useCallback(() => {
    if (trackPoints.length < 2) {
      triggerToast('Chưa có vết chân nào được ghi để đi ngược!');
      return;
    }
    const startPt = trackPoints[0];
    setLockedTarget({
      id: 'backtrack-origin',
      name: '👣 Điểm Xuất Phát Vết Chân Cũ',
      lat: startPt.lat,
      lon: startPt.lon,
      ele: startPt.ele,
      category: 'checkpoint',
      note: 'Đi ngược theo đường phát sáng màu Ngọc Lam trên bản đồ 3D để quay lại nơi bắt đầu!'
    });
    triggerFlyTo(startPt.lat, startPt.lon);
    triggerToast('👣 Đã bật chế độ Đi Ngược Dấu Chân về điểm xuất phát!');
  }, [trackPoints, triggerFlyTo, triggerToast]);

  const handleSelectTarget = useCallback(
    (t: TacticalTarget) => {
      setActiveRoute(null);
      stopSimWalks();
      setLockedTarget(t);
      triggerToast(`🎯 Đã khóa mục tiêu: ${t.name}`);
    },
    [stopSimWalks, triggerToast]
  );

  const handleRequestPinAt = useCallback((lat: number, lon: number, ele: number) => {
    setPendingPinCoords({ lat, lon, ele });
  }, []);

  return (
    <div
      data-palette={palette}
      className={`app-shell ${syntheticLandscape ? 'synthetic-landscape' : ''} ${
        isMapDragging ? 'hud-dragging' : isHudIdle ? 'hud-idle' : ''
      }`}
    >
      {/* SPEC-OPS TACTICAL TOP MICRO-HUD */}
      <header className="top-hud-bar">
        <div className="hud-top-row">
          {/* Left Floating Telemetry Micro-Bar */}
          <div className="hud-tele-pill">
            <span
              className={`pulse-dot ${isOnline ? 'online' : 'offline'}`}
              title={isOnline ? 'Online + Offline Vault' : '100% Offline'}
            />
            <button
              type="button"
              className={`hud-version-pill ${availableOta ? 'has-update' : ''}`}
              onClick={() => {
                setToolkitInitialTab('ota');
                setShowToolkitModal(true);
              }}
              title={
                availableOta
                  ? `Có bản mới v${availableOta.version} từ GitHub — Chạm cập nhật OTA`
                  : 'Phiên bản & Cập nhật OTA'
              }
            >
              {availableOta ? `OTA ${availableOta.version}!` : `v${APP_BUILD_INFO.version}`}
            </button>

            <TacticalClock />

            {!zenMode && (
              <>
                <span className="tele-mini-sep" />
                <span className="tele-inline" title="Độ cao hiện tại">
                  <small>ALT</small> <strong>{playerEle}M</strong>
                </span>
                <button
                  type="button"
                  className="tele-compass-chip"
                  onClick={() => setShowCompassModal(true)}
                  title="Bấm mở La Bàn Chiến Thuật 360°"
                >
                  <strong>{formatBearingCardinal(compassHeading)}</strong>
                </button>
                <span className="tele-inline hide-narrow" title="Hướng di chuyển GPS">
                  <small>CRS</small>{' '}
                  <strong className="text-emerald">
                    {gpsCourse !== null ? `${String(Math.round(gpsCourse)).padStart(3, '0')}°` : '--'}
                  </strong>
                </span>
                <span className="tele-inline hide-narrow" title="Quãng đường vết chân đã đi">
                  <small>TRK</small> <strong>{formatDistance(totalTrackDistanceM)}</strong>
                </span>
              </>
            )}
          </div>

          {!zenMode && (
            <TacticalCompassTape
              compassHeading={compassHeading}
              gpsCourse={gpsCourse}
              lockedTarget={lockedTarget}
              lockedBearing={lockedBearing}
              playerLat={playerLat}
              playerLon={playerLon}
              headingUp={headingUp}
            />
          )}

          {/* Right Floating View & Mode Micro-Pill */}
          <div className="hud-controls-pill">
            <div className="view-mode-segmented">
              <button
                type="button"
                className={viewMode === '3d' ? 'active' : ''}
                onClick={() => setViewMode('3d')}
              >
                3D
              </button>
              <button
                type="button"
                className={viewMode === 'split' ? 'active' : ''}
                onClick={() => setViewMode('split')}
              >
                Đôi
              </button>
              <button
                type="button"
                className={viewMode === '2d' ? 'active' : ''}
                onClick={() => setViewMode('2d')}
              >
                2D
              </button>
            </div>

            <button
              type="button"
              className="hud-icon-btn"
              onClick={handleCyclePalette}
              title="Đổi tông màu Đặc Nhiệm (Giảm màu mè)"
            >
              MÀU:{PALETTE_META[palette].short}
            </button>

            <button
              type="button"
              className={`hud-icon-btn ${headingUp ? 'active' : ''}`}
              onClick={handleToggleHeadingUp}
              title={
                headingUp
                  ? 'Đang xoay bản đồ theo hướng điện thoại (Bấm để khóa về hướng Bắc)'
                  : 'Bật xoay bản đồ theo hướng điện thoại (Heading-Up)'
              }
            >
              {headingUp ? 'H-UP' : 'BẮC'}
            </button>

            <button
              type="button"
              className={`hud-icon-btn ${showLayerPopover ? 'active' : ''}`}
              onClick={() => setShowLayerPopover((v) => !v)}
              title="Chọn tông màu, lớp địa hình & 4 tuyến trail"
            >
              LỚP
            </button>

            <button
              type="button"
              className={`hud-icon-btn ${zenMode ? 'active' : ''}`}
              onClick={() => setZenMode((v) => !v)}
              title={zenMode ? 'Hiện lại thanh chỉ số HUD' : 'Thu gọn tối đa HUD (Sạch bản đồ)'}
            >
              {zenMode ? 'HUD' : 'ẨN'}
            </button>
          </div>
        </div>

        {/* CENTERED NARROW SUB-PILLS (Only shown when active) */}
        <div className="hud-sub-pills">
          {nativeApkVer && isRemoteNewer('1.0.6', nativeApkVer) && !dismissedApkNudge && (
            <div className="ota-quick-pill apk-nudge-pill">
              <a
                href={
                  apkReleaseUrl ||
                  'https://github.com/hongphuc120399-netizen/dinh-ops-3d/releases/download/apk-v1.0.6/dinh-ops-3d.apk'
                }
                target="_blank"
                rel="noreferrer"
                className="ota-quick-act"
                title="Cài đè APK mới để kích hoạt ẩn 2 viền đen/trắng hệ thống (không mất dữ liệu)"
              >
                📲 Vỏ APK v{nativeApkVer} còn 2 viền — Bấm tải APK v1.0.6 để ẩn hẳn
              </a>
              <button
                type="button"
                className="pill-x"
                onClick={() => setDismissedApkNudge(true)}
                title="Tạm ẩn nhắc nhở"
              >
                ✕
              </button>
            </div>
          )}
          {availableOta && !dismissedQuickOta && (
            <div className="ota-quick-pill">
              <button
                type="button"
                className="ota-quick-act"
                disabled={quickOtaProgress !== null}
                onClick={handleQuickOtaApply}
                title={`Tải trực tiếp bản OTA v${availableOta.version} (${Math.round(availableOta.sizeBytes / 1024)} KB) — Không cần cài lại APK`}
              >
                {quickOtaProgress !== null
                  ? `⏳ Đang cập nhật v${availableOta.version} (${quickOtaProgress}%)...`
                  : `⚡ Cập nhật ngay v${availableOta.version}`}
              </button>
              <button
                type="button"
                className="pill-x"
                onClick={() => setDismissedQuickOta(true)}
                title="Tạm ẩn thông báo cập nhật"
              >
                ✕
              </button>
            </div>
          )}

          {!forceLandscape && isOsPortrait && !dismissedPortraitHint && (
            <div className="portrait-nudge-pill">
              <button type="button" className="portrait-action" onClick={handleToggleForceLandscape}>
                ↔️ Bấm khóa Nằm Ngang mặc định
              </button>
              <button
                type="button"
                className="pill-x"
                onClick={() => setDismissedPortraitHint(true)}
                title="Ẩn nhắc nhở"
              >
                ✕
              </button>
            </div>
          )}

          {activeRoute && (
            <div className="homing-hud-banner gta-route-pill" onClick={() => setShowPrecisionRadar(true)}>
              {homingMetrics && (
                <div
                  className="mini-radar-arrow"
                  style={{ transform: `rotate(${homingMetrics.clock.deltaDeg}deg)` }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z" />
                  </svg>
                </div>
              )}
              <span className="homing-compact-txt">
                🧭 <strong>LỘ TRÌNH GTA:</strong> {formatDistance(activeRoute.totalDistanceM)} • +
                {activeRoute.ascentM}m • ~{activeRoute.etaMinutes}p
              </span>
              {isSimMode && activeRoute.points.length >= 2 && (
                <button
                  type="button"
                  className="gta-sim-step-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (simRouteWalking) {
                      stopSimWalks();
                    } else {
                      handleSimFollowRoute(activeRoute.points);
                    }
                  }}
                  title={simRouteWalking ? 'Tạm dừng đi thử trên trail' : 'Chạy thử theo lộ trình GTA'}
                >
                  {simRouteWalking ? '⏸' : '▶'}
                </button>
              )}
              <button
                type="button"
                className="homing-clear-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearGtaRoute();
                }}
                title="Hủy lộ trình dẫn đường GTA"
              >
                ✕
              </button>
            </div>
          )}

          {lockedTarget && homingMetrics && !activeRoute && (
            <div className="homing-hud-banner" onClick={() => setShowPrecisionRadar(true)}>
              <div
                className="mini-radar-arrow"
                style={{ transform: `rotate(${homingMetrics.clock.deltaDeg}deg)` }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z" />
                </svg>
              </div>
              <span className="homing-compact-txt">
                🎯 <strong>{lockedTarget.name}</strong> • {formatDistance(homingMetrics.dist)} (
                {homingMetrics.clock.clock}h,{' '}
                {homingMetrics.eleDiff >= 0 ? `+${homingMetrics.eleDiff}m` : `${homingMetrics.eleDiff}m`})
              </span>
              <button
                type="button"
                className="homing-clear-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setLockedTarget(null);
                }}
                title="Bỏ khóa mục tiêu"
              >
                ✕
              </button>
            </div>
          )}

          {!isSimMode &&
            !dismissedOutGpsHint &&
            (playerLat < dataset.bounds.south - 0.005 ||
              playerLat > dataset.bounds.north + 0.005 ||
              playerLon < dataset.bounds.west - 0.005 ||
              playerLon > dataset.bounds.east + 0.005) && (
              <div className="out-of-bounds-gps-pill">
                <span>
                  🛰️ GPS Thật OK (±{Math.round(playerAccuracy ?? 0)}m) • Cách Núi Dinh{' '}
                  {(haversineDistanceM(playerLat, playerLon, 10.53875, 107.12942) / 1000).toFixed(1)} km (Khi
                  tới núi Thứ 7 sẽ khớp trực tiếp lên 3D)
                </span>
                <button
                  type="button"
                  className="pill-x"
                  onClick={() => setDismissedOutGpsHint(true)}
                  title="Tạm ẩn thông báo GPS ở xa"
                >
                  ✕
                </button>
              </div>
            )}

          {safetyAlerts.length > 0 &&
            (safetyAlerts[0].level === 'critical' || safetyAlerts[0].title !== dismissedWarnTitle) && (
              <div
                className={`safety-banner ${safetyAlerts[0].level}`}
                onClick={() => setExpandedSafety((v) => !v)}
                title="Chạm để xem/thu gọn chi tiết cảnh báo"
              >
                <div className="safety-txt-wrap">
                  <strong>{safetyAlerts[0].title}</strong>
                  {expandedSafety && <p>{safetyAlerts[0].detail}</p>}
                </div>
                {safetyAlerts[0].level !== 'critical' && (
                  <button
                    type="button"
                    className="pill-x"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDismissedWarnTitle(safetyAlerts[0].title);
                    }}
                    title="Tạm ẩn cảnh báo này"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
        </div>
      </header>

      {/* FLOATING LAYER & 3D SETTINGS POPOVER */}
      {showLayerPopover && (
        <>
          <div className="popover-click-catcher" onClick={() => setShowLayerPopover(false)} />
          <div className="layer-popover-panel">
          <div className="pop-section">
            <span className="pop-label">Tông màu Giao diện &amp; Bản đồ (Giảm màu mè)</span>
            <div className="chip-row">
              {PALETTE_ORDER.map((pKey) => (
                <button
                  key={pKey}
                  type="button"
                  className={palette === pKey ? 'active' : ''}
                  onClick={() => handleSelectPalette(pKey)}
                >
                  {PALETTE_META[pKey].label}
                </button>
              ))}
            </div>
          </div>

          <div className="pop-section">
            <span className="pop-label">Bề mặt Địa hình 3D (Three.js)</span>
            <div className="chip-row">
              <button
                type="button"
                className={skin3D === 'tactical' ? 'active' : ''}
                onClick={() => setSkin3D('tactical')}
              >
                🎯 Chiến Thuật ATAK
              </button>
              <button
                type="button"
                className={skin3D === 'topo' ? 'active' : ''}
                onClick={() => setSkin3D('topo')}
              >
                🗺️ Topo Đồng Mức
              </button>
              <button
                type="button"
                className={skin3D === 'satellite' ? 'active' : ''}
                onClick={() => setSkin3D('satellite')}
              >
                🛰️ Vệ Tinh Google 3D
              </button>
              <button
                type="button"
                className={skin3D === 'night' ? 'active' : ''}
                onClick={() => setSkin3D('night')}
              >
                🟢 Đêm Recon
              </button>
            </div>
          </div>

          <div className="pop-section">
            <span className="pop-label">
              Góc Camera 3D &amp; Tỷ lệ Độ cao ({verticalScale === 1 ? '1:1 Thực' : `${verticalScale.toFixed(2).replace(/0$/, '')}x`})
            </span>
            <div className="chip-row">
              <button
                type="button"
                className={cameraMode === 'orbit' ? 'active' : ''}
                onClick={() => setCameraMode('orbit')}
              >
                🦅 Xoay Tự Do
              </button>
              <button
                type="button"
                className={cameraMode === 'chase' ? 'active' : ''}
                onClick={() => setCameraMode('chase')}
              >
                🏃 Bám Sau Lưng
              </button>
              <button
                type="button"
                onClick={() => setVerticalScale((v) => (v < 1.2 ? 1.45 : v < 1.8 ? 2.0 : 1.0))}
              >
                {verticalScale === 1 ? '📐 Tỷ lệ 1:1 Thực' : `⛰️ Độ nổi ${verticalScale.toFixed(2).replace(/\.?0+$/, '')}x`}
              </button>
              <button
                type="button"
                className={forceLandscape ? 'active' : ''}
                onClick={handleToggleForceLandscape}
              >
                {forceLandscape ? '↔️ Khóa Nằm Ngang' : '📱 Xoay Theo Máy'}
              </button>
            </div>
          </div>

          {viewMode !== '3d' && (
            <div className="pop-section">
              <span className="pop-label">Lớp Bản Đồ 2D</span>
              <div className="chip-row">
                <button
                  type="button"
                  className={map2DStyle === 'google-hybrid' ? 'active' : ''}
                  onClick={() => setMap2DStyle('google-hybrid')}
                >
                  Google Hybrid
                </button>
                <button
                  type="button"
                  className={map2DStyle === 'google-terrain' ? 'active' : ''}
                  onClick={() => setMap2DStyle('google-terrain')}
                >
                  Google Địa hình
                </button>
                <button
                  type="button"
                  className={map2DStyle === 'opentopo' ? 'active' : ''}
                  onClick={() => setMap2DStyle('opentopo')}
                >
                  OpenTopo
                </button>
                <button
                  type="button"
                  className={map2DStyle === 'offline-vector' ? 'active' : ''}
                  onClick={() => setMap2DStyle('offline-vector')}
                >
                  Thuần Vector
                </button>
                <button
                  type="button"
                  className={tacticalTone2D ? 'active' : ''}
                  onClick={() => setTacticalTone2D((v) => !v)}
                >
                  🎯 Lọc màu Chiến thuật
                </button>
              </div>
            </div>
          )}

          <div className="pop-section">
            <span className="pop-label">4 Tuyến Trail Chuẩn & 281 Đường Mòn Rừng</span>
            <div className="chip-row">
              {dataset.routes.map((r) => {
                const chipCol = resolveRouteColor(r.id, r.color, palette);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={visibleRoutes[r.id] !== false ? 'active' : ''}
                    style={{ borderColor: chipCol }}
                    onClick={() =>
                      setVisibleRoutes((prev) => ({ ...prev, [r.id]: prev[r.id] === false }))
                    }
                  >
                    <span style={{ color: chipCol }}>●</span> {r.shortLabel}
                  </button>
                );
              })}
              <button
                type="button"
                className={showAllTrails ? 'active' : ''}
                onClick={() => setShowAllTrails((v) => !v)}
              >
                🕸️ 281 Lối mòn phụ
              </button>
              <button
                type="button"
                className={showPois ? 'active' : ''}
                onClick={() => setShowPois((v) => !v)}
              >
                ⛩️ Chùa & Đỉnh
              </button>
            </div>
          </div>
        </div>
        </>
      )}

      {/* MAIN VIEWPORT (3D Three.js / Split / 2D Hybrid Google Maps) */}
      <main className={`viewport-stage mode-${viewMode}`}>
        {(viewMode === '3d' || viewMode === 'split') && (
          <div className="pane-3d">
            <Terrain3DView
              dataset={dataset}
              skin={skin3D}
              cameraMode={cameraMode}
              verticalScale={verticalScale}
              visibleRoutes={visibleRoutes}
              showAllTrails={showAllTrails}
              showPois={showPois}
              hidePoiBadges={zenMode}
              playerLat={playerLat}
              playerLon={playerLon}
              playerEle={playerEle}
              playerAccuracy={playerAccuracy}
              compassHeading={compassHeading}
              gpsCourse={gpsCourse}
              speedMps={speedMps}
              userPins={userPins}
              trackPoints={trackPoints}
              importedGpx={importedGpx}
              lockedTarget={lockedTarget}
              lockedBearing={lockedBearing}
              activeRoute={activeRoute}
              isSimMode={isSimMode}
              syntheticLandscape={syntheticLandscape}
              headingUp={headingUp}
              palette={palette}
              isSuspended={showToolkitModal || showCompassModal}
              onToggleHeadingUp={handleToggleHeadingUp}
              onMapInteractionChange={setIsMapDragging}
              flyToTrigger={flyToTrigger}
              onSelectTarget={handleSelectTarget}
              onSelectUserPin={handleSelectUserPin}
              onRequestPinAt={handleRequestPinAt}
              onSimMoveTo={handleSimMoveTo}
              onStartGtaRoute={handleStartGtaRoute}
            />
          </div>
        )}

        {(viewMode === '2d' || viewMode === 'split') && (
          <div className="pane-2d">
            <Hybrid2DMap
              dataset={dataset}
              mapStyle={map2DStyle}
              visibleRoutes={visibleRoutes}
              showAllTrails={showAllTrails}
              showPois={showPois}
              playerLat={playerLat}
              playerLon={playerLon}
              playerAccuracy={playerAccuracy}
              compassHeading={compassHeading}
              gpsCourse={gpsCourse}
              userPins={userPins}
              trackPoints={trackPoints}
              importedGpx={importedGpx}
              lockedTarget={lockedTarget}
              lockedBearing={lockedBearing}
              activeRoute={activeRoute}
              isSimMode={isSimMode}
              syntheticLandscape={syntheticLandscape}
              headingUp={headingUp}
              tacticalTone={tacticalTone2D}
              palette={palette}
              onToggleHeadingUp={handleToggleHeadingUp}
              onMapInteractionChange={setIsMapDragging}
              flyToTrigger={flyToTrigger}
              onSelectTarget={handleSelectTarget}
              onSelectUserPin={handleSelectUserPin}
              onRequestPinAt={handleRequestPinAt}
              onSimMoveTo={handleSimMoveTo}
              onStartGtaRoute={handleStartGtaRoute}
            />
          </div>
        )}
      </main>

      {/* LIVE FLOATING 360° COMPASS WIDGET, LEFT DIRECTION ARROW & WGS84 TACTICAL TAG (Hidden in Zen Mode) */}
      {!zenMode && (
        <>
          <LeftEdgeDirectionArrow
            compassHeading={compassHeading}
            gpsCourse={gpsCourse}
            headingUp={headingUp}
            lockedTarget={lockedTarget}
            activeRoute={activeRoute}
            playerLat={playerLat}
            playerLon={playerLon}
            onAlignDirection={() => {
              triggerFlyTo(playerLat, playerLon);
              handleToggleHeadingUp();
            }}
          />
          <div className="tactical-coord-tag" aria-hidden="true">
            WGS84 • {playerLat.toFixed(5)}N {playerLon.toFixed(5)}E
          </div>
          <FloatingCompassWidget
            compassHeading={compassHeading}
            gpsCourse={gpsCourse}
            lockedTarget={lockedTarget}
            lockedBearing={lockedBearing}
            playerLat={playerLat}
            playerLon={playerLon}
            hasMagneticWarning={Boolean(magneticWarningReason)}
            onOpenFullCompass={() => setShowCompassModal(true)}
          />
        </>
      )}

      {/* INTERACTIVE FIELD SIMULATOR CONTROL BAR (For Testing on Web before going to Nui Dinh!) */}
      {simDrawerOpen && (
        <div className="sim-floating-drawer">
          <div className="sim-drawer-top">
            <div>
              <strong>🎮 Bảng Điều Khiển Test Thực Địa Núi Dinh</strong>
              <span className="mono-sub">{gpsStatusMsg}</span>
            </div>
            <button type="button" className="icon-close-btn" onClick={() => setSimDrawerOpen(false)}>
              ✕
            </button>
          </div>

          <div className="sim-mode-switch">
            <button
              type="button"
              className={isSimMode ? 'active' : ''}
              onClick={() => {
                setSimAutoWalk(false);
                setTrackPoints([]);
                setDismissedOutGpsHint(false);
                setIsSimMode(true);
              }}
            >
              🎮 Giả Lập Trên Núi Dinh (Test Web)
            </button>
            <button
              type="button"
              className={!isSimMode ? 'active' : ''}
              onClick={() => {
                setSimAutoWalk(false);
                setTrackPoints([]);
                setDismissedOutGpsHint(false);
                setIsSimMode(false);
              }}
            >
              🛰️ Bật GPS Thật Của Máy
            </button>
          </div>

          <div className="gps-diag-card">
            <div className="gps-diag-head">
              <strong>📡 Chẩn đoán GPS Thực địa Thứ 7</strong>
              <span className={`gps-perm-tag perm-${gpsPermState}`}>
                {gpsPermState === 'granted'
                  ? 'ĐÃ CẤP QUYỀN'
                  : gpsPermState === 'denied'
                    ? 'BỊ TỪ CHỐI'
                    : gpsPermState === 'prompt'
                      ? 'CHỜ XÁC NHẬN'
                      : 'SẴN SÀNG'}
              </span>
            </div>
            <div className="gps-diag-grid">
              <span>
                Tọa độ: <b>{playerLat.toFixed(5)}, {playerLon.toFixed(5)}</b>
              </span>
              <span>
                Sai số: <b>{playerAccuracy !== null ? `±${Math.round(playerAccuracy)}m` : '--'}</b> • Fix:{' '}
                <b>{gpsFixCount}</b>
              </span>
              <span>
                Cách Đỉnh La Bàn:{' '}
                <b>{formatDistance(haversineDistanceM(playerLat, playerLon, 10.53875, 107.12942))}</b>
              </span>
              <span>
                Cập nhật:{' '}
                <b>
                  {lastGpsFixTime
                    ? `${Math.max(0, Math.round((Date.now() - lastGpsFixTime) / 1000))}s trước`
                    : 'Chưa nhận fix thật'}
                </b>
              </span>
            </div>
            {gpsPrecisionNote && <div className="gps-diag-note">{gpsPrecisionNote}</div>}
            <div className="gps-diag-actions">
              <button
                type="button"
                onClick={() => {
                  if (isSimMode) {
                    setSimAutoWalk(false);
                    setTrackPoints([]);
                    setDismissedOutGpsHint(false);
                    setIsSimMode(false);
                  } else {
                    manualGpsRefreshRef.current?.();
                    triggerToast('🛰️ Đang làm mới tín hiệu vệ tinh GNSS...');
                  }
                }}
              >
                {isSimMode ? '🛰️ Chuyển sang Bắt GPS Thật Ngay' : '🔄 Bắt Lại Vệ Tinh GNSS'}
              </button>
            </div>
          </div>

          {isSimMode && (
            <>
              <div className="sim-compass-row">
                <label>Xoay hướng cầm điện thoại (La bàn): {compassHeading}°</label>
                <input
                  type="range"
                  min={0}
                  max={359}
                  value={compassHeading}
                  onChange={(e) => setCompassHeading(Number(e.target.value))}
                />
              </div>

              <div className="sim-presets-row">
                {SIM_PRESETS.map((sp) => (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={() => {
                      setSimAutoWalk(false);
                      setPlayerLat(sp.lat);
                      setPlayerLon(sp.lon);
                      triggerFlyTo(sp.lat, sp.lon);
                    }}
                  >
                    {sp.label}
                  </button>
                ))}
              </div>

              <div className="sim-walk-actions">
                <button
                  type="button"
                  className={`sim-autowalk-btn ${simAutoWalk ? 'running' : ''}`}
                  onClick={() => setSimAutoWalk((v) => !v)}
                >
                  {simAutoWalk ? '⏸️ Dừng tự chạy trên Red Route' : '▶️ Tự động leo thử Red Route'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTrackPoints([]);
                    triggerToast('Đã xóa vết chân thử nghiệm');
                  }}
                >
                  🧹 Xóa vết chân
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* TOAST FEEDBACK */}
      {toastMsg && <div className="tactical-toast">{toastMsg}</div>}

      {/* SPEC-OPS SINGLE-LINE BOTTOM COMMAND DOCK */}
      <nav className={`bottom-thumb-dock ${zenMode ? 'zen-dock' : ''}`}>
        {zenMode ? (
          <>
            <span className="zen-tele-readout">
              <TacticalClock compact /> •{' '}
              {String(((Math.round(compassHeading) % 360) + 360) % 360).padStart(3, '0')}°
            </span>
            <button
              type="button"
              className="dock-primary-pin-btn"
              onPointerDown={handleInstantPoopOrRockDrop}
            >
              <span className="pin-main-txt">+ GHIM</span>
            </button>
            <button type="button" className="dock-btn" onClick={() => setZenMode(false)}>
              <span className="dock-lbl">MỞ HUD</span>
            </button>
          </>
        ) : (
          <>
            <button type="button" className="dock-btn" onClick={() => setShowPinsSheet(true)}>
              <span className="dock-lbl">MỐC ({userPins.length})</span>
            </button>

            <button
              type="button"
              className={`dock-btn ${isRecordingTrack ? 'rec-active' : ''}`}
              onClick={handleBacktrackStart}
              onContextMenu={(e) => {
                e.preventDefault();
                setIsRecordingTrack((v) => !v);
              }}
            >
              <span className="dock-lbl">NGƯỢC</span>
            </button>

            {/* PRIMARY 1-TAP TACTICAL PIN BUTTON */}
            <button
              type="button"
              className="dock-primary-pin-btn"
              onPointerDown={handleInstantPoopOrRockDrop}
            >
              <span className="pin-main-txt">+ GHIM</span>
            </button>

            <button
              type="button"
              className="dock-btn"
              onClick={() => {
                setToolkitInitialTab('decode');
                setShowToolkitModal(true);
              }}
            >
              <span className="dock-lbl">CÔNG CỤ</span>
            </button>

            <button
              type="button"
              className={`dock-btn ${simDrawerOpen || !isSimMode ? 'gps-live' : ''}`}
              onClick={() => setSimDrawerOpen((v) => !v)}
            >
              <span className="dock-lbl">{isSimMode ? 'TEST' : 'GPS'}</span>
            </button>
          </>
        )}
      </nav>

      {/* MODALS & SHEETS */}
      {pendingPinCoords && (
        <QuickPinModal
          lat={pendingPinCoords.lat}
          lon={pendingPinCoords.lon}
          ele={pendingPinCoords.ele}
          accuracy={playerAccuracy}
          pinCount={userPins.length}
          onSave={handleSavePin}
          onClose={() => setPendingPinCoords(null)}
        />
      )}

      {showPinsSheet && (
        <PinsAndPoisSheet
          dataset={dataset}
          userPins={userPins}
          playerLat={playerLat}
          playerLon={playerLon}
          lockedTarget={lockedTarget}
          onSelectTarget={setLockedTarget}
          onFlyTo={(lat, lon) => triggerFlyTo(lat, lon)}
          onVerifySatellite={(lat, lon, name) => {
            setViewMode('split');
            setMap2DStyle('google-hybrid');
            triggerFlyTo(lat, lon, 18);
            triggerToast(`🛰️ Đang đối chiếu Vệ tinh Google (Zoom 18): ${name}`);
          }}
          onDeletePin={(id) => {
            setUserPins((prev) => prev.filter((p) => p.id !== id));
            if (lockedTarget?.id === id) setLockedTarget(null);
          }}
          onClose={() => setShowPinsSheet(false)}
        />
      )}

      {showToolkitModal && (
        <ReconToolkitModal
          dataset={dataset}
          initialTab={toolkitInitialTab}
          initialAvailableOta={availableOta}
          initialApkUrl={apkReleaseUrl}
          playerLat={playerLat}
          playerLon={playerLon}
          playerAccuracy={playerAccuracy}
          compassHeading={compassHeading}
          pitchDeg={pitchDeg}
          rollDeg={rollDeg}
          useRealSensor={useRealCompassSensor || !isSimMode}
          lockedTarget={lockedTarget}
          onToggleRealSensor={handleToggleRealCompass}
          trackPoints={trackPoints}
          userPins={userPins}
          importedGpx={importedGpx}
          lockedBearing={lockedBearing}
          activeRoute={activeRoute}
          cachedTileCount={cachedTileCount}
          onRefreshTileCount={refreshTileCount}
          onCreateSolvedPin={handleSavePin}
          onImportGpx={(gpx, wptPins) => {
            setImportedGpx((prev) => [...prev, gpx]);
            if (wptPins.length > 0) setUserPins((prev) => [...wptPins, ...prev]);
            triggerToast(`📂 Đã nạp lộ trình GPX "${gpx.name}" (${gpx.points.length} điểm)!`);
          }}
          onRestoreBackup={handleRestoreBackup}
          onFlyTo={triggerFlyTo}
          onClose={() => setShowToolkitModal(false)}
        />
      )}

      {showPrecisionRadar && lockedTarget && (
        <PrecisionHomingOverlay
          target={lockedTarget}
          playerLat={playerLat}
          playerLon={playerLon}
          playerEle={playerEle}
          compassHeading={compassHeading}
          onUnlock={() => {
            setLockedTarget(null);
            handleClearGtaRoute();
          }}
          onClose={() => setShowPrecisionRadar(false)}
        />
      )}

      {showCompassModal && (
        <TacticalCompassModal
          dataset={dataset}
          playerLat={playerLat}
          playerLon={playerLon}
          playerEle={playerEle}
          compassHeading={compassHeading}
          gpsCourse={gpsCourse}
          speedMps={speedMps}
          pitchDeg={pitchDeg}
          rollDeg={rollDeg}
          useRealSensor={useRealCompassSensor || !isSimMode}
          sensorSupported={'DeviceOrientationEvent' in window}
          lockedBearing={lockedBearing}
          lockedTarget={lockedTarget}
          userPins={userPins}
          hasMagneticWarning={Boolean(magneticWarningReason)}
          magneticWarningReason={magneticWarningReason}
          onChangeSimHeading={(deg) => setCompassHeading(deg)}
          onToggleRealSensor={handleToggleRealCompass}
          onChangeLockedBearing={(deg) => {
            setLockedBearing(deg);
            if (deg !== null) {
              triggerToast(`🔒 Đã khóa góc ngắm La Bàn ${deg}° (Tia xanh ngọc trên núi 3D)!`);
            } else {
              triggerToast('🔓 Đã bỏ khóa góc ngắm La Bàn');
            }
          }}
          onSelectTarget={(t) => {
            setLockedTarget(t);
            triggerToast(`🎯 Đã khóa mục tiêu: ${t.name}`);
          }}
          onProjectBearingPin={(pin) => handleSavePin(pin, true)}
          onFlyTo={(lat, lon) => triggerFlyTo(lat, lon)}
          onClose={() => setShowCompassModal(false)}
        />
      )}
    </div>
  );
};
export default App;
