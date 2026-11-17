// Cross-platform Electron dev launcher.
// 1) builds main/preload (esbuild), 2) starts the Vite dev server,
// 3) waits for it, then 4) launches Electron pointed at the dev URL.
// We avoid `concurrently`/shell `&&` so it behaves the same in PowerShell.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, '..');
const electronBin = require('electron');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const PORT = Number(process.env.VITE_PORT || 5173);
const START_URL = `http://localhost:${PORT}`;

let viteProc = null;
let electronProc = null;

function shutdown(code = 0) {
  if (electronProc && !electronProc.killed) electronProc.kill();
  if (viteProc && !viteProc.killed) viteProc.kill();
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitForUrl(url, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(npmCmd, args, { cwd: clientRoot, stdio: 'inherit', shell: isWin });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} exited ${code}`))));
    p.on('error', reject);
  });
}

try {
  console.log('› Building Electron main/preload…');
  await run(['run', 'build:electron']);

  console.log('› Starting Vite dev server…');
  viteProc = spawn(npmCmd, ['run', 'dev', '--', '--port', String(PORT)], {
    cwd: clientRoot,
    stdio: 'inherit',
    shell: isWin,
  });

  const ready = await waitForUrl(START_URL);
  if (!ready) {
    console.error('✖ Vite dev server did not become ready in time.');
    shutdown(1);
  }

  console.log(`› Launching Electron at ${START_URL}`);
  electronProc = spawn(electronBin, ['.'], {
    cwd: clientRoot,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_START_URL: START_URL },
  });
  electronProc.on('exit', (code) => shutdown(code || 0));
} catch (err) {
  console.error('✖ Dev launch failed:', err.message);
  shutdown(1);
}
