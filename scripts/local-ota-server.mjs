import fs from 'fs';
import http from 'http';
import os from 'os';
import { buildAndPackOtaBundle } from './lib/otaPacker.mjs';

const args = process.argv.slice(2);
const customNote = args.join(' ').trim();

const { manifest, zipPath, manifestPath, fileCount } = buildAndPackOtaBundle({
  bumpPatch: false,
  note: customNote || 'Đồng bộ trực tiếp qua Wi-Fi / Hotspot Laptop'
});

const PORT = 8787;

function getLanIpv4Addresses() {
  const ifaces = os.networkInterfaces();
  const list = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const info of addrs) {
      if (info.family === 'IPv4' && !info.internal) {
        list.push({ name, address: info.address });
      }
    }
  }
  return list;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqPath = (req.url || '/').split('?')[0];

  if (reqPath === '/ota-manifest.json') {
    const jsonBuf = fs.readFileSync(manifestPath);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': jsonBuf.length
    });
    res.end(jsonBuf);
    console.log(`📡 [${new Date().toLocaleTimeString()}] Điện thoại vừa đọc ota-manifest.json (v${manifest.version})`);
    return;
  }

  if (reqPath === '/dinh-ops-ota-bundle.zip') {
    const stat = fs.statSync(zipPath);
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': stat.size
    });
    fs.createReadStream(zipPath).pipe(res);
    console.log(
      `🚀 [${new Date().toLocaleTimeString()}] Đang bắn gói OTA (${Math.round(stat.size / 1024)} KB) thẳng sang điện thoại!`
    );
    return;
  }

  const html = `<!doctype html><html><body style="font-family:system-ui;background:#070a0f;color:#f8fafc;padding:24px;">
    <h2>🧭 DINH OPS 3D — Local Laptop OTA Server</h2>
    <p>Phiên bản sẵn sàng: <b>v${manifest.version}</b> (Build #${manifest.buildNumber}, ${Math.round(manifest.sizeBytes / 1024)} KB, ${fileCount} files)</p>
    <ul>
      <li><a style="color:#00f5d4" href="/ota-manifest.json">/ota-manifest.json</a></li>
      <li><a style="color:#00f5d4" href="/dinh-ops-ota-bundle.zip">/dinh-ops-ota-bundle.zip</a></li>
    </ul>
  </body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLanIpv4Addresses();
  const sizeKb = Math.max(1, Math.round(manifest.sizeBytes / 1024));
  console.log('\n===============================================================');
  console.log(`📡 MÁY CHỦ OTA NỘI BỘ (WI-FI / HOTSPOT LAPTOP) ĐANG CHẠY!`);
  console.log(`   Phiên bản: v${manifest.version} (Build #${manifest.buildNumber} • ${sizeKb} KB)`);
  console.log('   Trên điện thoại mở Dinh Ops 3D -> v1.x -> tab "🔄 OTA" -> nhập:');
  if (ips.length === 0) {
    console.log(`   👉 http://127.0.0.1:${PORT}`);
  } else {
    for (const item of ips) {
      console.log(`   👉 ${item.address}:${PORT}   (${item.name})`);
    }
  }
  console.log('   Bấm "⚡ Hút bản mới" -> App tự cập nhật trong 1-2 giây! (Ctrl+C để tắt)');
  console.log('===============================================================\n');
});
