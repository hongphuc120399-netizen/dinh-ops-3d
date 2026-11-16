import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { APP_BUILD_INFO } from '../version';

export const DEFAULT_GITHUB_REPO = 'hongphuc120399-netizen/dinh-ops-3d';
const SETTINGS_STORAGE_KEY = 'dinh_ota_settings_v1';
const APPLIED_META_STORAGE_KEY = 'dinh_ota_applied_meta_v1';

export interface OtaSettings {
  githubRepo: string;
  githubToken: string;
  lanHost: string;
  autoCheckGithub: boolean;
}

export interface OtaManifest {
  version: string;
  buildNumber?: number;
  builtAt?: string;
  note?: string;
  bundleFile?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface AvailableOtaUpdate {
  source: 'github' | 'lan';
  version: string;
  buildNumber?: number;
  builtAt?: string;
  note: string;
  bundleUrl: string;
  sizeBytes: number;
  sha256?: string;
  releaseUrl?: string;
  isNewer: boolean;
}

export interface GithubOtaCheckResult {
  otaUpdate: AvailableOtaUpdate | null;
  apkDownloadUrl: string | null;
  apkVersion: string | null;
  checkedAt: number;
  repo: string;
}

export interface OtaRuntimeInfo {
  appVersion: string;
  nativeApkVersion: string;
  buildNumber: number;
  builtAt: string;
  note: string;
  isNative: boolean;
  nativeBundleId: string;
  nativeBundleVersion: string;
  isBuiltinBundle: boolean;
  lastAppliedSource?: string;
  lastAppliedAt?: string;
}

function safeReadJson<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeWriteJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota failures
  }
}

export function loadOtaSettings(): OtaSettings {
  const saved = safeReadJson<Partial<OtaSettings>>(SETTINGS_STORAGE_KEY);
  return {
    githubRepo: (saved?.githubRepo || DEFAULT_GITHUB_REPO).trim(),
    githubToken: (saved?.githubToken || '').trim(),
    lanHost: (saved?.lanHost || '').trim(),
    autoCheckGithub: saved?.autoCheckGithub !== false
  };
}

export function saveOtaSettings(patch: Partial<OtaSettings>): OtaSettings {
  const next: OtaSettings = {
    ...loadOtaSettings(),
    ...patch
  };
  safeWriteJson(SETTINGS_STORAGE_KEY, next);
  return next;
}

/**
 * Normalize version strings like "ota-v1.0.2", "v1.0.2", or "1.0.2-lan.123"
 */
