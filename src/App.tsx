import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import rawDataset from './data/nuiDinhDataset.json';
import type {
  Camera3DMode,
  ImportedGpxTrack,
  Map2DStyle,
  NuiDinhDataset,
  SafetyAlert,
  TacticalTarget,
  Terrain3DSkin,
  TrackPoint,
  UserPin,
  ViewMode
} from './types';
import {
  computeBearingDeg,
  evaluateSafetyAlerts,
  formatBearingCardinal,
  formatClockDirection,
  formatDistance,
  haversineDistanceM,
  minDistanceToPowerlinesM,
  sampleDemElevation
} from './utils/geoMath';
import { countCachedTiles, loadPersistedSession, vaultSet } from './utils/offlineVault';
import {
  applyOtaBundle,
  checkGithubOtaUpdate,
  confirmOtaBootSuccess,
  loadOtaSettings,
  type AvailableOtaUpdate
} from './utils/otaUpdater';
import { APP_BUILD_INFO } from './version';
import { Terrain3DView } from './components/Terrain3DView';
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
  TacticalCompassModal,
  TacticalCompassTape
} from './components/CompassSystem';

const dataset = rawDataset as unknown as NuiDinhDataset;

function formatSpecOpsClock(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

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

export const App: React.FC = () => {
  // View & Layer Controls
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [skin3D, setSkin3D] = useState<Terrain3DSkin>('tactical');
  const [cameraMode, setCameraMode] = useState<Camera3DMode>('orbit');
  const [verticalScale, setVerticalScale] = useState<number>(1.55);
  const [map2DStyle, setMap2DStyle] = useState<Map2DStyle>('google-hybrid');
  const [headingUp, setHeadingUp] = useState<boolean>(false);
  const [tacticalTone2D, setTacticalTone2D] = useState<boolean>(true);
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
  const [isSimMode, setIsSimMode] = useState<boolean>(true);
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
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // Tactical Data State (Persisted in IndexedDB!)
  const [userPins, setUserPins] = useState<UserPin[]>([]);
  const [trackPoints, setTrackPoints] = useState<TrackPoint[]>([]);
  const [isRecordingTrack, setIsRecordingTrack] = useState<boolean>(true);
  const [importedGpx, setImportedGpx] = useState<ImportedGpxTrack[]>([]);
  const [lockedTarget, setLockedTarget] = useState<TacticalTarget | null>(null);
  const [lockedBearing, setLockedBearing] = useState<number | null>(null);
  const [cachedTileCount, setCachedTileCount] = useState<number>(0);
  const [vaultHydrated, setVaultHydrated] = useState<boolean>(false);

  // Modals & Popovers
  const [pendingPinCoords, setPendingPinCoords] = useState<{ lat: number; lon: number; ele: number } | null>(null);
  const [showPinsSheet, setShowPinsSheet] = useState<boolean>(false);
  const [showToolkitModal, setShowToolkitModal] = useState<boolean>(false);
  const [toolkitInitialTab, setToolkitInitialTab] = useState<'decode' | 'bearing' | 'offline' | 'ota'>('decode');
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
  const [quickOtaProgress, setQuickOtaProgress] = useState<number | null>(null);
  const [dismissedWarnTitle, setDismissedWarnTitle] = useState<string | null>(null);
  const [expandedSafety, setExpandedSafety] = useState<boolean>(false);
  const [clockText, setClockText] = useState<string>(() => formatSpecOpsClock());
  const [isMapDragging, setIsMapDragging] = useState<boolean>(false);
  const [isHudIdle, setIsHudIdle] = useState<boolean>(false);

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

    const onFirstPointerDown = () => tryLockLandscape();
    window.addEventListener('pointerdown', onFirstPointerDown, { once: true });
    window.addEventListener('resize', syncViewportState);
    window.addEventListener('orientationchange', syncViewportState);

    return () => {
      window.removeEventListener('pointerdown', onFirstPointerDown);
      window.removeEventListener('resize', syncViewportState);
      window.removeEventListener('orientationchange', syncViewportState);
    };
  }, [forceLandscape]);

  // Real-time 24h Military Clock & Auto-Dim Idle HUD
  useEffect(() => {
    const clockTimer = window.setInterval(() => {
      setClockText(formatSpecOpsClock());
    }, 1000);

    let idleTimer: number | null = null;
    const resetIdle = () => {
      setIsHudIdle(false);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setIsHudIdle(true), 6000);
    };
    resetIdle();
    window.addEventListener('pointerdown', resetIdle, { passive: true });

    return () => {
      window.clearInterval(clockTimer);
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      window.removeEventListener('pointerdown', resetIdle);
    };
  }, []);

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

  // 1. Confirm OTA watchdog ready & load Offline Session from IndexedDB on Startup
  useEffect(() => {
    confirmOtaBootSuccess();
    loadPersistedSession()
      .then(({ pins, track, gpxList, lockedTarget: savedTarget, lockedBearing: savedBearing }) => {
        if (pins.length > 0) setUserPins(pins);
        if (track.length > 0) setTrackPoints(track);
        if (gpxList.length > 0) setImportedGpx(gpxList);
        if (savedTarget) setLockedTarget(savedTarget);
        if (savedBearing !== null) setLockedBearing(savedBearing);
      })
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

  // 3a. Real Hardware GNSS WatchPosition (When isSimMode === false)
  useEffect(() => {
    if (isSimMode) {
      setGpsStatusMsg('🎮 Đang bật Giả lập Thực địa Núi Dinh');
      return;
    }

    if (!('geolocation' in navigator)) {
      setGpsStatusMsg('⚠️ Thiết bị không hỗ trợ GPS');
      return;
    }

    setGpsStatusMsg('🛰️ Đang bắt vệ tinh GNSS...');
    let prevPos: { lat: number; lon: number } | null = null;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;
        setPlayerLat(latitude);
        setPlayerLon(longitude);
        setPlayerAccuracy(accuracy);
        setSpeedMps(speed);
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
      },
      (err) => {
        setGpsStatusMsg(`⚠️ Lỗi GPS: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 15000
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isSimMode]);

  // 3b. Real Hardware Magnetometer & Accelerometer Spirit Level (Android deviceorientationabsolute + iOS webkitCompassHeading)
  useEffect(() => {
    if (!useRealCompassSensor && isSimMode) {
      setPitchDeg(0);
      setRollDeg(0);
      return;
    }

    let hasAbsolute = false;
    const getScreenAngle = () =>
      typeof window.screen?.orientation?.angle === 'number' ? window.screen.orientation.angle : 0;

    const remapTiltForOrientation = (beta: number, gamma: number, screenAngle: number) => {
      const normalized = ((Math.round(screenAngle / 90) * 90) % 360 + 360) % 360;
      if (normalized === 90) return { pitch: gamma, roll: -beta };
      if (normalized === 270) return { pitch: -gamma, roll: beta };
      if (normalized === 180) return { pitch: -beta, roll: -gamma };
      return { pitch: beta, roll: gamma };
    };

    const pushFilteredHeading = (rawDeg: number) => {
      const prev = smoothHeadingRef.current;
      const delta = ((rawDeg - prev + 540) % 360) - 180;
      const next = (prev + delta * 0.28 + 360) % 360;
      smoothHeadingRef.current = next;
      if (Math.abs(delta) >= 0.35) {
        setCompassHeading(Math.round(next * 2) / 2);
      }
    };

    const handleAbsoluteOrientation = (ev: DeviceOrientationEvent) => {
      const angle = syntheticLandscapeRef.current ? 90 : getScreenAngle();
      if (ev.alpha !== null && !Number.isNaN(ev.alpha)) {
        hasAbsolute = true;
        const raw = (360 - ev.alpha + angle) % 360;
        pushFilteredHeading((raw + 360) % 360);
      }
      if (ev.beta !== null || ev.gamma !== null) {
        const { pitch, roll } = remapTiltForOrientation(ev.beta ?? 0, ev.gamma ?? 0, angle);
        setPitchDeg(pitch);
        setRollDeg(roll);
      }
    };

    const handleRelativeOrWebkit = (ev: DeviceOrientationEvent) => {
      const angle = syntheticLandscapeRef.current ? 90 : getScreenAngle();
      if (ev.beta !== null || ev.gamma !== null) {
        const { pitch, roll } = remapTiltForOrientation(ev.beta ?? 0, ev.gamma ?? 0, angle);
        setPitchDeg(pitch);
        setRollDeg(roll);
      }

      const webkitH = (ev as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof webkitH === 'number' && !Number.isNaN(webkitH)) {
        pushFilteredHeading((((webkitH + angle) % 360) + 360) % 360);
      } else if (!hasAbsolute && ev.alpha !== null) {
        const raw = (360 - ev.alpha + angle) % 360;
        pushFilteredHeading((raw + 360) % 360);
      }
    };

    window.addEventListener(
      'deviceorientationabsolute' as keyof WindowEventMap,
      handleAbsoluteOrientation as EventListener
    );
    window.addEventListener('deviceorientation', handleRelativeOrWebkit);

    return () => {
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
      if (!useRealCompassSensor) {
        void handleToggleRealCompass(true);
      } else {
        triggerToast('🧭 Đang xoay bản đồ theo hướng điện thoại (Heading-Up)');
      }
    } else {
      triggerToast('⬆️ Đã khóa bản đồ chuẩn hướng Bắc');
    }
  }, [headingUp, useRealCompassSensor, handleToggleRealCompass, triggerToast]);

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
  // Smooth walk to clicked 3D/2D destination in Simulator mode
  const handleSimMoveTo = useCallback(
    (destLat: number, destLon: number) => {
      if (simMoveIntervalRef.current) {
        window.clearInterval(simMoveIntervalRef.current);
      }
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
    [playerLat, playerLon]
  );

  // 5. Record Breadcrumb Tracklog Automatically when Player Moves > 4m
  useEffect(() => {
    if (!vaultHydrated || !isRecordingTrack) return;
    setTrackPoints((prev) => {
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        const dist = haversineDistanceM(last.lat, last.lon, playerLat, playerLon);
        if (dist < 4.0) return prev;
      }
      const nextPt: TrackPoint = {
        lat: playerLat,
        lon: playerLon,
        ele: playerEle,
        accuracy: playerAccuracy,
        speedMps,
        gpsCourse,
        timestamp: Date.now()
      };
      return [...prev, nextPt];
    });
  }, [vaultHydrated, playerLat, playerLon, playerEle, playerAccuracy, speedMps, gpsCourse, isRecordingTrack]);

  // Total Tracked Distance
  const totalTrackDistanceM = useMemo(() => {
    let sum = 0;
    for (let i = 1; i < trackPoints.length; i++) {
      sum += haversineDistanceM(
        trackPoints[i - 1].lat,
        trackPoints[i - 1].lon,
        trackPoints[i].lat,
        trackPoints[i].lon
      );
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

  return (
    <div
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

            <span className="tactical-clock-chip" title="Đồng hồ tác chiến 24h">
              {clockText}
            </span>

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
              className={`hud-icon-btn ${headingUp ? 'active' : ''}`}
              onClick={handleToggleHeadingUp}
              title={
                headingUp
                  ? 'Đang xoay bản đồ theo hướng điện thoại (Bấm để khóa về hướng Bắc)'
                  : 'Bật xoay bản đồ theo hướng điện thoại (Heading-Up)'
              }
            >
              🧭
            </button>

            <button
              type="button"
              className={`hud-icon-btn ${showLayerPopover ? 'active' : ''}`}
              onClick={() => setShowLayerPopover((v) => !v)}
              title="Bật/tắt lớp địa hình, vệ tinh & 4 tuyến trail"
            >
              🎛️<span className="hide-narrow-txt"> Lớp</span>
            </button>

            <button
              type="button"
              className={`hud-icon-btn ${forceLandscape ? 'active' : ''}`}
              onClick={handleToggleForceLandscape}
              title={
                forceLandscape
                  ? 'Đang mặc định nằm ngang (Chạm để mở xoay dọc)'
                  : 'Bấm để xoay ngang toàn màn hình'
              }
            >
              ↔️
            </button>

            <button
              type="button"
              className={`hud-icon-btn ${zenMode ? 'active' : ''}`}
              onClick={() => setZenMode((v) => !v)}
              title={zenMode ? 'Hiện lại thanh chỉ số HUD' : 'Thu gọn tối đa HUD (Sạch bản đồ)'}
            >
              {zenMode ? '👁️‍🗨️' : '👁️'}
            </button>
          </div>
        </div>

        {/* CENTERED NARROW SUB-PILLS (Only shown when active) */}
        <div className="hud-sub-pills">
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

          {lockedTarget && homingMetrics && (
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
            <span className="pop-label">Góc Camera 3D & Độ nổi khối núi ({verticalScale.toFixed(1)}x)</span>
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
                onClick={() => setVerticalScale((v) => (v < 1.3 ? 1.55 : v < 1.9 ? 2.15 : 1.05))}
              >
                ⛰️ Độ nổi {verticalScale.toFixed(1)}x
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
              {dataset.routes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={visibleRoutes[r.id] !== false ? 'active' : ''}
                  style={{ borderColor: r.color }}
                  onClick={() =>
                    setVisibleRoutes((prev) => ({ ...prev, [r.id]: prev[r.id] === false }))
                  }
                >
                  <span style={{ color: r.color }}>●</span> {r.shortLabel}
                </button>
              ))}
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
              isSimMode={isSimMode}
              syntheticLandscape={syntheticLandscape}
              headingUp={headingUp}
              onToggleHeadingUp={handleToggleHeadingUp}
              onMapInteractionChange={setIsMapDragging}
              flyToTrigger={flyToTrigger}
              onSelectTarget={(t) => {
                setLockedTarget(t);
                triggerToast(`🎯 Đã khóa mục tiêu: ${t.name}`);
              }}
              onSelectUserPin={handleSelectUserPin}
              onRequestPinAt={(lat, lon, ele) => setPendingPinCoords({ lat, lon, ele })}
              onSimMoveTo={handleSimMoveTo}
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
              isSimMode={isSimMode}
              syntheticLandscape={syntheticLandscape}
              headingUp={headingUp}
              tacticalTone={tacticalTone2D}
              onToggleHeadingUp={handleToggleHeadingUp}
              onMapInteractionChange={setIsMapDragging}
              flyToTrigger={flyToTrigger}
              onSelectTarget={(t) => {
                setLockedTarget(t);
                triggerToast(`🎯 Đã khóa mục tiêu: ${t.name}`);
              }}
              onSelectUserPin={handleSelectUserPin}
              onRequestPinAt={(lat, lon, ele) => setPendingPinCoords({ lat, lon, ele })}
              onSimMoveTo={handleSimMoveTo}
            />
          </div>
        )}
      </main>

      {/* LIVE FLOATING 360° COMPASS WIDGET & WGS84 TACTICAL TAG (Hidden in Zen Mode) */}
      {!zenMode && (
        <>
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
              onClick={() => setIsSimMode(true)}
            >
              🎮 Giả Lập Trên Núi Dinh (Test Web)
            </button>
            <button
              type="button"
              className={!isSimMode ? 'active' : ''}
              onClick={() => {
                setSimAutoWalk(false);
                setIsSimMode(false);
              }}
            >
              🛰️ Bật GPS Thật Của Máy
            </button>
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
              {clockText.slice(0, 5)} •{' '}
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
          trackPoints={trackPoints}
          userPins={userPins}
          cachedTileCount={cachedTileCount}
          onRefreshTileCount={refreshTileCount}
          onCreateSolvedPin={handleSavePin}
          onImportGpx={(gpx, wptPins) => {
            setImportedGpx((prev) => [...prev, gpx]);
            if (wptPins.length > 0) setUserPins((prev) => [...wptPins, ...prev]);
            triggerToast(`📂 Đã nạp lộ trình GPX "${gpx.name}" (${gpx.points.length} điểm)!`);
          }}
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
          onUnlock={() => setLockedTarget(null)}
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
