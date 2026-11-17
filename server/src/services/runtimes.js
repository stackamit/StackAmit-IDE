/**
 * Local runtime detection.
 *
 * Shared by the interactive runner (to decide what can run) and the installer
 * (to re-check availability after a successful install). Detection spawns each
 * candidate command so it reflects what's actually usable, not just PATH.
 */
import { spawn } from 'node:child_process';

export const IS_WIN = process.platform === 'win32';

// Candidates probed (in order) to find a usable command for each language.
// `args` is the version flag each tool actually answers with (they are not
// consistent across ecosystems).
export const RUNTIME_PROBES = {
  python: { cmds: ['python', 'python3', 'py'], args: ['--version'] },
  javascript: { cmds: ['node'], args: ['--version'] },
  typescript: { cmds: ['tsc'], args: ['--version'] },
  c: { cmds: ['gcc'], args: ['--version'] },
  cpp: { cmds: ['g++'], args: ['--version'] },
  java: { cmds: ['java'], args: ['-version'] }, // also needs javac; verified together below
  go: { cmds: ['go'], args: ['version'] },
  rust: { cmds: ['rustc'], args: ['--version'] },
  csharp: { cmds: ['dotnet'], args: ['--version'] },
  php: { cmds: ['php'], args: ['--version'] },
  ruby: { cmds: ['ruby'], args: ['--version'] },
  kotlin: { cmds: ['kotlinc'], args: ['-version'] },
  perl: { cmds: ['perl'], args: ['-v'] },
  lua: { cmds: ['lua'], args: ['-v'] },
  julia: { cmds: ['julia'], args: ['--version'] },
  haskell: { cmds: ['runghc', 'runhaskell'], args: ['--version'] },
  pascal: { cmds: ['fpc'], args: ['-iV'] },
  dart: { cmds: ['dart'], args: ['--version'] },
  elixir: { cmds: ['elixir'], args: ['--version'] },
  shell: { cmds: ['bash'], args: ['--version'] },
  powershell: { cmds: ['pwsh', 'powershell'], args: ['-NoProfile', '-Command', 'exit'] },
  sql: { cmds: ['sqlite3'], args: ['--version'] },
};

// Tools whose probe can be slow to start (JVM-based); generous probe timeout.
const PROBE_TIMEOUT_MS = 8000;

/** Resolve a command to an absolute path so Windows can spawn `.exe` files. */
export function resolveCommand(cmd) {
  if (cmd.includes('/') || cmd.includes('\\')) return cmd;
  if (IS_WIN) return `${cmd}.exe`;
  return cmd;
}

export function probeCommand(cmd, args) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    let child;
    try {
      child = spawn(resolveCommand(cmd), args, { stdio: 'ignore', windowsHide: true });
    } catch {
      return done(false);
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      done(false);
    }, PROBE_TIMEOUT_MS);
    child.on('error', () => {
      clearTimeout(timer);
      done(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
}

let runtimeCache = null;

/** Detect which local toolchains are usable; result is cached. */
export async function detectRuntimes(force = false) {
  if (runtimeCache && !force) return runtimeCache;
  const runtimes = {};
  for (const [key, spec] of Object.entries(RUNTIME_PROBES)) {
    let chosen = null;
    for (const cmd of spec.cmds) {
      if (await probeCommand(cmd, spec.args)) {
        chosen = cmd;
        break;
      }
    }
    // Java needs both a runtime and a compiler for interactive runs.
    if (key === 'java' && chosen) {
      const hasCompiler = await probeCommand('javac', ['-version']);
      if (!hasCompiler) chosen = null;
    }
    runtimes[key] = { available: Boolean(chosen), cmd: chosen };
  }
  runtimeCache = runtimes;
  return runtimes;
}

/** Force the next detectRuntimes() to re-probe (e.g. after an install). */
export function invalidateRuntimes() {
  runtimeCache = null;
}
