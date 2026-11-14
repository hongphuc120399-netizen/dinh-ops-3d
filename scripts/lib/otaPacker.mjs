import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { zipDistDir } from './zipDist.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

function bumpPatchSemver(ver) {
  const parts = ver.trim().split('.').map((n) => parseInt(n, 10) || 0);
  return `${parts[0] || 1}.${parts[1] || 0}.${(parts[2] || 0) + 1}`;
}

function readPreviousBuildNumber(versionTsPath) {
  if (!fs.existsSync(versionTsPath)) return 0;
  const txt = fs.readFileSync(versionTsPath, 'utf8');
  const m = txt.match(/buildNumber:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function formatLocalIsoPlus7(d = new Date()) {
  const vnMs = d.getTime() + 7 * 3600 * 1000;
  const vn = new Date(vnMs);
  return vn.toISOString().replace('Z', '+07:00').replace(/\.\d{3}/, '');
}

function generateBuildNumber(prevBuildNumber) {
  const vn = new Date(Date.now() + 7 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = Number(
    `${vn.getUTCFullYear()}${pad(vn.getUTCMonth() + 1)}${pad(vn.getUTCDate())}${pad(vn.getUTCHours())}${pad(vn.getUTCMinutes())}`
  );
  return stamp > prevBuildNumber ? stamp : prevBuildNumber + 1;
}

export function runCmd(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    ...opts
  });
}

/**
 * Stamps version metadata into package.json + src/version.ts, compiles Vite production build,
 * packages dist-ota/dinh-ops-ota-bundle.zip with POSIX paths, and writes dist-ota/ota-manifest.json.
 */
export function buildAndPackOtaBundle({
  bumpPatch = true,
  forcedVersion = '',
  note = ''
} = {}) {
  const pkgPath = path.join(ROOT_DIR, 'package.json');
  const versionTsPath = path.join(ROOT_DIR, 'src', 'version.ts');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const nextVersion = forcedVersion
    ? forcedVersion.replace(/^ota-v?/i, '').replace(/^v/i, '')
    : bumpPatch
      ? bumpPatchSemver(pkg.version)
      : pkg.version;

  const prevBuildNumber = readPreviousBuildNumber(versionTsPath);
  const nextBuildNumber = generateBuildNumber(prevBuildNumber);
  const builtAt = formatLocalIsoPlus7();
  const cleanNote = (note || `Cập nhật chiến thuật Núi Dinh v${nextVersion}`).trim();

  if (pkg.version !== nextVersion) {
    pkg.version = nextVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  const versionTsSource = `export interface AppBuildInfo {
  version: string;
  buildNumber: number;
  builtAt: string;
  note: string;
}

export const APP_BUILD_INFO: AppBuildInfo = {
  version: '${nextVersion}',
  buildNumber: ${nextBuildNumber},
  builtAt: '${builtAt}',
  note: ${JSON.stringify(cleanNote)}
};
`;
  fs.writeFileSync(versionTsPath, versionTsSource, 'utf8');

  console.log(`\n🔨 [1/3] Đang build production v${nextVersion} (build #${nextBuildNumber})...`);
  runCmd('npm run build');

  const distDir = path.join(ROOT_DIR, 'dist');
  const otaOutDir = path.join(ROOT_DIR, 'dist-ota');
  const zipPath = path.join(otaOutDir, 'dinh-ops-ota-bundle.zip');
  const manifestPath = path.join(otaOutDir, 'ota-manifest.json');

  console.log(`\n📦 [2/3] Đang đóng gói ZIP chuẩn POSIX vào ${zipPath}...`);
  const zipRes = zipDistDir(distDir, zipPath);

  const manifest = {
    version: nextVersion,
    buildNumber: nextBuildNumber,
    builtAt,
    note: cleanNote,
    bundleFile: 'dinh-ops-ota-bundle.zip',
    sizeBytes: zipRes.sizeBytes,
    sha256: zipRes.sha256
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  return {
    manifest,
    zipPath,
    manifestPath,
    fileCount: zipRes.fileCount
  };
}
