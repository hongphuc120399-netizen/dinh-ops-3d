import type {
  DemGrid,
  GeoBounds,
  NuiDinhDataset,
  SafetyAlert,
  TacticalRouteResult,
  TrackPoint,
  UserPin
} from '../types';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_RADIUS_M = 6371000;

/**
 * Exact WGS84 ellipsoid meters-per-degree scaling at latitude phi.
 */
export function wgs84MetersPerDeg(latDeg: number): { mPerLat: number; mPerLon: number } {
  const phi = latDeg * DEG_TO_RAD;
  const mPerLat =
    111132.92 -
    559.82 * Math.cos(2 * phi) +
    1.175 * Math.cos(4 * phi) -
    0.0023 * Math.cos(6 * phi);
  const mPerLon =
    111412.84 * Math.cos(phi) -
    93.5 * Math.cos(3 * phi) +
    0.118 * Math.cos(5 * phi);
  return { mPerLat, mPerLon };
}

// At Nui Dinh (~10.5385°N) under WGS84 ellipsoid:
const NUI_DINH_WGS84 = wgs84MetersPerDeg(10.5385);
export const METERS_PER_DEG_LAT = NUI_DINH_WGS84.mPerLat; // 110,611.42 m
export const METERS_PER_DEG_LON = NUI_DINH_WGS84.mPerLon; // 109,454.00 m

export function getWorldDimensions(bounds: GeoBounds) {
  const widthM = (bounds.east - bounds.west) * METERS_PER_DEG_LON;
  const depthM = (bounds.north - bounds.south) * METERS_PER_DEG_LAT;
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLon = (bounds.east + bounds.west) / 2;
  return { widthM, depthM, centerLat, centerLon };
}

/**
 * Convert (lat, lon, ele) -> Three.js World Coordinates in meters
 * X: West (-) to East (+)
 * Y: Elevation * verticalScale
 * Z: North (-) to South (+) (so -Z is Due North, matching standard 3D right-handed map space!)
 */
export function latLonToWorld3D(
  lat: number,
  lon: number,
  ele: number,
  bounds: GeoBounds,
  verticalScale = 1.45
): [number, number, number] {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLon = (bounds.east + bounds.west) / 2;
  const x = (lon - centerLon) * METERS_PER_DEG_LON;
  const z = -(lat - centerLat) * METERS_PER_DEG_LAT;
  const y = ele * verticalScale;
  return [x, y, z];
}

export function world3DToLatLon(x: number, z: number, bounds: GeoBounds): { lat: number; lon: number } {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLon = (bounds.east + bounds.west) / 2;
  const lon = centerLon + x / METERS_PER_DEG_LON;
  const lat = centerLat - z / METERS_PER_DEG_LAT;
  return { lat, lon };
}

/**
 * Exact Triangular Barycentric Interpolation matching Three.js PlaneGeometry diagonals (tx + ty <= 1)
 */
export function sampleDemElevation(dem: DemGrid, bounds: GeoBounds, lat: number, lon: number): number {
  const rawU = (lon - bounds.west) / (bounds.east - bounds.west);
  const rawV = (bounds.north - lat) / (bounds.north - bounds.south);
  const u = Math.min(1, Math.max(0, rawU));
  const v = Math.min(1, Math.max(0, rawV));

  const gx = u * (dem.cols - 1);
  const gy = v * (dem.rows - 1);
  const x0 = Math.min(dem.cols - 2, Math.max(0, Math.floor(gx)));
  const y0 = Math.min(dem.rows - 2, Math.max(0, Math.floor(gy)));
  const tx = gx - x0;
  const ty = gy - y0;

  const e00 = dem.elevations[y0 * dem.cols + x0];
  const e10 = dem.elevations[y0 * dem.cols + (x0 + 1)];
  const e01 = dem.elevations[(y0 + 1) * dem.cols + x0];
  const e11 = dem.elevations[(y0 + 1) * dem.cols + (x0 + 1)];

  if (tx + ty <= 1) {
    return e00 + tx * (e10 - e00) + ty * (e01 - e00);
  }
  return e11 + (1 - tx) * (e01 - e11) + (1 - ty) * (e10 - e11);
}

/**
 * Compute real slope steepness in degrees at (lat, lon)
 */
export function sampleDemSlopeDeg(dem: DemGrid, bounds: GeoBounds, lat: number, lon: number): number {
  const stepLat = 20 / METERS_PER_DEG_LAT;
  const stepLon = 20 / METERS_PER_DEG_LON;
  const eN = sampleDemElevation(dem, bounds, lat + stepLat, lon);
  const eS = sampleDemElevation(dem, bounds, lat - stepLat, lon);
  const eE = sampleDemElevation(dem, bounds, lat, lon + stepLon);
  const eW = sampleDemElevation(dem, bounds, lat, lon - stepLon);
  const dzdx = (eE - eW) / 40;
  const dzdy = (eN - eS) / 40;
  return Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * RAD_TO_DEG;
}

export function haversineDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (Math.abs(lat2 - lat1) < 2 && Math.abs(lon2 - lon1) < 2) {
    const { mPerLat, mPerLon } = wgs84MetersPerDeg((lat1 + lat2) / 2);
    return Math.hypot((lon2 - lon1) * mPerLon, (lat2 - lat1) * mPerLat);
  }
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (Math.abs(lat2 - lat1) < 2 && Math.abs(lon2 - lon1) < 2) {
    const { mPerLat, mPerLon } = wgs84MetersPerDeg((lat1 + lat2) / 2);
    const dx = (lon2 - lon1) * mPerLon;
    const dy = (lat2 - lat1) * mPerLat;
    return ((Math.atan2(dx, dy) * RAD_TO_DEG) + 360) % 360;
  }
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const dLam = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(dLam) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
  return ((Math.atan2(y, x) * RAD_TO_DEG) + 360) % 360;
}

export function projectPointByBearing(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number
): { lat: number; lon: number } {
  const brng = bearingDeg * DEG_TO_RAD;
  const { mPerLat, mPerLon } = wgs84MetersPerDeg(lat);
  const dx = distanceM * Math.sin(brng);
  const dy = distanceM * Math.cos(brng);
  return {
    lat: Number((lat + dy / mPerLat).toFixed(6)),
    lon: Number((lon + dx / mPerLon).toFixed(6))
  };
}

export function formatBearingCardinal(deg: number): string {
  const dirs = ['Bắc', 'ĐB', 'Đông', 'ĐN', 'Nam', 'TN', 'Tây', 'TB'];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return `${Math.round(((deg % 360) + 360) % 360).toString().padStart(3, '0')}° ${dirs[idx]}`;
}

