import React, { useEffect, useState } from 'react';
import type {
  ImportedGpxTrack,
  NuiDinhDataset,
  PinCategory,
  TacticalTarget,
  TrackPoint,
  UserPin
} from '../types';
import {
  buildGpxExport,
  computeBearingDeg,
  formatBearingCardinal,
  formatClockDirection,
  formatDistance,
  haversineDistanceM,
  parseGpxText,
  sampleDemElevation
} from '../utils/geoMath';
import { compressImageFile, downloadNuiDinhOfflineTiles } from '../utils/offlineVault';
import { CipherDecoderPanel } from './CipherDecoderPanel';
import { EngineeringToolkitPanel } from './EngineeringToolkitPanel';
import { TacticalSightingPanel, type PinRequestPayload } from './TacticalSightingPanel';
import {
  applyOtaBundle,
  checkGithubOtaUpdate,
  getCurrentOtaRuntimeInfo,
  loadOtaSettings,
  rollbackToBuiltinApkBundle,
  saveOtaSettings,
  syncFromLaptopLan,
  type AvailableOtaUpdate,
  type OtaRuntimeInfo
} from '../utils/otaUpdater';
import { APP_BUILD_INFO } from '../version';

export const PIN_CATEGORIES: { id: PinCategory; emoji: string; label: string; defaultTitle: string }[] = [
  { id: 'rock', emoji: '🪨', label: 'Cục đá / Dấu vết', defaultTitle: 'Cục đá đánh dấu' },
  { id: 'poop', emoji: '💩', label: 'Bãi kỷ niệm', defaultTitle: 'Bãi tại cục đá' },
  { id: 'checkpoint', emoji: '🚩', label: 'Trạm BTC', defaultTitle: 'Checkpoint BTC' },
  { id: 'clue', emoji: '🧩', label: 'Mật thư / Manh mối', defaultTitle: 'Điểm mật thư' },
  { id: 'cache', emoji: '🎒', label: 'Giấu đồ / Trạm nghỉ', defaultTitle: 'Điểm cất đồ' },
  { id: 'water', emoji: '💧', label: 'Nguồn nước suối', defaultTitle: 'Điểm lấy nước' },
  { id: 'deadend', emoji: '⚠️', label: 'Ngã rẽ sai / Cụm ống', defaultTitle: 'Cảnh báo đường cụt' }
];

interface QuickPinModalProps {
  lat: number;
  lon: number;
  ele: number;
  accuracy: number | null;
  pinCount: number;
  onSave: (pin: UserPin, lockImmediately: boolean) => void;
  onClose: () => void;
}

export const QuickPinModal: React.FC<QuickPinModalProps> = ({
  lat,
  lon,
  ele,
  accuracy,
  pinCount,
  onSave,
  onClose
}) => {
  const [category, setCategory] = useState<PinCategory>('rock');
  const [name, setName] = useState(`Cục đá #${pinCount + 1}`);
  const [note, setNote] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>(undefined);
  const [compressing, setCompressing] = useState(false);

  const handleCategoryChange = (cat: PinCategory) => {
    setCategory(cat);
    const meta = PIN_CATEGORIES.find((c) => c.id === cat)!;
    if (name.includes('#')) {
      setName(`${meta.defaultTitle} #${pinCount + 1}`);
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    try {
      const dataUrl = await compressImageFile(file);
      setPhotoDataUrl(dataUrl);
    } finally {
      setCompressing(false);
    }
  };

  const commitPin = (lockAfter: boolean) => {
    if (navigator.vibrate) navigator.vibrate([18, 30, 24]);
    const newPin: UserPin = {
      id: `pin-${Date.now()}`,
      name: name.trim() || `Điểm ghim #${pinCount + 1}`,
      category,
      lat,
      lon,
      ele: Math.round(ele),
      accuracy,
      createdAt: Date.now(),
      note: note.trim(),
      photoDataUrl
    };
    onSave(newPin, lockAfter);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="tactical-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div>
            <h3>⚡ Ghim Tọa Độ Offline Tức Thì</h3>
            <p className="mono-sub">
              {lat.toFixed(6)}, {lon.toFixed(6)} • Cao {Math.round(ele)}m{' '}
              {accuracy ? `• ±${Math.round(accuracy)}m` : ''}
            </p>
          </div>
          <button type="button" className="icon-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="pin-cat-grid">
          {PIN_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`pin-cat-chip ${category === c.id ? 'active' : ''}`}
              onClick={() => handleCategoryChange(c.id)}
            >
              <span className="cat-emoji">{c.emoji}</span>
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <div className="form-group">
          <label>Tên gợi nhớ nhanh</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="VD: Cục đá chẻ đôi cạnh gốc đa..."
          />
        </div>

        <div className="form-group">
          <label>Ghi chú đặc điểm nhận diện (Offline)</label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="VD: Giấu chai nước sau hốc đá bên trái suối..."
          />
        </div>

        <div className="photo-attach-row">
          <label className="camera-upload-btn">
            <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} hidden />
            📷 {compressing ? 'Đang nén ảnh...' : photoDataUrl ? 'Đổi ảnh chụp cục đá' : 'Chụp ảnh thực tế tại chỗ'}
          </label>
          {photoDataUrl && (
            <div className="photo-thumb-preview">
              <img src={photoDataUrl} alt="Ảnh điểm ghim" />
              <button type="button" onClick={() => setPhotoDataUrl(undefined)}>
                ✕
              </button>
            </div>
          )}
        </div>

        <div className="sheet-dual-actions">
          <button type="button" className="secondary-action-btn" onClick={() => commitPin(false)}>
            💾 Lưu điểm ghim
          </button>
          <button type="button" className="primary-action-btn" onClick={() => commitPin(true)}>
            🎯 Lưu & Khóa Radar dẫn đường
          </button>
        </div>
      </div>
    </div>
  );
};

