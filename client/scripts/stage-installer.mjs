/**
 * Stages the latest Windows installer into the static site so the public
 * Download page can serve it.
 *
 * Finds the newest `release/*Setup*.exe`, copies it to
 * `public/downloads/StackAmit-IDE-Setup.exe`, and writes a small `info.json`
 * (version / size / date) the page reads at runtime. Vite copies `public/`
 * straight into `dist/`, so the deployed site ships the installer too.
 *
 * Never fails the build: if no installer exists yet (e.g. a clean checkout
 * before `npm run dist:win`), it warns and exits 0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(here, '..');
const releaseDir = path.join(clientDir, 'release');
const outDir = path.join(clientDir, 'public', 'downloads');
const outName = 'StackAmit-IDE-Setup.exe';

function latestSetupExe() {
  if (!fs.existsSync(releaseDir)) return null;
  const found = fs
    .readdirSync(releaseDir)
    .filter((f) => /setup.*\.exe$/i.test(f))
    .map((f) => ({ f, st: fs.statSync(path.join(releaseDir, f)) }))
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  return found[0] || null;
}

const pkg = JSON.parse(fs.readFileSync(path.join(clientDir, 'package.json'), 'utf8'));
const latest = latestSetupExe();

if (!latest) {
  console.warn(
    '[stage-installer] No installer found in release/ — run "npm run dist:win" first. Skipping (web build continues without the download file).',
  );
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
const src = path.join(releaseDir, latest.f);
fs.copyFileSync(src, path.join(outDir, outName));

const info = {
  version: pkg.version,
  fileName: outName,
  originalName: latest.f,
  sizeBytes: latest.st.size,
  updatedAt: latest.st.mtime.toISOString(),
  platform: 'Windows 10 / 11 (64-bit)',
};
fs.writeFileSync(path.join(outDir, 'info.json'), JSON.stringify(info, null, 2));

console.log(
  `[stage-installer] staged ${latest.f} (${(latest.st.size / 1048576).toFixed(1)} MB) → public/downloads/${outName}`,
);