export function formatClockDirection(targetBearing: number, myHeading: number): {
  clock: number;
  label: string;
  deltaDeg: number;
} {
  let delta = ((targetBearing - myHeading + 540) % 360) - 180; // -180..+180
  const norm360 = (delta + 360) % 360;
  let clock = Math.round(norm360 / 30);
  if (clock === 0) clock = 12;
  let label = `Hướng ${clock} giờ`;
  if (Math.abs(delta) <= 15) label = '12h • Thẳng trước mặt';
  else if (Math.abs(delta) >= 165) label = '6h • Ngay sau lưng';
  else if (delta > 0) label = `${clock}h • Chếch phải ${Math.round(delta)}°`;
  else label = `${clock}h • Chếch trái ${Math.round(Math.abs(delta))}°`;
  return { clock, label, deltaDeg: delta };
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters < 25 ? meters.toFixed(1) : Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

// Offline Open Location Code (Google Plus Code) Decoder
const OLC_ALPHABET = '23456789CFGHJMPQRVWX';

function decodeFullPlusCode(code: string): { lat: number; lon: number } | null {
  const clean = code.toUpperCase().replace(/[^23456789CFGHJMPQRVWX+]/g, '');
  const plusIdx = clean.indexOf('+');
  // Standard Open Location Code full code MUST have exactly 8 characters before '+'
  if (plusIdx !== 8) return null;
  const digits = clean.replace('+', '');
  if (digits.length < 8) return null;

  let lat = 0;
  let lon = 0;
  let latPlaceVal = 400;
  let lonPlaceVal = 400;

  for (let i = 0; i < Math.min(digits.length, 10); i += 2) {
    latPlaceVal /= 20;
    lonPlaceVal /= 20;
    const vLat = OLC_ALPHABET.indexOf(digits[i]);
    const vLon = OLC_ALPHABET.indexOf(digits[i + 1]);
    if (vLat < 0 || vLon < 0) return null;
    lat += vLat * latPlaceVal;
    lon += vLon * lonPlaceVal;
  }
  if (digits.length > 10) {
    for (let i = 10; i < digits.length; i++) {
      latPlaceVal /= 5;
      lonPlaceVal /= 4;
      const v = OLC_ALPHABET.indexOf(digits[i]);
      if (v < 0) break;
      lat += Math.floor(v / 4) * latPlaceVal;
      lon += (v % 4) * lonPlaceVal;
    }
  }
  lat = lat + latPlaceVal / 2 - 90;
  lon = lon + lonPlaceVal / 2 - 180;
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

function recoverShortPlusCode(shortCode: string, refLat = 10.5385, refLon = 107.129): { lat: number; lon: number } | null {
  const clean = shortCode.toUpperCase().trim().split(/\s+/)[0].replace(/[^23456789CFGHJMPQRVWX+]/g, '');
  const plusIdx = clean.indexOf('+');
  if (plusIdx === 8) return decodeFullPlusCode(clean);
  // Short Plus Codes must have 2, 4, or 6 characters before '+'
  if (plusIdx < 2 || plusIdx > 6 || plusIdx % 2 !== 0) return null;

  const paddingLen = 8 - plusIdx;
  const resolution = Math.pow(20, 2 - paddingLen / 2); // 4 chars missing => 1 deg; 6 chars missing => 20 deg
  // Build prefix from reference
  let adjLat = Math.floor((refLat + 90) / resolution) * resolution;
  let adjLon = Math.floor((refLon + 180) / resolution) * resolution;

  let prefix = '';
  let latVal = adjLat;
  let lonVal = adjLon;
  let place = 20;
  for (let i = 0; i < paddingLen; i += 2) {
    const dLat = Math.floor(latVal / place) % 20;
    const dLon = Math.floor(lonVal / place) % 20;
    prefix += OLC_ALPHABET[dLat] + OLC_ALPHABET[dLon];
    place /= 20;
  }
  const decoded = decodeFullPlusCode(prefix + clean);
  if (!decoded) return null;

  // Snap to nearest cell around reference
  let { lat, lon } = decoded;
  if (lat - refLat > resolution / 2) lat -= resolution;
  else if (refLat - lat > resolution / 2) lat += resolution;
  if (lon - refLon > resolution / 2) lon -= resolution;
  else if (refLon - lon > resolution / 2) lon += resolution;

  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

/**
 * Universal Offline Coordinate / Google Maps Link / DMS / Plus Code Parser
 */
export function parseFlexibleCoordinateInput(raw: string): { lat: number; lon: number; format: string } | null {
  const s = raw.trim();
  if (!s) return null;

  // 1. Google Maps URL (@lat,lon or q=lat,lon or ll=lat,lon or !3dlat!4dlon)
  const bangMatch = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (bangMatch) {
    return { lat: parseFloat(bangMatch[1]), lon: parseFloat(bangMatch[2]), format: 'Google Maps Link' };
  }
  const urlAtMatch = s.match(/[@?=](-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
  if (urlAtMatch) {
    return { lat: parseFloat(urlAtMatch[1]), lon: parseFloat(urlAtMatch[2]), format: 'Google Maps URL' };
  }

  // 2. Google Plus Code (e.g. 7P29G4QH+HP or G4QH+HP Ba Ria)
  if (s.includes('+')) {
    const res = recoverShortPlusCode(s);
    if (res && res.lat >= -90 && res.lat <= 90 && res.lon >= -180 && res.lon <= 180) {
      return { ...res, format: 'Google Plus Code (Offline)' };
    }
  }

  // 3a. DMS (Degrees-Minutes-Seconds): e.g., 10°32'20.1"N 107°07'46.5"E
  const dmsRegex = /(\d{1,3})\s*[°dD]\s*(\d{1,2})\s*['′mM]\s*(\d{1,2}(?:\.\d+)?)\s*["″sS]?\s*([NSEWĐBT]?)/gi;
  const dmsMatches = [...s.matchAll(dmsRegex)];
  if (dmsMatches.length >= 2) {
    const parsePart = (m: RegExpMatchArray) => {
      let val = parseFloat(m[1]) + parseFloat(m[2]) / 60 + parseFloat(m[3]) / 3600;
      const dir = (m[4] || '').toUpperCase();
      if (dir === 'S' || dir === 'W' || dir === 'T') val = -val;
      return val;
    };
    return {
      lat: Number(parsePart(dmsMatches[0]).toFixed(6)),
      lon: Number(parsePart(dmsMatches[1]).toFixed(6)),
      format: 'Độ-Phút-Giây (DMS)'
    };
  }

  // 3b. Garmin DDM (Degrees + Decimal Minutes): e.g., N 10° 32.325', E 107° 07.765' or 10°32.325'N 107°07.765'E
  const ddmRegex = /([NSEWĐBT]?)\s*(\d{1,3})\s*[°dD]\s*(\d{1,2}(?:\.\d+)?)\s*['′mM]?\s*([NSEWĐBT]?)/gi;
  const ddmMatches = [...s.matchAll(ddmRegex)];
  if (ddmMatches.length >= 2 && /[°′']/.test(s)) {
    const parseDdm = (m: RegExpMatchArray) => {
      let val = parseFloat(m[2]) + parseFloat(m[3]) / 60;
      const dir = ((m[1] || '') + (m[4] || '')).toUpperCase();
      if (dir.includes('S') || dir.includes('W') || dir.includes('T')) val = -val;
      return val;
    };
    return {
      lat: Number(parseDdm(ddmMatches[0]).toFixed(6)),
      lon: Number(parseDdm(ddmMatches[1]).toFixed(6)),
      format: 'Độ-Phút Thập Phân (Garmin DDM)'
    };
  }

  // 4. Plain Decimal Degrees: "10.538922, 107.129581" or "107.129581, 10.538922"
  const decMatch = s.match(/(?:^|[^\d.-])(-?\d{1,3}\.\d+)\s*[,;\s/]+\s*(-?\d{1,3}\.\d+)/);
  if (decMatch) {
    const a = parseFloat(decMatch[1]);
    const b = parseFloat(decMatch[2]);
    // Auto-swap if user entered lon,lat (e.g. 107.129, 10.538)
    if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
      return { lat: b, lon: a, format: 'Tọa độ Thập phân (Tự đảo Kinh/Vĩ)' };
    }
    return { lat: a, lon: b, format: 'Tọa độ Thập phân (Lat, Lon)' };
  }

  return null;
}

function pointInPolygon(lat: number, lon: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function minDistanceToPolylineM(lat: number, lon: number, coords: [number, number][]): number {
  let minD = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lat1, lon1] = coords[i];
    const [lat2, lon2] = coords[i + 1];
    const ax = (lon1 - lon) * METERS_PER_DEG_LON;
    const ay = (lat1 - lat) * METERS_PER_DEG_LAT;
    const bx = (lon2 - lon) * METERS_PER_DEG_LON;
    const by = (lat2 - lat) * METERS_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? -(ax * dx + ay * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < minD) minD = d;
  }
  return minD;
}

export function minDistanceToPowerlinesM(lat: number, lon: number, dataset: NuiDinhDataset): number {
  if (!dataset.powerlines || dataset.powerlines.length === 0) return Infinity;
  let best = Infinity;
  for (const pl of dataset.powerlines) {
    const d = minDistanceToPolylineM(lat, lon, pl.coords);
    if (d < best) best = d;
  }
  return best;
}

function subdivideLatLonRun(pts: [number, number][], maxStepM: number): [number, number][] {
  if (pts.length < 2 || maxStepM <= 0) return pts;
  const out: [number, number][] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [lat1, lon1] = pts[i];
    const [lat2, lon2] = pts[i + 1];
    const distM = Math.hypot((lat2 - lat1) * METERS_PER_DEG_LAT, (lon2 - lon1) * METERS_PER_DEG_LON);
    const steps = Math.max(1, Math.ceil(distM / maxStepM));
    for (let s = 1; s <= steps; s++) {
      const f = s / steps;
      out.push([lat1 + (lat2 - lat1) * f, lon1 + (lon2 - lon1) * f]);
    }
  }
  return out;
}

function clipSegmentLiangBarsky(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  bounds: GeoBounds
): [[number, number], [number, number]] | null {
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  let t0 = 0;
  let t1 = 1;

  const checks: [number, number][] = [
    [-dx, lon1 - bounds.west],
    [dx, bounds.east - lon1],
    [-dy, lat1 - bounds.south],
    [dy, bounds.north - lat1]
  ];

  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }

  return [
    [lat1 + t0 * dy, lon1 + t0 * dx],
    [lat1 + t1 * dy, lon1 + t1 * dx]
  ];
}

/**
 * Clips an open polyline to the 3D terrain block bounds (Liang-Barsky) and subdivides
 * long spans so 3D draped lines never shoot out into empty space or tunnel underground.
 */
export function clipAndSubdividePolylineToBounds(
  coords: [number, number][],
  bounds: GeoBounds,
  maxStepM = 40
): [number, number][][] {
  if (coords.length < 2) return [];
  const runs: [number, number][][] = [];
  let cur: [number, number][] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const clipped = clipSegmentLiangBarsky(
      coords[i][0],
      coords[i][1],
      coords[i + 1][0],
      coords[i + 1][1],
      bounds
    );
    if (!clipped) {
      if (cur.length >= 2) runs.push(subdivideLatLonRun(cur, maxStepM));
      cur = [];
      continue;
    }
    const [a, b] = clipped;
    if (cur.length === 0) {
      cur.push(a, b);
    } else {
      const last = cur[cur.length - 1];
      if (Math.abs(last[0] - a[0]) < 1e-9 && Math.abs(last[1] - a[1]) < 1e-9) {
        cur.push(b);
      } else {
        if (cur.length >= 2) runs.push(subdivideLatLonRun(cur, maxStepM));
        cur = [a, b];
      }
    }
  }
  if (cur.length >= 2) runs.push(subdivideLatLonRun(cur, maxStepM));
  return runs;
}

/**
 * Clips a closed hazard polygon to 3D terrain bounds (Sutherland-Hodgman) and subdivides
 * long edges (e.g. 2.8km Lam Son perimeter segments) so 3D force-field walls hug DEM ridges.
 */
export function clipAndSubdividePolygonToBounds(
  poly: [number, number][],
  bounds: GeoBounds,
  maxStepM = 45
): [number, number][] {
  if (poly.length < 3) return [];
  let ring = poly.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) {
    ring.pop();
  }

  const clipHalfPlane = (
    input: [number, number][],
    inside: (pt: [number, number]) => boolean,
    intersect: (a: [number, number], b: [number, number]) => [number, number]
  ): [number, number][] => {
    if (input.length === 0) return [];
    const out: [number, number][] = [];
    let prev = input[input.length - 1];
    let prevIn = inside(prev);
    for (const curr of input) {
      const currIn = inside(curr);
      if (currIn) {
        if (!prevIn) out.push(intersect(prev, curr));
        out.push(curr);
      } else if (prevIn) {
        out.push(intersect(prev, curr));
      }
      prev = curr;
      prevIn = currIn;
    }
    return out;
  };

  ring = clipHalfPlane(
    ring,
    (p) => p[0] >= bounds.south,
    (a, b) => {
      const t = (bounds.south - a[0]) / (b[0] - a[0] || 1e-12);
      return [bounds.south, a[1] + t * (b[1] - a[1])];
    }
  );
  ring = clipHalfPlane(
    ring,
    (p) => p[0] <= bounds.north,
    (a, b) => {
      const t = (bounds.north - a[0]) / (b[0] - a[0] || 1e-12);
      return [bounds.north, a[1] + t * (b[1] - a[1])];
    }
  );
  ring = clipHalfPlane(
    ring,
    (p) => p[1] >= bounds.west,
    (a, b) => {
      const t = (bounds.west - a[1]) / (b[1] - a[1] || 1e-12);
      return [a[0] + t * (b[0] - a[0]), bounds.west];
    }
  );
  ring = clipHalfPlane(
    ring,
    (p) => p[1] <= bounds.east,
    (a, b) => {
      const t = (bounds.east - a[1]) / (b[1] - a[1] || 1e-12);
      return [a[0] + t * (b[0] - a[0]), bounds.east];
    }
  );

  if (ring.length < 3) return [];
  return subdivideLatLonRun([...ring, ring[0]], maxStepM);
}

/**
 * Real-time Geofence & Off-Trail Tactical Monitor
 */
export function evaluateSafetyAlerts(lat: number, lon: number, dataset: NuiDinhDataset): SafetyAlert[] {
  const alerts: SafetyAlert[] = [];

  // Generous ~9km safety envelope around Nui Dinh so Military Range & 220kV corridors
  // extending north/west of the 3D DEM box ALWAYS trigger life-safety alarms!
  const inRegionalEnvelope =
    lat >= dataset.bounds.south - 0.08 &&
    lat <= dataset.bounds.north + 0.08 &&
    lon >= dataset.bounds.west - 0.08 &&
    lon <= dataset.bounds.east + 0.08;

  if (!inRegionalEnvelope) return alerts;

  const insideMassif =
    lat >= dataset.bounds.south &&
    lat <= dataset.bounds.north &&
    lon >= dataset.bounds.west &&
    lon <= dataset.bounds.east;

  // 1. Check Military & Quarry Hazard Zones
  for (const h of dataset.hazards) {
    const inside = pointInPolygon(lat, lon, h.coords);
    const dist = inside ? 0 : minDistanceToPolylineM(lat, lon, h.coords);
    if (h.kind === 'military' && dist < 200) {
      alerts.push({
        level: 'critical',
        kind: 'military',
        title: inside ? '⛔ ĐANG TRONG VÙNG CẤM QUÂN SỰ!' : `⚠️ SÁT VÙNG CẤM: ${h.name}`,
        detail: inside
          ? `Quay đầu ngay lập tức! Bạn đã đi vào ${h.name}.`
          : `Cách ranh giới ${h.name} chỉ ${Math.round(dist)}m. Đổi hướng ngay!`,
        distanceM: dist
      });
    } else if (h.kind === 'quarry' && dist < 120) {
      alerts.push({
        level: 'critical',
        kind: 'quarry',
        title: `⚠️ CẨN THẬN VÁCH ĐÁ SÂU: ${h.name}`,
        detail: `Cách mép mỏ khai thác đá ${Math.round(dist)}m — nguy cơ vách dựng đứng!`,
        distanceM: dist
      });
    }
  }

  // 2. Check Full 220kV Powerline Corridor + Researched Hazard & Warning Points
  const powerDist = minDistanceToPowerlinesM(lat, lon, dataset);
  if (powerDist < 90) {
    alerts.push({
      level: 'warning',
      kind: 'pipe-trap',
      title: `⚡ SÁT HÀNH LANG ĐIỆN CAO THẾ 220kV (${Math.round(powerDist)}m)`,
      detail: 'Từ trường đường dây 220kV gây lệch kim la bàn từ kế! Hãy nhìn mũi tên xanh "Hướng Đi GPS" và không trú mưa dưới chân cột điện.',
      distanceM: powerDist
    });
  }

  for (const w of dataset.pois) {
    if (w.category !== 'warning') continue;
    if (
      w.id === 'hazard-lam-son-range' ||
      w.id === 'hazard-ho-da-xanh-quarry' ||
      w.id === 'hazard-220kv-magnetic'
    ) {
      continue; // handled accurately by full polygon / polyline geometry above
    }
    const d = haversineDistanceM(lat, lon, w.lat, w.lon);
    if (d < 135) {
      alerts.push({
        level: w.id.includes('cliff') ? 'critical' : 'warning',
        kind: 'pipe-trap',
        title: `${w.name} (cách ${Math.round(d)}m)`,
        detail: w.note,
        distanceM: d
      });
    }
  }

  if (insideMassif) {
    // 2b. Live Real-Time SRTM Slope Steepness Alert (> 36° anywhere on mountain!)
    const liveSlope = sampleDemSlopeDeg(dataset.dem, dataset.bounds, lat, lon);
    if (liveSlope >= 36) {
      alerts.push({
        level: 'critical',
        kind: 'quarry',
        title: `🧗 ĐỊA HÌNH DỐC ĐỨNG ${Math.round(liveSlope)}° NGAY DƯỚI CHÂN!`,
        detail: 'Dữ liệu độ cao vệ tinh cảnh báo vách dốc cực gắt (>36°). Giữ trọng tâm thấp, cẩn thận đá lăn/trượt chân!',
        distanceM: 0
      });
    }

    // 3. Check Distance to Nearest Trail (only above 85m elevation in forest core)
    const ele = sampleDemElevation(dataset.dem, dataset.bounds, lat, lon);
    if (ele > 85) {
      let nearestTrailDist = Infinity;
      for (const tr of dataset.trails) {
        const d = minDistanceToPolylineM(lat, lon, tr.coords);
        if (d < nearestTrailDist) nearestTrailDist = d;
        if (nearestTrailDist < 20) break;
      }
      if (nearestTrailDist > 75) {
        alerts.push({
          level: 'warning',
          kind: 'offtrail',
          title: `🧭 Đang lệch khỏi đường mòn ${Math.round(nearestTrailDist)}m`,
          detail: 'Bạn đang cắt rừng ngoài 281 lối mòn đã ghi nhận. Bật "Vết chân" để tránh lạc!',
          distanceM: nearestTrailDist
        });
      }
    }
  }

  return alerts;
}

export function parseGpxText(xmlText: string, dem: DemGrid, bounds: GeoBounds): {
  trackPoints: [number, number, number][];
  waypoints: { name: string; lat: number; lon: number; ele: number }[];
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const trkpts = Array.from(doc.querySelectorAll('trkpt, rtept'));
  const trackPoints: [number, number, number][] = [];
  for (const pt of trkpts) {
    const lat = parseFloat(pt.getAttribute('lat') || '');
    const lon = parseFloat(pt.getAttribute('lon') || '');
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const eleNode = pt.querySelector('ele');
    const ele = eleNode ? parseFloat(eleNode.textContent || '0') : sampleDemElevation(dem, bounds, lat, lon);
    trackPoints.push([lat, lon, ele]);
  }
  const wpts = Array.from(doc.querySelectorAll('wpt'));
  const waypoints: { name: string; lat: number; lon: number; ele: number }[] = [];
  for (const w of wpts) {
    const lat = parseFloat(w.getAttribute('lat') || '');
    const lon = parseFloat(w.getAttribute('lon') || '');
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
    const name = w.querySelector('name')?.textContent || 'Điểm GPX';
    const eleNode = w.querySelector('ele');
    const ele = eleNode ? parseFloat(eleNode.textContent || '0') : sampleDemElevation(dem, bounds, lat, lon);
    waypoints.push({ name, lat, lon, ele: Math.round(ele) });
  }
  return { trackPoints, waypoints };
}

export function buildGpxExport(track: TrackPoint[], pins: UserPin[]): string {
  const now = new Date().toISOString();
  const wptXml = pins
    .map(
      (p) => `  <wpt lat="${p.lat}" lon="${p.lon}">
    <ele>${p.ele}</ele>
    <name>${escapeXml(p.name)}</name>
    <desc>${escapeXml(`[${p.category}] ${p.note || ''}`)}</desc>
  </wpt>`
    )
    .join('\n');

  const trkXml = track
    .map(
      (t) => `      <trkpt lat="${t.lat}" lon="${t.lon}">
        <ele>${t.ele}</ele>
        <time>${new Date(t.timestamp).toISOString()}</time>
      </trkpt>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Dinh Ops 3D Tactical Offline GPS" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Nui Dinh Tactical Session ${now.slice(0, 10)}</name>
    <time>${now}</time>
  </metadata>
${wptXml}
  <trk>
    <name>Vết chân Núi Dinh</name>
    <trkseg>
${trkXml}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] || c));
}

export interface BearingIntersectionResult {
  status: 'ok' | 'parallel' | 'diverging';
  lat: number | null;
  lon: number | null;
  dist1M: number;
  dist2M: number;
  crossAngleDeg: number;
  baselineM: number;
}

/**
 * Bearing-Bearing Triangulation: Find intersection of two compass sight rays from A(lat1,lon1) and B(lat2,lon2).
 */
export function intersectTwoBearings(
  lat1: number,
  lon1: number,
  brng1Deg: number,
  lat2: number,
  lon2: number,
  brng2Deg: number
): BearingIntersectionResult {
  const { mPerLat, mPerLon } = wgs84MetersPerDeg((lat1 + lat2) / 2);
  const dx = (lon2 - lon1) * mPerLon;
  const dy = (lat2 - lat1) * mPerLat;
  const baselineM = Math.hypot(dx, dy);

  const b1 = (((brng1Deg % 360) + 360) % 360) * DEG_TO_RAD;
  const b2 = (((brng2Deg % 360) + 360) % 360) * DEG_TO_RAD;
  const det = Math.sin(b2 - b1);
  const crossAngleDeg = Number(((Math.asin(Math.min(1, Math.abs(det))) * 180) / Math.PI).toFixed(1));

  if (Math.abs(det) < 0.04 || baselineM < 0.5) {
    return {
      status: 'parallel',
      lat: null,
      lon: null,
      dist1M: 0,
      dist2M: 0,
      crossAngleDeg,
      baselineM
    };
  }

  const t1 = (dy * Math.sin(b2) - dx * Math.cos(b2)) / det;
  const t2 = (dy * Math.sin(b1) - dx * Math.cos(b1)) / det;
  const ix = t1 * Math.sin(b1);
  const iy = t1 * Math.cos(b1);

  return {
    status: t1 >= 0 && t2 >= 0 ? 'ok' : 'diverging',
    lat: Number((lat1 + iy / mPerLat).toFixed(6)),
    lon: Number((lon1 + ix / mPerLon).toFixed(6)),
    dist1M: t1,
    dist2M: t2,
    crossAngleDeg,
    baselineM
  };
}

export interface CircleIntersectionResult {
  status: 'ok' | 'too_far' | 'contained' | 'concentric';
  p1: { lat: number; lon: number } | null;
  p2: { lat: number; lon: number } | null;
  approx: { lat: number; lon: number } | null;
  baselineM: number;
}

/**
 * Range-Range Trilateration: Find intersection points of two distance circles around A and B.
 */
export function intersectTwoCircles(
  lat1: number,
  lon1: number,
  r1M: number,
  lat2: number,
  lon2: number,
  r2M: number
): CircleIntersectionResult {
  const { mPerLat, mPerLon } = wgs84MetersPerDeg((lat1 + lat2) / 2);
  const dx = (lon2 - lon1) * mPerLon;
  const dy = (lat2 - lat1) * mPerLat;
  const d = Math.hypot(dx, dy);

  if (d < 0.1) {
    return { status: 'concentric', p1: null, p2: null, approx: null, baselineM: d };
  }

  if (d > r1M + r2M + 0.01) {
    const ratio = r1M / Math.max(0.01, r1M + r2M);
    const ax = dx * ratio;
    const ay = dy * ratio;
    return {
      status: 'too_far',
      p1: null,
      p2: null,
      approx: {
        lat: Number((lat1 + ay / mPerLat).toFixed(6)),
        lon: Number((lon1 + ax / mPerLon).toFixed(6))
      },
      baselineM: d
    };
  }

  if (d < Math.abs(r1M - r2M) - 0.01) {
    const sign = r1M >= r2M ? 1 : -1;
    const distAlong = sign * ((r1M + (d - r2M * sign)) / 2);
    const ax = (dx / d) * distAlong;
    const ay = (dy / d) * distAlong;
    return {
      status: 'contained',
      p1: null,
      p2: null,
      approx: {
        lat: Number((lat1 + ay / mPerLat).toFixed(6)),
        lon: Number((lon1 + ax / mPerLon).toFixed(6))
      },
      baselineM: d
    };
  }

  const a = (r1M * r1M - r2M * r2M + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1M * r1M - a * a));
  const mx = (a / d) * dx;
  const my = (a / d) * dy;
  const nx = -dy / d;
  const ny = dx / d;

  const p1 = {
    lat: Number((lat1 + (my + h * ny) / mPerLat).toFixed(6)),
    lon: Number((lon1 + (mx + h * nx) / mPerLon).toFixed(6))
  };
  const p2 = {
    lat: Number((lat1 + (my - h * ny) / mPerLat).toFixed(6)),
    lon: Number((lon1 + (mx - h * nx) / mPerLon).toFixed(6))
  };

  return { status: 'ok', p1, p2, approx: p1, baselineM: d };
}

// ============================================================================
// GTA V-STYLE TRAIL-NETWORK TACTICAL ROUTING ENGINE (OFFLINE A* ON 281 TRAILS)
// ============================================================================

interface TrailGraphEdge {
  to: number;
  w: number;
}

interface TrailGraph {
  pts: [number, number][];
  adj: TrailGraphEdge[][];
}

const trailGraphCache = new WeakMap<NuiDinhDataset, TrailGraph>();

function getOrBuildTrailGraph(dataset: NuiDinhDataset): TrailGraph {
  const cached = trailGraphCache.get(dataset);
  if (cached) return cached;

  const pts: [number, number][] = [];
  const adj: TrailGraphEdge[][] = [];
  const trailOf: number[] = [];
  const grid = new Map<string, number[]>();
  const BUCKET_M = 60;
  const bucketKey = (lat: number, lon: number) =>
    `${Math.floor((lat * METERS_PER_DEG_LAT) / BUCKET_M)},${Math.floor((lon * METERS_PER_DEG_LON) / BUCKET_M)}`;

  const distFastM = (a: [number, number], b: [number, number]) =>
    Math.hypot((a[0] - b[0]) * METERS_PER_DEG_LAT, (a[1] - b[1]) * METERS_PER_DEG_LON);

  dataset.trails.forEach((trail, trailIdx) => {
    const isMainRoute = trail.routes && trail.routes.length > 0;
    const costFactor = isMainRoute ? 0.85 : 1.0;
    const ids: number[] = [];

    for (const [lat, lon] of trail.coords) {
      const id = pts.length;
      pts.push([lat, lon]);
      adj.push([]);
      trailOf.push(trailIdx);
      ids.push(id);

      const k = bucketKey(lat, lon);
      let bucket = grid.get(k);
      if (!bucket) {
        bucket = [];
        grid.set(k, bucket);
      }
      bucket.push(id);
    }

    for (let i = 0; i < ids.length - 1; i++) {
      const u = ids[i];
      const v = ids[i + 1];
      const w = Math.max(0.2, distFastM(pts[u], pts[v]) * costFactor);
      adj[u].push({ to: v, w });
      adj[v].push({ to: u, w });
    }
  });

  // Connect nearby trail intersections across different trail polylines (< 45m)
  for (let u = 0; u < pts.length; u++) {
    const [lat, lon] = pts[u];
    const gx = Math.floor((lat * METERS_PER_DEG_LAT) / BUCKET_M);
    const gy = Math.floor((lon * METERS_PER_DEG_LON) / BUCKET_M);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${gx + dx},${gy + dy}`);
        if (!bucket) continue;
        for (const v of bucket) {
          if (v <= u || trailOf[u] === trailOf[v]) continue;
          const dM = distFastM(pts[u], pts[v]);
          if (dM <= 45) {
            const w = dM < 3 ? Math.max(0.2, dM) : dM * 1.55;
            adj[u].push({ to: v, w });
            adj[v].push({ to: u, w });
          }
        }
      }
    }
  }

  const graph: TrailGraph = { pts, adj };
  trailGraphCache.set(dataset, graph);
  return graph;
}