interface PinsAndPoisSheetProps {
  dataset: NuiDinhDataset;
  userPins: UserPin[];
  playerLat: number;
  playerLon: number;
  lockedTarget: TacticalTarget | null;
  onSelectTarget: (target: TacticalTarget) => void;
  onFlyTo: (lat: number, lon: number) => void;
  onVerifySatellite: (lat: number, lon: number, name: string) => void;
  onDeletePin: (id: string) => void;
  onClose: () => void;
}

export const PinsAndPoisSheet: React.FC<PinsAndPoisSheetProps> = ({
  dataset,
  userPins,
  playerLat,
  playerLon,
  lockedTarget,
  onSelectTarget,
  onFlyTo,
  onVerifySatellite,
  onDeletePin,
  onClose
}) => {
  const [tab, setTab] = useState<'mine' | 'hazards' | 'hubs' | 'peaks' | 'temples' | 'water'>('hubs');
  const [query, setQuery] = useState('');
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  const hazardCount = dataset.pois.filter((p) => p.category === 'warning').length;
  const hubCount = dataset.pois.filter((p) => p.category === 'junction' || p.category === 'camp').length;
  const gpsVerifiedCount = dataset.pois.filter((p) => p.confidence === 'verified-gps').length;
  const demVerifiedCount = dataset.pois.filter((p) => p.confidence === 'verified-dem').length;
  const zoneApproxCount = dataset.pois.filter((p) => p.confidence === 'zone-approx').length;

  const filteredPois = dataset.pois
    .filter((p) => {
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.note.toLowerCase().includes(q) ||
          (p.source && p.source.toLowerCase().includes(q))
        );
      }
      if (tab === 'hazards') return p.category === 'warning';
      if (tab === 'hubs') return p.category === 'junction' || p.category === 'camp';
      if (tab === 'peaks') return p.category === 'peak' || p.category === 'viewpoint' || p.category === 'boulder';
      if (tab === 'temples') return p.category === 'temple' || p.category === 'historic';
      if (tab === 'water') return p.category === 'water';
      return true;
    })
    .map((p) => ({
      ...p,
      dist: haversineDistanceM(playerLat, playerLon, p.lat, p.lon),
      brng: computeBearingDeg(playerLat, playerLon, p.lat, p.lon)
    }))
    .sort((a, b) => a.dist - b.dist);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="tactical-sheet tall-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div>
            <h3>📍 Kho Điểm Đã Ghim & {dataset.pois.length} Cột Mốc Đã Kiểm Định</h3>
            <p className="mono-sub">
              {userPins.length} điểm bạn ghim • {dataset.pois.length} mốc thực địa kèm nhãn độ sai số GPS/Vệ tinh
            </p>
          </div>
          <button type="button" className="icon-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="audit-summary-bar">
          <span className="conf-pill conf-gps">🟢 {gpsVerifiedCount} Chuẩn GPS/OSM (±5–20m)</span>
          <span className="conf-pill conf-dem">🔵 {demVerifiedCount} Chuẩn Radar SRTM (±30m)</span>
          <span className="conf-pill conf-zone">🟡 {zoneApproxCount} Tâm vùng rừng (±100–150m)</span>
        </div>

        <div className="segmented-tabs">
          <button type="button" className={tab === 'hubs' ? 'active' : ''} onClick={() => setTab('hubs')}>
            🔀 Ngã Rẽ & Trạm ({hubCount})
          </button>
          <button type="button" className={tab === 'hazards' ? 'active' : ''} onClick={() => setTab('hazards')}>
            ⚠️ Nguy Hiểm ({hazardCount})
          </button>
          <button type="button" className={tab === 'peaks' ? 'active' : ''} onClick={() => setTab('peaks')}>
            ⛰️ Đỉnh & Đá
          </button>
          <button type="button" className={tab === 'temples' ? 'active' : ''} onClick={() => setTab('temples')}>
            ⛩️ Chùa & Di Tích
          </button>
          <button type="button" className={tab === 'water' ? 'active' : ''} onClick={() => setTab('water')}>
            🌊 Suối
          </button>
          <button type="button" className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
            🪨 Đã ghim ({userPins.length})
          </button>
        </div>

        {tab !== 'mine' && (
          <input
            className="search-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 Tìm nhanh: Ong Rừng, Cô Kiều, La Bàn, Hang Tổ, Thánh Giá, Suối Đá..."
          />
        )}

        <div className="poi-scroll-list">
          {tab === 'mine' ? (
            userPins.length === 0 ? (
              <div className="empty-box">
                Chưa có điểm ghim nào. Bấm nút <strong>⚡ GHIM CỤC ĐÁ</strong> ngoài màn hình chính hoặc nhấn giữ vào sườn núi 3D để đánh dấu ngay!
              </div>
            ) : (
              userPins.map((pin) => {
                const dist = haversineDistanceM(playerLat, playerLon, pin.lat, pin.lon);
                const brng = computeBearingDeg(playerLat, playerLon, pin.lat, pin.lon);
                const cat = PIN_CATEGORIES.find((c) => c.id === pin.category) || PIN_CATEGORIES[0];
                const isLocked = lockedTarget?.id === pin.id;
                return (
                  <div key={pin.id} className={`poi-row-card ${isLocked ? 'locked-row' : ''}`}>
                    <div className="poi-row-main">
                      <span className="poi-big-emoji">{cat.emoji}</span>
                      <div className="poi-row-info">
                        <strong>{pin.name}</strong>
                        <span className="mono-sub">
                          Cách {formatDistance(dist)} • {formatBearingCardinal(brng)} • Cao {pin.ele}m
                        </span>
                        {pin.note && <p className="poi-note-text">{pin.note}</p>}
                      </div>
                      {pin.photoDataUrl && (
                        <img
                          src={pin.photoDataUrl}
                          alt={pin.name}
                          className="row-photo-mini"
                          onClick={() => setPreviewPhoto(pin.photoDataUrl!)}
                        />
                      )}
                    </div>
                    <div className="poi-row-btns">
                      <button
                        type="button"
                        className="btn-lock"
                        onClick={() => {
                          onSelectTarget({
                            id: pin.id,
                            name: pin.name,
                            lat: pin.lat,
                            lon: pin.lon,
                            ele: pin.ele,
                            category: pin.category,
                            note: pin.note,
                            photoDataUrl: pin.photoDataUrl
                          });
                          onFlyTo(pin.lat, pin.lon);
                          onClose();
                        }}
                      >
                        🎯 Khóa Radar quay lại
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onFlyTo(pin.lat, pin.lon);
                          onClose();
                        }}
                      >
                        👁️ Xem 3D
                      </button>
                      <button type="button" className="btn-del" onClick={() => onDeletePin(pin.id)}>
                        🗑️
                      </button>
                    </div>
                  </div>
                );
              })
            )
          ) : (
            filteredPois.map((poi) => {
              const isLocked = lockedTarget?.id === poi.id;
              const confKind = poi.confidence || 'verified-gps';
              const accM = poi.accuracyM ?? 10;
              return (
                <div key={poi.id} className={`poi-row-card ${isLocked ? 'locked-row' : ''}`}>
                  <div className="poi-row-main">
                    <div className="poi-row-info">
                      <div className="poi-title-line">
                        <strong>
                          {poi.name} {poi.altName ? `(${poi.altName})` : ''}
                        </strong>
                        {confKind === 'verified-gps' && (
                          <span className="conf-pill conf-gps">🟢 Chuẩn GPS/Vệ tinh (±{accM}m)</span>
                        )}
                        {confKind === 'verified-dem' && (
                          <span className="conf-pill conf-dem">🔵 Chuẩn Radar SRTM (±{accM}m)</span>
                        )}
                        {confKind === 'zone-approx' && (
                          <span className="conf-pill conf-zone">🟡 Tâm vùng ước lượng (±{accM}m)</span>
                        )}
                      </div>
                      <span className="mono-sub">
                        Cách {formatDistance(poi.dist)} • {formatBearingCardinal(poi.brng)} • Cao {poi.ele}m •{' '}
                        {poi.lat.toFixed(5)}, {poi.lon.toFixed(5)}
                      </span>
                      <p className="poi-note-text">{poi.note}</p>
                      {poi.source && <span className="poi-source-line">📐 Nguồn: {poi.source}</span>}
                    </div>
                  </div>
                  <div className="poi-row-btns">
                    <button
                      type="button"
                      className="btn-lock"
                      onClick={() => {
                        onSelectTarget({
                          id: poi.id,
                          name: poi.name,
                          lat: poi.lat,
                          lon: poi.lon,
                          ele: poi.ele,
                          category: poi.category,
                          note: poi.note
                        });
                        onFlyTo(poi.lat, poi.lon);
                        onClose();
                      }}
                    >
                      🎯 Dẫn đường
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onFlyTo(poi.lat, poi.lon);
                        onClose();
                      }}
                    >
                      👁️ Bay 3D
                    </button>
                    <button
                      type="button"
                      className="btn-sat-verify"
                      onClick={() => {
                        onVerifySatellite(poi.lat, poi.lon, poi.name);
                        onClose();
                      }}
                      title="Mở chế độ Đôi (3D + Ảnh Vệ Tinh Google Zoom 18) để tự mắt kiểm tra điểm này"
                    >
                      🛰️ Kiểm chứng Vệ tinh
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {previewPhoto && (
          <div className="photo-lightbox" onClick={() => setPreviewPhoto(null)}>
            <img src={previewPhoto} alt="Ảnh thực địa phóng to" />
            <span>Chạm bất kỳ đâu để đóng</span>
          </div>
        )}
      </div>
    </div>
  );
};

