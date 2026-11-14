import type { GeoBounds, ImportedGpxTrack, TacticalTarget, TrackPoint, UserPin } from '../types';

const DB_NAME = 'DinhOps3DOfflineVault';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openVault(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('state')) {
        db.createObjectStore('state');
      }
      if (!db.objectStoreNames.contains('tiles')) {
        db.createObjectStore('tiles');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

export async function vaultGet<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await openVault();
    return await new Promise<T>((resolve) => {
      const tx = db.transaction('state', 'readonly');
      const req = tx.objectStore('state').get(key);
      req.onsuccess = () => resolve(req.result !== undefined ? (req.result as T) : fallback);
      req.onerror = () => resolve(fallback);
    });
  } catch {
    return fallback;
  }
}

export async function vaultSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openVault();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore storage quota warnings gracefully
  }
}

export async function getCachedTileBlob(tileKey: string): Promise<Blob | null> {
  try {
    const db = await openVault();
    return await new Promise<Blob | null>((resolve) => {
      const tx = db.transaction('tiles', 'readonly');
      const req = tx.objectStore('tiles').get(tileKey);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCachedTileBlob(tileKey: string, blob: Blob): Promise<void> {
  try {
    const db = await openVault();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('tiles', 'readwrite');
      tx.objectStore('tiles').put(blob, tileKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore
  }
}

export async function countCachedTiles(): Promise<number> {
  try {
    const db = await openVault();
    return await new Promise<number>((resolve) => {
      const tx = db.transaction('tiles', 'readonly');
      const req = tx.objectStore('tiles').count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

export function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

export function lat2tile(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z));
}

export function getTileUrl(layer: 'google-hybrid' | 'google-sat' | 'google-terrain' | 'opentopo', z: number, x: number, y: number): string {
  const sub = (x + y) % 4;
  if (layer === 'google-sat') {
    return `https://mt${sub}.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;
  }
  if (layer === 'google-hybrid') {
    return `https://mt${sub}.google.com/vt/lyrs=y&x=${x}&y=${y}&z=${z}`;
  }
  if (layer === 'google-terrain') {
    return `https://mt${sub}.google.com/vt/lyrs=p&x=${x}&y=${y}&z=${z}`;
  }
  const abc = ['a', 'b', 'c'][(x + y) % 3];
  return `https://${abc}.tile.opentopomap.org/${z}/${x}/${y}.png`;
}

/**
 * Fetch tile with Offline Vault first -> Network fallback -> Auto-cache into Vault!
 */
export async function fetchTileWithCache(
  layer: 'google-hybrid' | 'google-sat' | 'google-terrain' | 'opentopo',
  z: number,
  x: number,
  y: number
): Promise<Blob | null> {
  const key = `${layer}:${z}:${x}:${y}`;
  const cached = await getCachedTileBlob(key);
  if (cached) return cached;

  if (!navigator.onLine) return null;

  try {
    const url = getTileUrl(layer, z, x, y);
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > 200) {
      await putCachedTileBlob(key, blob);
      return blob;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pre-download Google Satellite + Hybrid + Terrain tiles covering all of Nui Dinh for 100% Offline Play!
 */
export async function downloadNuiDinhOfflineTiles(
  bounds: GeoBounds,
  onProgress: (done: number, total: number) => void
): Promise<{ saved: number; total: number }> {
  const jobs: { layer: 'google-sat' | 'google-hybrid' | 'google-terrain'; z: number; x: number; y: number }[] = [];

  // Zoom 14 & 15 for Satellite 3D Texture + Zoom 13..16 for 2D Hybrid & Terrain
  const configs: { layer: 'google-sat' | 'google-hybrid' | 'google-terrain'; zooms: number[] }[] = [
    { layer: 'google-sat', zooms: [14, 15] },
    { layer: 'google-hybrid', zooms: [13, 14, 15, 16] },
    { layer: 'google-terrain', zooms: [13, 14, 15] }
  ];

  for (const cfg of configs) {
    for (const z of cfg.zooms) {
      const minX = lon2tile(bounds.west, z);
      const maxX = lon2tile(bounds.east, z);
      const minY = lat2tile(bounds.north, z);
      const maxY = lat2tile(bounds.south, z);
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          jobs.push({ layer: cfg.layer, z, x, y });
        }
      }
    }
  }

  let done = 0;
  let saved = 0;
  const total = jobs.length;
  onProgress(0, total);

  // Download with concurrency = 8
  const concurrency = 8;
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const idx = cursor++;
      const job = jobs[idx];
      const blob = await fetchTileWithCache(job.layer, job.z, job.x, job.y);
      if (blob) saved++;
      done++;
      onProgress(done, total);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { saved, total };
}

/**
 * Compress camera image offline before storing in IndexedDB so hundreds of rock photos stay fast!
 */
export function compressImageFile(file: File, maxDim = 960, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No 2D context'));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function loadPersistedSession(): Promise<{
  pins: UserPin[];
  track: TrackPoint[];
  gpxList: ImportedGpxTrack[];
  lockedTarget: TacticalTarget | null;
  lockedBearing: number | null;
}> {
  const [pins, track, gpxList, lockedTarget, lockedBearing] = await Promise.all([
    vaultGet<UserPin[]>('user_pins', []),
    vaultGet<TrackPoint[]>('active_track', []),
    vaultGet<ImportedGpxTrack[]>('imported_gpx', []),
    vaultGet<TacticalTarget | null>('locked_target', null),
    vaultGet<number | null>('locked_bearing', null)
  ]);
  return { pins, track, gpxList, lockedTarget, lockedBearing };
}