function findNearestTrailNode(graph: TrailGraph, lat: number, lon: number): { idx: number; distM: number } {
  let bestIdx = -1;
  let bestSq = Infinity;
  const { pts } = graph;
  for (let i = 0; i < pts.length; i++) {
    const dy = (pts[i][0] - lat) * METERS_PER_DEG_LAT;
    const dx = (pts[i][1] - lon) * METERS_PER_DEG_LON;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      bestIdx = i;
    }
  }
  return { idx: bestIdx, distM: Math.sqrt(bestSq) };
}

function aStarTrailPath(graph: TrailGraph, startIdx: number, goalIdx: number): number[] | null {
  const n = graph.pts.length;
  if (startIdx < 0 || goalIdx < 0 || startIdx >= n || goalIdx >= n) return null;
  if (startIdx === goalIdx) return [startIdx];

  const { pts, adj } = graph;
  const [goalLat, goalLon] = pts[goalIdx];

  const gScore = new Float64Array(n);
  gScore.fill(Infinity);
  const parent = new Int32Array(n);
  parent.fill(-1);
  const closed = new Uint8Array(n);

  const heuristicM = (idx: number) =>
    Math.hypot((pts[idx][0] - goalLat) * METERS_PER_DEG_LAT, (pts[idx][1] - goalLon) * METERS_PER_DEG_LON) * 0.85;

  // Compact parallel-array binary min-heap
  const heapNodes: number[] = [startIdx];
  const heapF: number[] = [heuristicM(startIdx)];
  gScore[startIdx] = 0;

  const pushHeap = (node: number, f: number) => {
    let i = heapNodes.length;
    heapNodes.push(node);
    heapF.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= f) break;
      heapNodes[i] = heapNodes[p];
      heapF[i] = heapF[p];
      i = p;
    }
    heapNodes[i] = node;
    heapF[i] = f;
  };

  const popHeap = (): number => {
    const top = heapNodes[0];
    const lastNode = heapNodes.pop()!;
    const lastF = heapF.pop()!;
    const len = heapNodes.length;
    if (len > 0) {
      let i = 0;
      while (true) {
        const l = (i << 1) + 1;
        const r = l + 1;
        if (l >= len) break;
        const smallest = r < len && heapF[r] < heapF[l] ? r : l;
        if (lastF <= heapF[smallest]) break;
        heapNodes[i] = heapNodes[smallest];
        heapF[i] = heapF[smallest];
        i = smallest;
      }
      heapNodes[i] = lastNode;
      heapF[i] = lastF;
    }
    return top;
  };

  while (heapNodes.length > 0) {
    const u = popHeap();
    if (closed[u]) continue;
    if (u === goalIdx) {
      const chain: number[] = [];
      for (let cur = goalIdx; cur !== -1; cur = parent[cur]) {
        chain.push(cur);
      }
      chain.reverse();
      return chain;
    }
    closed[u] = 1;

    const edges = adj[u];
    const baseG = gScore[u];
    for (let i = 0; i < edges.length; i++) {
      const { to: v, w } = edges[i];
      if (closed[v]) continue;
      const candG = baseG + w;
      if (candG < gScore[v]) {
        gScore[v] = candG;
        parent[v] = u;
        pushHeap(v, candG + heuristicM(v));
      }
    }
  }

  return null;
}

