import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DATASET_PATH = path.resolve('src/data/nuiDinhDataset.json');
const COG_URL =
  'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N10_00_E107_00_DEM/Copernicus_DSM_COG_10_N10_00_E107_00_DEM.tif';

const TARGET_COLS = 256;
const TARGET_ROWS = 256;

async function fetchRange(start, end) {
  const res = await fetch(COG_URL, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok && res.status !== 206) {
    throw new Error(`HTTP ${res.status} fetching bytes=${start}-${end}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function pointInPolygon(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

async function loadCopernicusSampler(bounds) {
  console.log('Downloading Copernicus DEM GLO-30 (TanDEM-X 30m) COG header...');
  const hdr = await fetchRange(0, 65535);
  const le = hdr.toString('ascii', 0, 2) === 'II';
  const rU16 = (b, o) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const rU32 = (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const rF64 = (b, o) => (le ? b.readDoubleLE(o) : b.readDoubleBE(o));

  if (rU16(hdr, 2) !== 42) throw new Error('Expected classic TIFF (magic 42)');
  const ifdOff = rU32(hdr, 4);
  const numEntries = rU16(hdr, ifdOff);
  const tags = new Map();
  for (let i = 0; i < numEntries; i++) {
    const eo = ifdOff + 2 + i * 12;
    tags.set(rU16(hdr, eo), {
      type: rU16(hdr, eo + 2),
      count: rU32(hdr, eo + 4),
      valOff: rU32(hdr, eo + 8),
      rawOff: eo + 8
    });
  }

  const getSingleInt = (tag) => {
    const t = tags.get(tag);
    return t.type === 3 ? rU16(hdr, t.rawOff) : rU32(hdr, t.rawOff);
  };
  const getU32Array = async (tag) => {
    const t = tags.get(tag);
    if (t.count === 1) return [rU32(hdr, t.rawOff)];
    const bytes = t.count * 4;
    const buf =
      t.valOff + bytes <= hdr.length ? hdr.subarray(t.valOff, t.valOff + bytes) : await fetchRange(t.valOff, t.valOff + bytes - 1);
    return Array.from({ length: t.count }, (_, i) => rU32(buf, i * 4));
  };
  const getF64Array = async (tag) => {
    const t = tags.get(tag);
    const bytes = t.count * 8;
    const buf =
      t.valOff + bytes <= hdr.length ? hdr.subarray(t.valOff, t.valOff + bytes) : await fetchRange(t.valOff, t.valOff + bytes - 1);
    return Array.from({ length: t.count }, (_, i) => rF64(buf, i * 8));
  };

  const imgW = getSingleInt(256);
  const imgH = getSingleInt(257);
  const bps = getSingleInt(258);
  const compression = getSingleInt(259);
  const sampleFormat = tags.has(339) ? getSingleInt(339) : 1;
  const predictor = tags.has(317) ? getSingleInt(317) : 1;
  const tileW = getSingleInt(322);
  const tileH = getSingleInt(323);
  const tileOffsets = await getU32Array(324);
  const tileByteCounts = await getU32Array(325);
  const pixelScale = await getF64Array(33550);
  const tiePoint = await getF64Array(33922);

  let rasterType = 1; // 1 = PixelIsArea, 2 = PixelIsPoint
  const geoKeysTag = tags.get(34735);
  if (geoKeysTag) {
    const bytes = geoKeysTag.count * 2;
    const buf =
      geoKeysTag.valOff + bytes <= hdr.length
        ? hdr.subarray(geoKeysTag.valOff, geoKeysTag.valOff + bytes)
        : await fetchRange(geoKeysTag.valOff, geoKeysTag.valOff + bytes - 1);
    const nKeys = rU16(buf, 6);
    for (let k = 0; k < nKeys; k++) {
      if (rU16(buf, 8 + k * 8) === 1025) rasterType = rU16(buf, 8 + k * 8 + 6);
    }
  }

  const originLon = tiePoint[3];
  const originLat = tiePoint[4];
  const scaleX = pixelScale[0];
  const scaleY = pixelScale[1];
  const regShift = rasterType === 2 ? 0 : -0.5;
  const tilesAcross = Math.ceil(imgW / tileW);
  const tileCache = new Map();

  const latLonToPixel = (lat, lon) => ({
    fx: (lon - originLon) / scaleX + regShift,
    fy: (originLat - lat) / scaleY + regShift
  });

  const loadTile = async (tx, ty) => {
    const tid = ty * tilesAcross + tx;
    if (tileCache.has(tid)) return tileCache.get(tid);
    console.log(`Fetching Copernicus GLO-30 COG tile (${tx}, ${ty}) [${Math.round(tileByteCounts[tid] / 1024)} KB]...`);
    const rawComp = await fetchRange(tileOffsets[tid], tileOffsets[tid] + tileByteCounts[tid] - 1);
    const raw = compression === 8 || compression === 32946 ? zlib.inflateSync(rawComp) : rawComp;
    if (bps !== 32 || sampleFormat !== 3) {
      throw new Error(`Unexpected TIFF pixel format bps=${bps}, sampleFormat=${sampleFormat}`);
    }
    const out = new Float32Array(tileW * tileH);
    if (predictor === 3) {
      const rowBytes = tileW * 4;
      const unpred = Buffer.allocUnsafe(raw.length);
      for (let r = 0; r < tileH; r++) {
        const rowStart = r * rowBytes;
        const tmp = Buffer.allocUnsafe(rowBytes);
        for (let i = 0; i < rowBytes; i++) {
          tmp[i] = i === 0 ? raw[rowStart] : (raw[rowStart + i] + tmp[i - 1]) & 0xff;
        }
        for (let c = 0; c < tileW; c++) {
          if (le) {
            unpred[rowStart + c * 4 + 3] = tmp[c];
            unpred[rowStart + c * 4 + 2] = tmp[tileW + c];
            unpred[rowStart + c * 4 + 1] = tmp[tileW * 2 + c];
            unpred[rowStart + c * 4 + 0] = tmp[tileW * 3 + c];
          } else {
            unpred[rowStart + c * 4 + 0] = tmp[c];
            unpred[rowStart + c * 4 + 1] = tmp[tileW + c];
            unpred[rowStart + c * 4 + 2] = tmp[tileW * 2 + c];
            unpred[rowStart + c * 4 + 3] = tmp[tileW * 3 + c];
          }
        }
      }
      for (let i = 0; i < tileW * tileH; i++) {
        out[i] = le ? unpred.readFloatLE(i * 4) : unpred.readFloatBE(i * 4);
      }
    } else {
      for (let i = 0; i < tileW * tileH; i++) {
        out[i] = le ? raw.readFloatLE(i * 4) : raw.readFloatBE(i * 4);
      }
    }
    tileCache.set(tid, out);
    return out;
  };

  const pTL = latLonToPixel(bounds.north + 0.002, bounds.west - 0.002);
  const pBR = latLonToPixel(bounds.south - 0.002, bounds.east + 0.002);
  for (let ty = Math.floor(pTL.fy / tileH); ty <= Math.floor(pBR.fy / tileH); ty++) {
    for (let tx = Math.floor(pTL.fx / tileW); tx <= Math.floor(pBR.fx / tileW); tx++) {
      await loadTile(tx, ty);
    }
  }

  const getPixel = (ix, iy) => {
    const cx = Math.min(imgW - 1, Math.max(0, ix));
    const cy = Math.min(imgH - 1, Math.max(0, iy));
    const tx = Math.floor(cx / tileW);
    const ty = Math.floor(cy / tileH);
    const tile = tileCache.get(ty * tilesAcross + tx);
    return tile[(cy - ty * tileH) * tileW + (cx - tx * tileW)];
  };

  return (lat, lon) => {
    const { fx, fy } = latLonToPixel(lat, lon);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const u = fx - x0;
    const v = fy - y0;
    const e00 = getPixel(x0, y0);
    const e10 = getPixel(x0 + 1, y0);
    const e01 = getPixel(x0, y0 + 1);
    const e11 = getPixel(x0 + 1, y0 + 1);
    return (e00 * (1 - u) + e10 * u) * (1 - v) + (e01 * (1 - u) + e11 * u) * v;
  };
}

async function main() {
  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  const { bounds, lakes = [] } = dataset;
  const sampleCop30 = await loadCopernicusSampler(bounds);

  // Precompute hydro-flattened target water surface elevation (25th percentile shoreline) + bbox for each lake
  const lakeZones = lakes.map((l) => {
    let minLat = 99, maxLat = -99, minLon = 999, maxLon = -999;
    const edgeEles = [];
    for (const [lat, lon] of l.coords) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      edgeEles.push(sampleCop30(lat, lon));
    }
    edgeEles.sort((a, b) => a - b);
    const waterEle = Math.max(0, edgeEles[Math.floor(edgeEles.length * 0.25)]);
    return { id: l.id, name: l.name, coords: l.coords, minLat, maxLat, minLon, maxLon, waterEle };
  });

  const elevations = new Array(TARGET_COLS * TARGET_ROWS);
  let minEle = Infinity;
  let maxEle = -Infinity;
  let hydroFlattenedCount = 0;

  for (let r = 0; r < TARGET_ROWS; r++) {
    const lat = bounds.north - (r / (TARGET_ROWS - 1)) * (bounds.north - bounds.south);
    for (let c = 0; c < TARGET_COLS; c++) {
      const lon = bounds.west + (c / (TARGET_COLS - 1)) * (bounds.east - bounds.west);
      let ele = Math.max(0, sampleCop30(lat, lon));

      // Hydro-flatten interior cells of known lakes so 3D water planes never get poked by cliff bleed
      for (const lz of lakeZones) {
        if (lat >= lz.minLat && lat <= lz.maxLat && lon >= lz.minLon && lon <= lz.maxLon) {
          if (pointInPolygon(lat, lon, lz.coords)) {
            ele = Math.min(ele, lz.waterEle);
            hydroFlattenedCount++;
            break;
          }
        }
      }

      const rounded = Math.round(ele * 10) / 10;
      elevations[r * TARGET_COLS + c] = rounded;
      if (rounded < minEle) minEle = rounded;
      if (rounded > maxEle) maxEle = rounded;
    }
  }

  dataset.dem = {
    cols: TARGET_COLS,
    rows: TARGET_ROWS,
    minEle,
    maxEle,
    elevations
  };

  fs.writeFileSync(DATASET_PATH, JSON.stringify(dataset), 'utf8');
  const sizeKb = (fs.statSync(DATASET_PATH).size / 1024).toFixed(1);
  console.log(`✅ Upgraded DEM to Copernicus GLO-30 (${TARGET_COLS}x${TARGET_ROWS} = ${elevations.length} pts)`);
  console.log(`   minEle=${minEle}m, maxEle=${maxEle}m, hydroFlattenedLakeCells=${hydroFlattenedCount}`);
  console.log(`   nuiDinhDataset.json size=${sizeKb} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