export function normalizeSemver(ver: string): [number, number, number] {
  const clean = ver.trim().replace(/^ota-v?/i, '').replace(/^apk-v?/i, '').replace(/^v/i, '');
  const core = clean.split('-')[0] || '0.0.0';
  const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function normalizeSha256(raw?: string | null): string {
  if (!raw) return '';
  const cleaned = raw.trim().replace(/^sha256:/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(cleaned) ? cleaned : '';
}

async function computeRemoteBundleSha256(bundleUrl: string): Promise<string> {
  const res = await fetchWithTimeout(bundleUrl, { cache: 'no-store' }, 25000);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} khi tải gói OTA để tính SHA-256`);
  }
  const buf = await res.arrayBuffer();
  if (!globalThis.crypto?.subtle) {
    throw new Error('Thiếu SHA-256 checksum và WebCrypto không khả dụng trên WebView này');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function isRemoteNewer(
  remoteVer: string,
  currentVer: string,
  remoteBuildNum?: number,
  currentBuildNum?: number
): boolean {
  const [rMaj, rMin, rPat] = normalizeSemver(remoteVer);
  const [cMaj, cMin, cPat] = normalizeSemver(currentVer);
  if (rMaj !== cMaj) return rMaj > cMaj;
  if (rMin !== cMin) return rMin > cMin;
  if (rPat !== cPat) return rPat > cPat;
  if (typeof remoteBuildNum === 'number' && typeof currentBuildNum === 'number') {
    return remoteBuildNum > currentBuildNum;
  }
  return false;
}

/**
 * MUST be called immediately at startup so CapacitorUpdater does not trigger crash auto-rollback.
 */
export async function confirmOtaBootSuccess(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    // non-fatal safeguard
  }
}

export async function getCurrentOtaRuntimeInfo(): Promise<OtaRuntimeInfo> {
  const isNative = Capacitor.isNativePlatform();
  const applied = safeReadJson<{ source: string; appliedAt: string }>(APPLIED_META_STORAGE_KEY);
  let nativeBundleId = 'web-preview';
  let nativeBundleVersion = APP_BUILD_INFO.version;
  let nativeApkVersion = APP_BUILD_INFO.version;
  let isBuiltinBundle = true;

  if (isNative) {
    try {
      const cur = await CapacitorUpdater.current();
      nativeBundleId = cur.bundle.id;
      nativeBundleVersion = cur.bundle.version || APP_BUILD_INFO.version;
      nativeApkVersion = cur.native || APP_BUILD_INFO.version;
      isBuiltinBundle = cur.bundle.id === 'builtin';
    } catch {
      nativeBundleId = 'builtin';
    }
  }

  return {
    appVersion: APP_BUILD_INFO.version,
    nativeApkVersion,
    buildNumber: APP_BUILD_INFO.buildNumber,
    builtAt: APP_BUILD_INFO.builtAt,
    note: APP_BUILD_INFO.note,
    isNative,
    nativeBundleId,
    nativeBundleVersion,
    isBuiltinBundle,
    lastAppliedSource: applied?.source,
    lastAppliedAt: applied?.appliedAt
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  published_at: string;
  assets: GithubAsset[];
}

/**
 * Channel 1 (Priority): Check GitHub Releases for latest OTA bundle (`dinh-ops-ota-bundle.zip`)
 * and optional APK release (`dinh-ops-3d.apk`).
 */
export async function checkGithubOtaUpdate(
  repoOverride?: string,
  tokenOverride?: string
): Promise<GithubOtaCheckResult> {
  const settings = loadOtaSettings();
  const repo = (repoOverride ?? settings.githubRepo).trim() || DEFAULT_GITHUB_REPO;
  const token = (tokenOverride ?? settings.githubToken).trim();

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json'
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${repo}/releases?per_page=30`,
    { headers, cache: 'no-store' },
    6500
  );

  if (!res.ok) {
    throw new Error(`GitHub API HTTP ${res.status} (${repo})`);
  }

  const releases = (await res.json()) as GithubRelease[];
  let otaUpdate: AvailableOtaUpdate | null = null;
  let apkDownloadUrl: string | null = null;
  let apkVersion: string | null = null;

  for (const rel of releases) {
    if (rel.draft) continue;
    const assets = rel.assets || [];

    const apkAsset = assets.find((a) => a.name.toLowerCase().endsWith('.apk'));
    if (apkAsset) {
      const candApkVer = rel.tag_name.replace(/^apk-v?/i, '').replace(/^v/i, '');
      if (!apkVersion || isRemoteNewer(candApkVer, apkVersion)) {
        apkDownloadUrl = apkAsset.browser_download_url;
        apkVersion = candApkVer;
      }
    }

    const zipAsset = assets.find((a) => a.name === 'dinh-ops-ota-bundle.zip');
    if (zipAsset) {
      let remoteVer = rel.tag_name.replace(/^ota-v?/i, '').replace(/^v/i, '');
      let remoteBuildNum: number | undefined;
      let builtAt = rel.published_at;
      let remoteSha256 = normalizeSha256(zipAsset.digest);
      let rawBody = (rel.body || rel.name || `Phiên bản OTA ${remoteVer}`).trim();

      const metaMatch = rawBody.match(/<!--\s*DINH_OTA:(\{[\s\S]*?\})\s*-->/);
      if (metaMatch) {
        try {
          const parsedMeta = JSON.parse(metaMatch[1]) as Partial<OtaManifest>;
          if (parsedMeta.version) remoteVer = parsedMeta.version;
          if (typeof parsedMeta.buildNumber === 'number') remoteBuildNum = parsedMeta.buildNumber;
          if (parsedMeta.builtAt) builtAt = parsedMeta.builtAt;
          if (parsedMeta.note) rawBody = parsedMeta.note;
          const metaSha = normalizeSha256(parsedMeta.sha256);
          if (metaSha) remoteSha256 = metaSha;
        } catch {
          // ignore malformed metadata tag
        }
        rawBody = rawBody.replace(/<!--\s*DINH_OTA:[\s\S]*?-->/g, '').trim();
      }

      if (
        !otaUpdate ||
        isRemoteNewer(remoteVer, otaUpdate.version, remoteBuildNum, otaUpdate.buildNumber)
      ) {
        const cleanNote = (rawBody.split('\n')[0] || `Phiên bản OTA ${remoteVer}`).slice(0, 160);
        otaUpdate = {
          source: 'github',
          version: remoteVer,
          buildNumber: remoteBuildNum,
          builtAt,
          note: cleanNote,
          bundleUrl: zipAsset.browser_download_url,
          sizeBytes: zipAsset.size,
          sha256: remoteSha256 || undefined,
          releaseUrl: rel.html_url,
          isNewer: isRemoteNewer(
            remoteVer,
            APP_BUILD_INFO.version,
            remoteBuildNum,
            APP_BUILD_INFO.buildNumber
          )
        };
      }
    }
  }

  return {
    otaUpdate,
    apkDownloadUrl,
    apkVersion,
    checkedAt: Date.now(),
    repo
  };
}