function summarizeRouteMetrics(
  points: [number, number][],
  dataset: NuiDinhDataset
): { totalDistanceM: number; ascentM: number; descentM: number; etaMinutes: number } {
  if (points.length < 2) {
    return { totalDistanceM: 0, ascentM: 0, descentM: 0, etaMinutes: 0 };
  }
  let totalDistanceM = 0;
  let ascentM = 0;
  let descentM = 0;
  let prevEle = sampleDemElevation(dataset.dem, dataset.bounds, points[0][0], points[0][1]);

  for (let i = 1; i < points.length; i++) {
    totalDistanceM += haversineDistanceM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    const ele = sampleDemElevation(dataset.dem, dataset.bounds, points[i][0], points[i][1]);
    const diff = ele - prevEle;
    if (diff > 0) ascentM += diff;
    else descentM += -diff;
    prevEle = ele;
  }

  // Naismith mountain pacing: ~3.6 km/h horizontal + climb effort
  const rawMinutes = totalDistanceM / 60 + ascentM / 10;
  const etaMinutes = totalDistanceM > 15 ? Math.max(1, Math.round(rawMinutes)) : 0;

  return {
    totalDistanceM: Math.round(totalDistanceM),
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM),
    etaMinutes
  };
}

function dedupeAndSmoothRoutePoints(rawPts: [number, number][]): [number, number][] {
  const deduped: [number, number][] = [];
  for (const pt of rawPts) {
    if (deduped.length === 0) {
      deduped.push(pt);
      continue;
    }
    const prev = deduped[deduped.length - 1];
    const dM = Math.hypot((pt[0] - prev[0]) * METERS_PER_DEG_LAT, (pt[1] - prev[1]) * METERS_PER_DEG_LON);
    if (dM >= 1.5) {
      deduped.push(pt);
    }
  }
  if (rawPts.length >= 2) {
    const lastRaw = rawPts[rawPts.length - 1];
    const lastOut = deduped[deduped.length - 1];
    if (lastOut[0] !== lastRaw[0] || lastOut[1] !== lastRaw[1]) {
      deduped[deduped.length - 1] = lastRaw;
    }
  }
  if (deduped.length < 2) return deduped;
  return subdivideLatLonRun(deduped, 18);
}