interface ReconToolkitModalProps {
  dataset: NuiDinhDataset;
  initialTab?: 'decode' | 'engineering' | 'bearing' | 'offline' | 'ota';
  initialAvailableOta?: AvailableOtaUpdate | null;
  initialApkUrl?: string | null;
  playerLat: number;
  playerLon: number;
  compassHeading?: number;
  pitchDeg?: number;
  rollDeg?: number;
  useRealSensor?: boolean;
  lockedTarget?: TacticalTarget | null;
  onToggleRealSensor?: (enable: boolean) => void;
  trackPoints: TrackPoint[];
  userPins: UserPin[];
  cachedTileCount: number;
  onRefreshTileCount: () => void;
  onCreateSolvedPin: (pin: UserPin, lockTarget: boolean) => void;
  onImportGpx: (gpx: ImportedGpxTrack, waypointsAsPins: UserPin[]) => void;
  onFlyTo: (lat: number, lon: number) => void;
  onClose: () => void;
}

export const ReconToolkitModal: React.FC<ReconToolkitModalProps> = ({
  dataset,
  initialTab = 'decode',
  initialAvailableOta = null,
  initialApkUrl = null,
  playerLat,
  playerLon,
  compassHeading = 0,
  pitchDeg = 0,
  rollDeg = 0,
  useRealSensor = false,
  lockedTarget = null,
  onToggleRealSensor,
  trackPoints,
  userPins,
  cachedTileCount,
  onRefreshTileCount,
  onCreateSolvedPin,
  onImportGpx,
  onFlyTo,
  onClose
}) => {
  const [tab, setTab] = useState<'decode' | 'engineering' | 'bearing' | 'offline' | 'ota'>(initialTab);

  // Offline Tile Downloader State
  const [dlState, setDlState] = useState<{ running: boolean; done: number; total: number; msg?: string }>({
    running: false,
    done: 0,
    total: 0
  });

  // Dual-Channel OTA Updater State (GitHub + Local Laptop Wi-Fi/Hotspot LAN)
  const initialOtaCfg = loadOtaSettings();
  const [runtimeInfo, setRuntimeInfo] = useState<OtaRuntimeInfo | null>(null);
  const [githubRepo, setGithubRepo] = useState<string>(initialOtaCfg.githubRepo);
  const [showRepoEdit, setShowRepoEdit] = useState<boolean>(false);
  const [lanHost, setLanHost] = useState<string>(initialOtaCfg.lanHost);
  const [remoteOta, setRemoteOta] = useState<AvailableOtaUpdate | null>(initialAvailableOta);
  const [apkUrl, setApkUrl] = useState<string | null>(initialApkUrl);
  const [otaBusy, setOtaBusy] = useState<'github-check' | 'github-apply' | 'lan-apply' | 'rollback' | null>(null);
  const [otaProgress, setOtaProgress] = useState<number>(0);
  const [otaStatusMsg, setOtaStatusMsg] = useState<string | null>(null);
  const [otaErrorMsg, setOtaErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (tab !== 'ota') return;
    getCurrentOtaRuntimeInfo().then(setRuntimeInfo).catch(() => {});
  }, [tab]);

  const handleGithubCheckOrApply = async () => {
    setOtaErrorMsg(null);
    saveOtaSettings({ githubRepo: githubRepo.trim() });

    // Step A: If an update is already known and newer, apply immediately!
    if (remoteOta && remoteOta.isNewer) {
      setOtaBusy('github-apply');
      setOtaProgress(8);
      setOtaStatusMsg(`Đang tải gói v${remoteOta.version} (~${Math.max(1, Math.round(remoteOta.sizeBytes / 1024))} KB)...`);
      try {
        const res = await applyOtaBundle({
          bundleUrl: remoteOta.bundleUrl,
          version: remoteOta.version,
          note: remoteOta.note,
          source: 'github',
          sha256: remoteOta.sha256,
          onProgress: (p) => setOtaProgress(p)
        });
        if (!res.appliedNative) {
          setOtaStatusMsg(
            `✅ Đã làm sạch bộ nhớ Web. Trên điện thoại cài APK, gói v${remoteOta.version} sẽ tự hot-swap trong 2 giây mà không cần cài lại APK!`
          );
          window.setTimeout(() => window.location.reload(), 900);
        }
      } catch (err) {
        setOtaErrorMsg(err instanceof Error ? err.message : 'Lỗi tải gói OTA từ GitHub');
      } finally {
        setOtaBusy(null);
      }
      return;
    }

    // Step B: Check GitHub Releases now
    setOtaBusy('github-check');
    setOtaStatusMsg('Đang kiểm tra bản phát hành mới nhất trên GitHub...');
    try {
      const res = await checkGithubOtaUpdate(githubRepo);
      if (res.apkDownloadUrl) setApkUrl(res.apkDownloadUrl);
      if (!res.otaUpdate) {
        setRemoteOta(null);
        setOtaStatusMsg(`Repo "${res.repo}" chưa có bản OTA nào được đẩy (chạy "npm run push-update" trên laptop).`);
      } else {
        setRemoteOta(res.otaUpdate);
        if (res.otaUpdate.isNewer) {
          setOtaStatusMsg(
            `🎉 Phát hiện bản mới v${res.otaUpdate.version} (${Math.max(1, Math.round(res.otaUpdate.sizeBytes / 1024))} KB): ${res.otaUpdate.note}`
          );
        } else {
          setOtaStatusMsg(
            `✅ App đang ở bản mới nhất v${APP_BUILD_INFO.version} (GitHub: v${res.otaUpdate.version}).`
          );
        }
      }
    } catch (err) {
      setOtaErrorMsg(err instanceof Error ? err.message : 'Không kết nối được GitHub');
      setOtaStatusMsg(null);
    } finally {
      setOtaBusy(null);
    }
  };

  const handleForceGithubDownload = async () => {
    if (!remoteOta) return;
    setOtaErrorMsg(null);
    setOtaBusy('github-apply');
    setOtaProgress(10);
    setOtaStatusMsg(`Đang nạp lại gói GitHub v${remoteOta.version}...`);
    try {
      const res = await applyOtaBundle({
        bundleUrl: remoteOta.bundleUrl,
        version: `${remoteOta.version}-${Date.now()}`,
        note: remoteOta.note,
        source: 'github',
        sha256: remoteOta.sha256,
        onProgress: (p) => setOtaProgress(p)
      });
      if (!res.appliedNative) {
        setOtaStatusMsg('✅ Đã đồng bộ cache Web preview.');
      }
    } catch (err) {
      setOtaErrorMsg(err instanceof Error ? err.message : 'Lỗi tải gói OTA');
    } finally {
      setOtaBusy(null);
    }
  };

  const handleLanSync = async () => {
    setOtaErrorMsg(null);
    setOtaBusy('lan-apply');
    setOtaProgress(10);
    setOtaStatusMsg('Đang kết nối Wi-Fi / Hotspot tới Laptop...');
    try {
      const res = await syncFromLaptopLan(lanHost, (p) => setOtaProgress(p));
      if (!res.appliedNative) {
        setOtaStatusMsg(
          `✅ Kết nối Laptop thành công! Phát hiện gói v${res.manifest.version} (${Math.max(1, Math.round((res.manifest.sizeBytes || 0) / 1024))} KB). Mở trên app APK Android để hot-swap trực tiếp!`
        );
      }
    } catch (err) {
      setOtaErrorMsg(
        err instanceof Error
          ? `${err.message}. Nhớ bật "npm run ota:lan" trên laptop và dùng chung Wi-Fi/Hotspot!`
          : 'Lỗi kết nối Laptop'
      );
      setOtaStatusMsg(null);
    } finally {
      setOtaBusy(null);
    }
  };

  const handleRollback = async () => {
    setOtaErrorMsg(null);
    setOtaBusy('rollback');
    try {
      const didReset = await rollbackToBuiltinApkBundle();
      if (!didReset) {
        setOtaStatusMsg('Chức năng khôi phục bản gốc APK chỉ áp dụng khi đang chạy trong app Android APK.');
      }
    } catch (err) {
      setOtaErrorMsg(err instanceof Error ? err.message : 'Không thể khôi phục bản gốc');
    } finally {
      setOtaBusy(null);
    }
  };

  const handlePinDecodedCoord = (lat: number, lon: number, label: string, note: string) => {
    const ele = Math.round(sampleDemElevation(dataset.dem, dataset.bounds, lat, lon));
    const solvedPin: UserPin = {
      id: `clue-${Date.now()}`,
      name: label,
      category: 'clue',
      lat,
      lon,
      ele,
      accuracy: null,
      createdAt: Date.now(),
      note
    };
    onCreateSolvedPin(solvedPin, true);
    onFlyTo(lat, lon);
    onClose();
  };

  const handlePinTargetsFromSighting = (items: PinRequestPayload[], closeModal = true) => {
    if (items.length === 0) return;
    let focusItem = items[items.length - 1];
    for (const item of items) {
      const ele = Math.round(sampleDemElevation(dataset.dem, dataset.bounds, item.lat, item.lon));
      const pin: UserPin = {
        id: `sight-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: item.label,
        category: 'checkpoint',
        lat: item.lat,
        lon: item.lon,
        ele,
        accuracy: null,
        createdAt: Date.now(),
        note: item.note
      };
      onCreateSolvedPin(pin, item.lockTarget ?? items.length === 1);
      if (item.lockTarget) focusItem = item;
    }
    onFlyTo(focusItem.lat, focusItem.lon);
    if (closeModal) onClose();
  };

  const handleGpxFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { trackPoints: pts, waypoints } = parseGpxText(text, dataset.dem, dataset.bounds);
    const gpxObj: ImportedGpxTrack = {
      id: `gpx-${Date.now()}`,
      name: file.name.replace(/\.gpx$/i, ''),
      color: '#BF5AF2',
      points: pts
    };
    const wptPins: UserPin[] = waypoints.map((w, idx) => ({
      id: `gpxwpt-${Date.now()}-${idx}`,
      name: w.name,
      category: 'checkpoint',
      lat: w.lat,
      lon: w.lon,
      ele: w.ele,
      accuracy: null,
      createdAt: Date.now(),
      note: `Nhập từ file GPX ${file.name}`
    }));
    onImportGpx(gpxObj, wptPins);
    if (pts.length > 0) onFlyTo(pts[0][0], pts[0][1]);
    onClose();
  };

  const handleExportGpx = () => {
    const xml = buildGpxExport(trackPoints, userPins);
    const blob = new Blob([xml], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nui-dinh-track-${new Date().toISOString().slice(0, 10)}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startOfflineDownload = async () => {
    setDlState({ running: true, done: 0, total: 1 });
    const res = await downloadNuiDinhOfflineTiles(dataset.bounds, (done, total) => {
      setDlState({ running: true, done, total });
    });
    onRefreshTileCount();
    setDlState({
      running: false,
      done: res.total,
      total: res.total,
      msg: `✅ Đã lưu ${res.saved}/${res.total} mảnh bản đồ Google Vệ Tinh & Địa Hình vào máy! Sẵn sàng rút SIM / Bật chế độ máy bay!`
    });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="tactical-sheet tall-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div>
            <h3>🔐 Mật Thư • Kỹ Thuật • Offline &amp; OTA</h3>
            <p className="mono-sub">Hoạt động 100% không cần mạng khi vào rừng sâu</p>
          </div>
          <button type="button" className="icon-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="segmented-tabs">
          <button type="button" className={tab === 'decode' ? 'active' : ''} onClick={() => setTab('decode')}>
            🔐 Mật Thư
          </button>
          <button
            type="button"
            className={tab === 'engineering' ? 'active' : ''}
            onClick={() => setTab('engineering')}
          >
            🛠️ Kỹ Thuật
          </button>
          <button type="button" className={tab === 'bearing' ? 'active' : ''} onClick={() => setTab('bearing')}>
            🎯 Giao Hội &amp; AR
          </button>
          <button type="button" className={tab === 'offline' ? 'active' : ''} onClick={() => setTab('offline')}>
            📥 Offline
          </button>
          <button type="button" className={tab === 'ota' ? 'active' : ''} onClick={() => setTab('ota')}>
            🔄 OTA
          </button>
        </div>

        {tab === 'decode' && <CipherDecoderPanel onPinCoordinate={handlePinDecodedCoord} />}

        {tab === 'engineering' && (
          <EngineeringToolkitPanel
            pitchDeg={pitchDeg}
            rollDeg={rollDeg}
            useRealSensor={useRealSensor}
            onToggleRealSensor={onToggleRealSensor}
          />
        )}

        {tab === 'bearing' && (
          <TacticalSightingPanel
            dataset={dataset}
            playerLat={playerLat}
            playerLon={playerLon}
            compassHeading={compassHeading}
            pitchDeg={pitchDeg}
            rollDeg={rollDeg}
            useRealSensor={useRealSensor}
            lockedTarget={lockedTarget}
            userPins={userPins}
            onToggleRealSensor={onToggleRealSensor}
            onPinTargets={handlePinTargetsFromSighting}
          />
        )}

        {tab === 'offline' && (
          <div className="toolkit-body">
            <div className="offline-vault-box">
              <div className="vault-stat">
                <strong>📦 Bộ nhớ Bản đồ Offline trong máy:</strong>
                <span>{cachedTileCount} mảnh vệ tinh/địa hình đã lưu</span>
              </div>
              <p className="helper-note">
                281 đường mòn, 4 tuyến màu và địa hình 3D độ cao Núi Dinh <strong>đã được nhúng cứng 100% sẵn trong app</strong>. Bấm nút dưới trước khi lên núi để tải thêm trọn bộ <strong>Ảnh Vệ Tinh Google Hybrid</strong> vào máy dùng khi mất sóng!
              </p>
              {dlState.running ? (
                <div className="dl-progress-wrap">
                  <div className="dl-bar">
                    <div
                      className="dl-fill"
                      style={{ width: `${Math.round((dlState.done / Math.max(1, dlState.total)) * 100)}%` }}
                    />
                  </div>
                  <span className="mono-sub">
                    Đang tải vào máy: {dlState.done} / {dlState.total} mảnh...
                  </span>
                </div>
              ) : (
                <button type="button" className="primary-action-btn full-w" onClick={startOfflineDownload}>
                  🛰️ Tải Ảnh Vệ Tinh Google Núi Dinh Vào Máy (Offline)
                </button>
              )}
              {dlState.msg && <div className="success-box">{dlState.msg}</div>}
            </div>

            <div className="gpx-actions-row">
              <label className="secondary-action-btn file-btn">
                <input type="file" accept=".gpx,.xml" onChange={handleGpxFile} hidden />
                📂 Nhập file .GPX BTC
              </label>
              <button type="button" className="secondary-action-btn" onClick={handleExportGpx}>
                📤 Xuất Vết Chân & Ghim (.GPX)
              </button>
            </div>
          </div>
        )}

        {tab === 'ota' && (
          <div className="toolkit-body ota-panel">
            {/* Current Version + Data Safety Badge */}
            <div className="ota-card ota-version-card">
              <div className="ota-card-top">
                <div>
                  <span className="ota-env-pill">
                    {runtimeInfo?.isNative ? '📱 Android APK Native' : '🌐 Web Preview'}
                  </span>
                  <h4 className="ota-ver-heading">Phiên bản v{APP_BUILD_INFO.version}</h4>
                </div>
                <span className="ota-safe-pill">🛡️ Giữ 100% Ghim & Offline</span>
              </div>
              <p className="ota-sub-meta">
                Build #{APP_BUILD_INFO.buildNumber} • {APP_BUILD_INFO.note}
              </p>
              {runtimeInfo?.isNative && (
                <p className="ota-sub-meta">
                  Bundle đang chạy: <code>{runtimeInfo.isBuiltinBundle ? 'Gốc APK (builtin)' : `OTA #${runtimeInfo.nativeBundleId}`}</code>
                </p>
              )}
            </div>

            {otaProgress > 0 && (otaBusy === 'github-apply' || otaBusy === 'lan-apply') && (
              <div className="dl-progress-wrap">
                <div className="dl-bar ota-progress-bar">
                  <div className="dl-fill" style={{ width: `${otaProgress}%` }} />
                </div>
                <span className="mono-sub">Đang tải & cài nóng bản cập nhật: {otaProgress}%</span>
              </div>
            )}

            {otaStatusMsg && <div className="success-box">{otaStatusMsg}</div>}
            {otaErrorMsg && <div className="error-box">⚠️ {otaErrorMsg}</div>}

            {/* Channel 1 (Priority): GitHub Releases OTA */}
            <div className="ota-card ota-github-card">
              <div className="ota-card-top">
                <strong>🐙 Cập nhật từ GitHub (Ưu tiên #1)</strong>
                <button
                  type="button"
                  className="ota-mini-link"
                  onClick={() => setShowRepoEdit((v) => !v)}
                >
                  {showRepoEdit ? 'Ẩn repo' : 'Đổi repo'}
                </button>
              </div>
              <p className="helper-note">
                Chỉ cần cài APK <strong>1 lần đầu</strong>. Mỗi khi laptop chạy <code>npm run push-update</code>, app tải gói ~410 KB về lưu cứng dùng Offline giữa rừng.
              </p>

              {showRepoEdit ? (
                <div className="form-group">
                  <label>GitHub Repository (owner/repo)</label>
                  <input
                    type="text"
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="hongphuc120399-netizen/dinh-ops-3d"
                  />
                </div>
              ) : (
                <div className="ota-repo-line">
                  <span>Kho GitHub:</span> <code>{githubRepo}</code>
                </div>
              )}

              <div className="ota-actions-col">
                <button
                  type="button"
                  className="primary-action-btn full-w"
                  disabled={otaBusy !== null}
                  onClick={handleGithubCheckOrApply}
                >
                  {otaBusy === 'github-check'
                    ? '⏳ Đang kiểm tra GitHub...'
                    : otaBusy === 'github-apply'
                      ? '⏳ Đang tải gói OTA...'
                      : remoteOta?.isNewer
                        ? `🚀 Cập nhật ngay lên v${remoteOta.version} (~${Math.max(1, Math.round(remoteOta.sizeBytes / 1024))} KB)`
                        : '🐙 Kiểm tra & Cập nhật từ GitHub'}
                </button>

                {remoteOta && !remoteOta.isNewer && (
                  <button
                    type="button"
                    className="secondary-action-btn full-w"
                    disabled={otaBusy !== null}
                    onClick={handleForceGithubDownload}
                  >
                    🔁 Nạp lại gói v{remoteOta.version} trên GitHub
                  </button>
                )}

                {apkUrl && (
                  <a
                    href={apkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="secondary-action-btn ota-apk-link"
                  >
                    📲 Tải file cài đặt gốc (.APK) lần đầu
                  </a>
                )}
              </div>
            </div>

            {/* Channel 2: Local Laptop Wi-Fi / Hotspot LAN */}
            <div className="ota-card">
              <div className="ota-card-top">
                <strong>💻 Bắn trực tiếp từ Laptop qua Wi-Fi / Hotspot</strong>
              </div>
              <p className="helper-note">
                Khi đứng ở chân núi không có Internet: trên laptop gõ <code>npm run ota:lan</code> rồi nhập IP hiện trên màn hình laptop:
              </p>
              <div className="ota-lan-row">
                <input
                  type="text"
                  value={lanHost}
                  onChange={(e) => setLanHost(e.target.value)}
                  placeholder="VD: 192.168.1.15:8787"
                />
                <button
                  type="button"
                  className="secondary-action-btn"
                  disabled={otaBusy !== null}
                  onClick={handleLanSync}
                >
                  {otaBusy === 'lan-apply' ? '⏳...' : '⚡ Hút bản mới'}
                </button>
              </div>
            </div>

            {/* Emergency Rollback */}
            <button
              type="button"
              className="secondary-action-btn full-w ota-rollback-btn"
              disabled={otaBusy !== null}
              onClick={handleRollback}
            >
              🛟 Khôi phục bản gốc an toàn nằm sẵn trong APK
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

interface PrecisionHomingOverlayProps {
  target: TacticalTarget;
  playerLat: number;
  playerLon: number;
  playerEle: number;
  compassHeading: number;
  onUnlock: () => void;
  onClose: () => void;
}

export const PrecisionHomingOverlay: React.FC<PrecisionHomingOverlayProps> = ({
  target,
  playerLat,
  playerLon,
  playerEle,
  compassHeading,
  onUnlock,
  onClose
}) => {
  const dist = haversineDistanceM(playerLat, playerLon, target.lat, target.lon);
  const targetBrng = computeBearingDeg(playerLat, playerLon, target.lat, target.lon);
  const clockInfo = formatClockDirection(targetBrng, compassHeading);
  const eleDiff = Math.round(target.ele - playerEle);
  const isArrived = dist < 12;

  return (
    <div className="sheet-backdrop precision-backdrop" onClick={onClose}>
      <div className={`precision-homing-card ${isArrived ? 'arrived-glow' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="precision-top">
          <span className="precision-tag">🎯 RADAR TRUY TÌM CHÍNH XÁC</span>
          <button type="button" className="icon-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <h2 className="precision-title">{target.name}</h2>
        <p className="precision-clock">{isArrived ? '✅ ĐÃ TỚI SÁT MỤC TIÊU!' : clockInfo.label}</p>

        <div className="compass-dial-ring">
          <div
            className="compass-arrow-rotator"
            style={{ transform: `rotate(${clockInfo.deltaDeg}deg)` }}
          >
            <div className="giant-homing-arrow">
              <svg width="46" height="46" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L4.5 20.5L12 16.5L19.5 20.5L12 2Z" />
              </svg>
            </div>
          </div>
          <div className="compass-center-readout">
            <span className="big-dist">{formatDistance(dist)}</span>
            <span className="ele-delta">
              {eleDiff >= 0 ? `Cao hơn +${eleDiff}m` : `Thấp hơn ${eleDiff}m`}
            </span>
          </div>
        </div>

        <div className="precision-metrics-grid">
          <div>
            <small>Phương vị mục tiêu</small>
            <strong>{formatBearingCardinal(targetBrng)}</strong>
          </div>
          <div>
            <small>Hướng mũi máy bạn</small>
            <strong>{formatBearingCardinal(compassHeading)}</strong>
          </div>
          <div>
            <small>Tọa độ điểm đích</small>
            <strong>
              {target.lat.toFixed(5)}, {target.lon.toFixed(5)}
            </strong>
          </div>
        </div>

        {target.photoDataUrl && (
          <div className="precision-photo-box">
            <span>📷 Ảnh chụp thực địa tại cục đá / điểm ghim:</span>
            <img src={target.photoDataUrl} alt={target.name} />
          </div>
        )}
        {target.note && <p className="precision-note">📝 {target.note}</p>}

        <div className="sheet-dual-actions">
          <button
            type="button"
            className="secondary-action-btn"
            onClick={() => {
              onUnlock();
              onClose();
            }}
          >
            Bỏ khóa mục tiêu
          </button>
          <button type="button" className="primary-action-btn" onClick={onClose}>
            Thu nhỏ về bản đồ 3D
          </button>
        </div>
      </div>
    </div>
  );
};
