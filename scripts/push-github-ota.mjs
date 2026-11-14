import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { buildAndPackOtaBundle, ROOT_DIR, runCmd } from './lib/otaPacker.mjs';

const rawArgs = process.argv.slice(2);
const packOnly = rawArgs.includes('--pack-only');
const noBump = rawArgs.includes('--no-bump');

let forcedVersion = '';
const noteParts = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--pack-only' || a === '--no-bump') continue;
  if (a === '--version' && rawArgs[i + 1]) {
    forcedVersion = rawArgs[++i];
    continue;
  }
  noteParts.push(a);
}

const customNote = noteParts.join(' ').trim();

const { manifest, zipPath, manifestPath, fileCount } = buildAndPackOtaBundle({
  bumpPatch: !noBump && !forcedVersion,
  forcedVersion,
  note: customNote
});

const sizeKb = Math.max(1, Math.round(manifest.sizeBytes / 1024));
console.log(
  `✅ Đã đóng gói ${fileCount} files -> dinh-ops-ota-bundle.zip (${sizeKb} KB, SHA-256: ${manifest.sha256.slice(0, 12)}...)`
);

if (packOnly) {
  console.log('\n🎯 Hoàn tất chế độ --pack-only. Sẵn sàng test hoặc phục vụ OTA!');
  process.exit(0);
}

// Optional Android Capacitor copy so native folder stays in sync cleanly
if (fs.existsSync(path.join(ROOT_DIR, 'android'))) {
  try {
    execSync('npx cap copy android', { cwd: ROOT_DIR, stdio: 'inherit' });
  } catch {
    console.warn('⚠️ Bỏ qua cap copy android (vẫn tiếp tục phát hành OTA Web Bundle bình thường).');
  }
}

console.log('\n☁️ [3/3] Đang đẩy code & phát hành OTA lên GitHub Releases...');
const statusOut = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
if (statusOut) {
  runCmd('git add -A');
  const commitMsg = `ota: release v${manifest.version} - ${manifest.note.replace(/"/g, "'")}`;
  runCmd(`git commit -m "${commitMsg}"`);
}
runCmd('git push -u origin main');

const releaseTag = `ota-v${manifest.version}`;
const notesFile = path.join(ROOT_DIR, 'dist-ota', 'release-notes.md');
const releaseNotesBody = [
  `## DINH OPS 3D — OTA v${manifest.version}`,
  '',
  `- **Ghi chú:** ${manifest.note}`,
  `- **Build #:** \`${manifest.buildNumber}\``,
  `- **Dung lượng gói:** \`${sizeKb} KB\``,
  `- **SHA-256:** \`${manifest.sha256}\``,
  '',
  `> Cài APK đúng 1 lần đầu; các bản cập nhật này tự tải thẳng trong app trong 2 giây mà **không cần cài lại APK** và **giữ nguyên 100% Ghim + Bản đồ Offline**.`,
  '',
  `<!--DINH_OTA:${JSON.stringify(manifest)}-->`
].join('\n');
fs.writeFileSync(notesFile, releaseNotesBody, 'utf8');

let releaseExists = false;
try {
  execSync(`gh release view "${releaseTag}"`, { cwd: ROOT_DIR, stdio: 'ignore' });
  releaseExists = true;
} catch {
  releaseExists = false;
}

if (releaseExists) {
  runCmd(`gh release upload "${releaseTag}" "${zipPath}" "${manifestPath}" --clobber`);
  runCmd(`gh release edit "${releaseTag}" --title "OTA v${manifest.version}" --notes-file "${notesFile}"`);
} else {
  runCmd(
    `gh release create "${releaseTag}" "${zipPath}" "${manifestPath}" --title "OTA v${manifest.version}" --notes-file "${notesFile}"`
  );
}

console.log('\n🎉 PHÁT HÀNH OTA GITHUB THÀNH CÔNG!');
console.log(`   • Phiên bản: v${manifest.version} (${sizeKb} KB)`);
console.log(`   • Tag: ${releaseTag}`);
console.log('   • Trên điện thoại: Mở Dinh Ops 3D -> bấm nút phiên bản ở góc trên -> "Cập nhật ngay" (2 giây, KHÔNG cần cài lại APK)!\n');