/**
 * GTA V-Style Tactical Trail-Network Routing Engine (A* over 281 forest trails & 4 main routes)
 */
export function computeTacticalTrailRoute(
  dataset: NuiDinhDataset,
  startLat: number,
  startLon: number,
  destLat: number,
  destLon: number,
  destName?: string
): TacticalRouteResult {
  const destEle = Math.round(sampleDemElevation(dataset.dem, dataset.bounds, destLat, destLon));
  const resolvedName = destName || `Mục tiêu (${destEle}m)`;
  const directDistM = haversineDistanceM(startLat, startLon, destLat, destLon);

  const graph = getOrBuildTrailGraph(dataset);
  const sHit = findNearestTrailNode(graph, startLat, startLon);
  const eHit = findNearestTrailNode(graph, destLat, destLon);

  let rawPts: [number, number][] = [
    [startLat, startLon],
    [destLat, destLon]
  ];
  let snappedToTrail = false;

  if (
    directDistM >= 60 &&
    sHit.idx >= 0 &&
    eHit.idx >= 0 &&
    sHit.distM <= 450 &&
    eHit.distM <= 450 &&
    sHit.distM + eHit.distM < directDistM * 0.9
  ) {
    const nodeChain = aStarTrailPath(graph, sHit.idx, eHit.idx);
    if (nodeChain && nodeChain.length >= 2) {
      rawPts = [[startLat, startLon], ...nodeChain.map((id) => graph.pts[id]), [destLat, destLon]];
      snappedToTrail = true;
    }
  }

  const points = dedupeAndSmoothRoutePoints(rawPts);
  const metrics = summarizeRouteMetrics(points, dataset);

  return {
    id: `gta-route-${Date.now()}`,
    destName: resolvedName,
    destLat: Number(destLat.toFixed(6)),
    destLon: Number(destLon.toFixed(6)),
    destEle,
    points,
    ...metrics,
    snappedToTrail
  };
}

