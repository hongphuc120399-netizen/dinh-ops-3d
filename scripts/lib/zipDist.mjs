import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';

// Precompute IEEE 802.3 CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function collectFilesRecursively(rootDir, curDir = rootDir, out = []) {
  const entries = fs.readdirSync(curDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const abs = path.join(curDir, ent.name);
    if (ent.isDirectory()) {
      collectFilesRecursively(rootDir, abs, out);
    } else if (ent.isFile()) {
      const relPosix = path.relative(rootDir, abs).split(path.sep).join('/');
      if (relPosix && !relPosix.startsWith('./') && !relPosix.includes('..')) {
        out.push({ abs, relPosix });
      }
    }
  }
  return out;
}

function toDosTimeDate(mtimeMs) {
  const d = new Date(mtimeMs);
  const year = Math.max(1980, d.getFullYear());
  const dosTime =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Pure-Node PKZIP archiver ensuring strict forward-slash POSIX entry names
 * required by Android ZipInputStream / CapacitorUpdater.
 */
export function zipDistDir(sourceDir, outZipPath) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Thư mục build không tồn tại: ${sourceDir}`);
  }
  const files = collectFilesRecursively(sourceDir);
  if (!files.some((f) => f.relPosix === 'index.html')) {
    throw new Error(`Không tìm thấy index.html ở thư mục gốc ${sourceDir}!`);
  }

  fs.mkdirSync(path.dirname(outZipPath), { recursive: true });

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const raw = fs.readFileSync(f.abs);
    const stat = fs.statSync(f.abs);
    const { dosTime, dosDate } = toDosTimeDate(stat.mtimeMs);
    const crc = crc32(raw);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = compressed.length < raw.length;
    const method = useDeflate ? 8 : 0;
    const payload = useDeflate ? compressed : raw;
    const nameBuf = Buffer.from(f.relPosix, 'utf8');

    // Local file header (30 bytes + filename)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed 2.0
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(dosTime, 10);
    lfh.writeUInt16LE(dosDate, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra len

    localParts.push(lfh, nameBuf, payload);

    // Central directory header (46 bytes + filename)
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(0x031e, 4); // UNIX creator version 3.0
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(dosTime, 12);
    cdh.writeUInt16LE(dosDate, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(payload.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra len
    cdh.writeUInt16LE(0, 32); // comment len
    cdh.writeUInt16LE(0, 34); // disk start
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE((0o100644 << 16) >>> 0, 38); // POSIX regular file attrs
    cdh.writeUInt32LE(offset, 42);

    centralParts.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const finalBuf = Buffer.concat([...localParts, centralBuf, eocd]);
  fs.writeFileSync(outZipPath, finalBuf);
  const sha256 = crypto.createHash('sha256').update(finalBuf).digest('hex');

  return {
    zipPath: outZipPath,
    sizeBytes: finalBuf.length,
    sha256,
    fileCount: files.length,
    entries: files.map((f) => f.relPosix)
  };
}