export interface ApplyOtaOptions {
  bundleUrl: string;
  version: string;
  note: string;
  source: 'github' | 'lan';
  sha256?: string;
  onProgress?: (percent: number) => void;
}

/**
 * Downloads and activates a new web bundle inside Capacitor Android without reinstalling the APK.
 * Preserves 100% of IndexedDB data (pins, photos, tracks, cached Google Satellite tiles).
 */
export async function applyOtaBundle(options: ApplyOtaOptions): Promise<{ appliedNative: boolean }> {
  const { bundleUrl, version, source, sha256, onProgress } = options;

  if (!Capacitor.isNativePlatform()) {
    // Web preview / PWA fallback: flush Service Worker cache and reload cleanly
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    return { appliedNative: false };
  }

  const checksum = normalizeSha256(sha256) || (await computeRemoteBundleSha256(bundleUrl));

  try {
    const [{ bundle: curBundle }, { bundles }] = await Promise.all([
      CapacitorUpdater.current(),
      CapacitorUpdater.list()
    ]);
    const stale = bundles.filter(
      (b) => b.version === version && b.id !== curBundle.id && b.id !== 'builtin'
    );
    for (const b of stale) {
      await CapacitorUpdater.delete({ id: b.id }).catch(() => {});
    }
  } catch {
    // best-effort stale bundle cleanup
  }

  let downloadHandle: PluginListenerHandle | null = null;
  let failedHandle: PluginListenerHandle | null = null;
  let failedDetail = '';
  try {
    downloadHandle = await CapacitorUpdater.addListener('download', (ev) => {
      onProgress?.(Math.max(0, Math.min(100, Math.round(ev.percent))));
    });
    failedHandle = await CapacitorUpdater.addListener('downloadFailed', (ev) => {
      const errTxt = (ev as { version: string; error?: string }).error;
      if (errTxt) failedDetail = errTxt;
    });

    const bundle = await CapacitorUpdater.download({
      url: bundleUrl,
      version,
      checksum
    });

    safeWriteJson(APPLIED_META_STORAGE_KEY, {
      source,
      version,
      bundleId: bundle.id,
      appliedAt: new Date().toISOString()
    });

    onProgress?.(100);
    // Terminal call: reloads WebView into the newly stored offline bundle immediately
    await CapacitorUpdater.set({ id: bundle.id });
    return { appliedNative: true };
  } catch (err) {
    const baseMsg = err instanceof Error ? err.message : String(err);
    throw new Error(failedDetail ? `${baseMsg} (${failedDetail})` : baseMsg);
  } finally {
    if (downloadHandle) {
      await downloadHandle.remove().catch(() => {});
    }
    if (failedHandle) {
      await failedHandle.remove().catch(() => {});
    }
  }
}

export function normalizeLanBaseUrl(hostInput: string): string {
  const trimmed = hostInput.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Hãy nhập địa chỉ IP Laptop (VD: 192.168.1.15:8787)');
  }
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withProto);
  if (!parsed.port) {
    parsed.port = '8787';
  }
  return parsed.origin;
}

/**
 * Channel 2: Pull update bundle directly over Wi-Fi / 4G Hotspot from the user's laptop (`npm run ota:lan`).
 */
export async function syncFromLaptopLan(
  hostInput: string,
  onProgress?: (percent: number) => void
): Promise<{ appliedNative: boolean; manifest: OtaManifest }> {
  const baseUrl = normalizeLanBaseUrl(hostInput);
  saveOtaSettings({ lanHost: hostInput.trim() });

  const manifestRes = await fetchWithTimeout(
    `${baseUrl}/ota-manifest.json?t=${Date.now()}`,
    { cache: 'no-store' },
    5000
  );
  if (!manifestRes.ok) {
    throw new Error(`Không kết nối được Laptop (${manifestRes.status}) tại ${baseUrl}`);
  }
  const manifest = (await manifestRes.json()) as OtaManifest;
  const uniqueVersionTag = `${manifest.version || '1.0.0'}-lan.${manifest.buildNumber || Date.now()}`;
  const bundleUrl = `${baseUrl}/${manifest.bundleFile || 'dinh-ops-ota-bundle.zip'}?t=${Date.now()}`;

  const result = await applyOtaBundle({
    bundleUrl,
    version: uniqueVersionTag,
    note: manifest.note || 'Đồng bộ trực tiếp qua Wi-Fi Laptop',
    source: 'lan',
    sha256: manifest.sha256,
    onProgress
  });

  return { ...result, manifest };
}

/**
 * Emergency rollback to the original web bundle built inside the installed APK.
 */
export async function rollbackToBuiltinApkBundle(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  safeWriteJson(APPLIED_META_STORAGE_KEY, {
    source: 'builtin-reset',
    appliedAt: new Date().toISOString()
  });
  await CapacitorUpdater.reset({ toLastSuccessful: false });
  return true;
}