/**
 * Progressively trims completed GTA V tactical route behind the player, or reroutes if off-course > 85m.
 */
export function trimRouteFromPlayer(
  route: TacticalRouteResult,
  playerLat: number,
  playerLon: number,
  dataset: NuiDinhDataset
): TacticalRouteResult {
  if (route.points.length < 2) return route;

  let bestSegIdx = 0;
  let bestT = 0;
  let bestProjLat = route.points[0][0];
  let bestProjLon = route.points[0][1];
  let bestDistM = Infinity;

  for (let i = 0; i < route.points.length - 1; i++) {
    const [lat1, lon1] = route.points[i];
    const [lat2, lon2] = route.points[i + 1];
    const ax = (lon1 - playerLon) * METERS_PER_DEG_LON;
    const ay = (lat1 - playerLat) * METERS_PER_DEG_LAT;
    const bx = (lon2 - playerLon) * METERS_PER_DEG_LON;
    const by = (lat2 - playerLat) * METERS_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? -(ax * dx + ay * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const dM = Math.hypot(px, py);
    if (dM < bestDistM) {
      bestDistM = dM;
      bestSegIdx = i;
      bestT = t;
      bestProjLat = lat1 + (lat2 - lat1) * t;
      bestProjLon = lon1 + (lon2 - lon1) * t;
    }
  }

  if (bestDistM > 85) {
    const rerouted = computeTacticalTrailRoute(
      dataset,
      playerLat,
      playerLon,
      route.destLat,
      route.destLon,
      route.destName
    );
    return { ...rerouted, id: route.id };
  }

  const remaining: [number, number][] = [[playerLat, playerLon]];
  if (bestDistM > 3 && bestT < 0.96) {
    remaining.push([bestProjLat, bestProjLon]);
  }
  for (let i = bestSegIdx + 1; i < route.points.length; i++) {
    remaining.push(route.points[i]);
  }
  if (remaining.length < 2) {
    remaining.push([route.destLat, route.destLon]);
  }

  const points = dedupeAndSmoothRoutePoints(remaining);
  const metrics = summarizeRouteMetrics(points, dataset);
  return {
    ...route,
    points,
    ...metrics
  };
}

// ============================================================================
// AR OPTICAL & 3D DEM RANGEFINDER ENGINE (100% Offline, Gimbal-Lock-Free)
// ============================================================================

/**
 * Exact 3D W3C DeviceOrientation (Z-X'-Y'' intrinsic) camera elevation & horizon roll.
 * - cameraPitchDeg: 0° = camera aimed level at true horizon, +30° = 30° UP, -20° = 20° DOWN, -90° = flat face-up.
 * - cameraRollDeg:  0° = landscape/portrait screen perfectly level with horizon.
 * Immune to the 180° gimbal-lock jump at gamma = ±90° in Landscape mode!
 */
export function computeCameraAttitude(
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number
): { pitchDeg: number; rollDeg: number } {
  const b = betaDeg * DEG_TO_RAD;
  const g = gammaDeg * DEG_TO_RAD;
  const s = screenAngleDeg * DEG_TO_RAD;
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cg = Math.cos(g);
  const sg = Math.sin(g);

  // World UP vector expressed in Device coordinates (3rd row of R = Rz(a) * Rx(b) * Ry(g))
  const upX = -cb * sg;
  const upY = sb;
  const upZ = cb * cg;

  // Back camera points along -Z_dev -> elevation angle above horizon is asin(-upZ)
  const lookUp = Math.max(-1, Math.min(1, -upZ));
  const pitchDeg = Math.asin(lookUp) * RAD_TO_DEG;

  // Screen right & up vectors in Device coordinates for current orientation
  const cs = Math.cos(s);
  const ss = Math.sin(s);
  const uRight = upX * cs - upY * ss;
  const uUp = upX * ss + upY * cs;
  const rollDeg = Math.atan2(uRight, uUp) * RAD_TO_DEG;

  return { pitchDeg, rollDeg };
}

export interface GroundTiltRangeResult {
  valid: boolean;
  horizDistM: number;
  slantDistM: number;
  errorAt1DegM: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Close-range (1.5m - 120m) level-ground optical rangefinder by sighting the BASE of an object.
 * D = h_eye / tan(|pitch|) when pitch < 0 (aiming downward below horizon).
 * Includes real differential sensitivity |dD/dθ| for ±1° sensor error so users know exact accuracy!
 */
export function computeGroundTiltRangeM(eyeHeightM: number, pitchDeg: number): GroundTiltRangeResult {
  const h = Math.max(0.3, eyeHeightM);
  if (pitchDeg >= -0.6) {
    return {
      valid: false,
      horizDistM: 0,
      slantDistM: 0,
      errorAt1DegM: 0,
      confidence: 'low',
      reason: 'Hãy nghiêng tâm ngắm XUỐNG chạm chân vật trên mặt đất (góc âm < −1°)'
    };
  }
  const absDeg = Math.min(86, Math.abs(pitchDeg));
  const rad = absDeg * DEG_TO_RAD;
  const horizDistM = h / Math.tan(rad);
  const slantDistM = h / Math.sin(rad);
  // Differential sensitivity: |dD/dθ| * 1° = ((D^2 + h^2) / h) * (pi / 180)
  const errorAt1DegM = ((horizDistM * horizDistM + h * h) / h) * DEG_TO_RAD;

  let confidence: 'high' | 'medium' | 'low' = 'high';
  let reason = 'Góc ngắm đẹp — sai số cảm biến thấp';
  if (absDeg < 2.5 || horizDistM > 38) {
    confidence = 'low';
    reason = 'Góc quá nông (<2.5°) nên 1° lệch làm sai số lớn — nên chuyển sang Địa hình 3D hoặc Khung vật';
  } else if (absDeg < 6.0 || horizDistM > 16) {
    confidence = 'medium';
    reason = 'Độ chính xác khá — giữ chắc 2 tay và cân bằng vạch chân trời xanh';
  }

  return {
    valid: true,
    horizDistM,
    slantDistM,
    errorAt1DegM,
    confidence,
    reason
  };
}

/**
 * Optical stadiametric rangefinder: measures distance by framing an object of known real height
 * inside a calibrated fraction (0..1) of the landscape camera frame height.
 * D = H_real / (2 * bracketFraction * tan(vFOV / 2))
 */
export function computeStadiametricRangeM(
  objectHeightM: number,
  bracketFraction: number,
  verticalFovDeg = 46
): number {
  const h = Math.max(0.1, objectHeightM);
  const f = Math.max(0.02, Math.min(0.98, bracketFraction));
  const halfFovRad = (Math.max(15, Math.min(110, verticalFovDeg)) / 2) * DEG_TO_RAD;
  return h / (2 * f * Math.tan(halfFovRad));
}

/**
 * Solve exact camera vertical FOV (degrees) during 5-second calibration at known distance (e.g. 3m / 5m).
 */
export function calibrateVerticalFovDeg(
  objectHeightM: number,
  bracketFraction: number,
  knownDistM: number
): number {
  const h = Math.max(0.1, objectHeightM);
  const f = Math.max(0.02, Math.min(0.98, bracketFraction));
  const d = Math.max(0.5, knownDistM);
  const vFov = 2 * Math.atan(h / (2 * f * d)) * RAD_TO_DEG;
  return Math.max(20, Math.min(95, Number(vFov.toFixed(1))));
}

export interface DemRaycastRangeResult {
  hit: boolean;
  horizDistM: number;
  slantDistM: number;
  lat: number;
  lon: number;
  targetEle: number;
  eleDiffM: number;
  reason?: string;
}

/**
 * 3D DEM Terrain Ray-Marching Rangefinder (50m - 5,000m) over Nui Dinh Copernicus GLO-30 256x256 DEM.
 * Shoots a 3D optical ray from (originLat, originLon, groundEle + eyeHeightM) along (azimuthDeg, pitchDeg),
 * includes Earth curvature correction, and refines exact mountain intersection via binary search!
 */
export function raycastDemDistance(
  dataset: NuiDinhDataset,
  originLat: number,
  originLon: number,
  eyeHeightM: number,
  azimuthDeg: number,
  pitchDeg: number,
  maxDistM = 5000
): DemRaycastRangeResult {
  const { bounds, dem } = dataset;
  if (
    originLat < bounds.south ||
    originLat > bounds.north ||
    originLon < bounds.west ||
    originLon > bounds.east
  ) {
    return {
      hit: false,
      horizDistM: 0,
      slantDistM: 0,
      lat: originLat,
      lon: originLon,
      targetEle: 0,
      eleDiffM: 0,
      reason: 'Vị trí hiện tại đang ở ngoài khung 3D Núi Dinh (dùng Chân Vật hoặc Khung Vật)'
    };
  }

  const originGroundEle = sampleDemElevation(dem, bounds, originLat, originLon);
  const startEle = originGroundEle + Math.max(0.5, eyeHeightM);
  const azRad = (((azimuthDeg % 360) + 360) % 360) * DEG_TO_RAD;
  const clampedPitch = Math.max(-84, Math.min(84, pitchDeg));
  const tanPitch = Math.tan(clampedPitch * DEG_TO_RAD);
  const { mPerLat, mPerLon } = wgs84MetersPerDeg(originLat);
  const sinAz = Math.sin(azRad);
  const cosAz = Math.cos(azRad);

  const evalAtDist = (d: number) => {
    const lat = originLat + (d * cosAz) / mPerLat;
    const lon = originLon + (d * sinAz) / mPerLon;
    const inBounds = lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
    // Earth curvature drop: d^2 / (2 * R_earth)
    const rayEle = startEle + d * tanPitch - (d * d) / (2 * EARTH_RADIUS_M);
    const groundEle = inBounds ? sampleDemElevation(dem, bounds, lat, lon) : -9999;
    return { lat, lon, inBounds, rayEle, groundEle };
  };

  const stepM = 12;
  let prevD = 0;
  for (let d = stepM; d <= maxDistM; d += stepM) {
    const sample = evalAtDist(d);
    if (!sample.inBounds) {
      return {
        hit: false,
        horizDistM: 0,
        slantDistM: 0,
        lat: originLat,
        lon: originLon,
        targetEle: Math.round(originGroundEle),
        eleDiffM: 0,
        reason: 'Tia ngắm đã đi ra ngoài biên Núi Dinh (đang chĩa lên trời hoặc ra đồng bằng)'
      };
    }

    if (sample.rayEle <= sample.groundEle) {
      // Binary search refinement between prevD and d -> < 0.02m precision!
      let lo = prevD;
      let hi = d;
      for (let iter = 0; iter < 10; iter++) {
        const mid = (lo + hi) * 0.5;
        const mSample = evalAtDist(mid);
        if (mSample.rayEle <= mSample.groundEle) hi = mid;
        else lo = mid;
      }
      const hitSample = evalAtDist(hi);
      const eleDiffM = hitSample.groundEle - originGroundEle;
      const slantDistM = Math.hypot(hi, hitSample.groundEle - startEle);
      return {
        hit: true,
        horizDistM: hi,
        slantDistM,
        lat: Number(hitSample.lat.toFixed(6)),
        lon: Number(hitSample.lon.toFixed(6)),
        targetEle: Math.round(hitSample.groundEle),
        eleDiffM: Math.round(eleDiffM)
      };
    }
    prevD = d;
  }

  return {
    hit: false,
    horizDistM: 0,
    slantDistM: 0,
    lat: originLat,
    lon: originLon,
    targetEle: Math.round(originGroundEle),
    eleDiffM: 0,
    reason: 'Tia ngắm vượt quá đỉnh núi / chĩa lên trời — hãy hạ góc camera chạm vào sườn núi'
  };
}
