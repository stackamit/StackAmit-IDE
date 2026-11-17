/**
 * Integrated terminal service (Electron main process).
 *
 * Uses `node-pty` for real local shell sessions when the native module loads for
 * this Electron ABI. If it cannot be loaded (e.g. native build tools not present
 * and no matching prebuild), `create()` returns a structured
 * { ok:false, code:'PTY_UNAVAILABLE' } result so the renderer can show an honest
 * "terminal unavailable" state instead of crashing.
 *
 * PTY sessions are powerful: they can modify files and run programs. This is only
 * ever reachable from the trusted local desktop window (sender is validated in the
 * IPC layer), never from the web build.
 */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { TerminalCreateResult } from '../shared/ipc.js';
import { refreshProcessPath } from './runtimeProbe.js';

type PtyProcess = {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (d: string) => void): { dispose(): void };
  onExit(cb: (e: { code?: number }) => void): { dispose(): void };
};

type PtyModule = {
  spawn(file: string, args: string[], options: any): PtyProcess;
};

type Session = {
  id: string;
  pty: PtyProcess;
  shell: string;
  dataDisposable: { dispose(): void };
  exitDisposable: { dispose(): void };
};

const sessions = new Map<string, Session>();

let ptyMod: PtyModule | null | undefined; // undefined = not yet tried
function loadPty(): PtyModule | null {
  if (ptyMod !== undefined) return ptyMod;
  try {
    // Required lazily so a failure here never takes down the whole app.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ptyMod = require('node-pty') as PtyModule;
  } catch {
    ptyMod = null;
  }
  return ptyMod;
}

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || path.join('C:\\Windows\\System32', 'cmd.exe');
  }
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

export type DataSink = (sessionId: string, data: string) => void;
export type ExitSink = (sessionId: string, code: number) => void;

export async function create(
  opts: { cwd?: string; shell?: string; cols?: number; rows?: number; extraPathDirs?: string[] },
  onData: DataSink,
  onExit: ExitSink,
): Promise<TerminalCreateResult> {
  const shell = typeof opts.shell === 'string' && opts.shell ? opts.shell : defaultShell();
  const pty = loadPty();
  if (!pty) {
    return {
      ok: false,
      code: 'PTY_UNAVAILABLE',
      message:
        'Local terminal needs the node-pty native module built for this Electron version. Install Visual Studio Build Tools + Python and run `npm run rebuild` in the client, or use a packaged build.',
      shell,
    };
  }

  let cwd = typeof opts.cwd === 'string' && opts.cwd ? opts.cwd : os.homedir();
  try {
    cwd = fs.realpathSync(cwd);
  } catch {
    cwd = os.homedir();
  }

  try {
    // The shell must see the machine's *current* PATH. An app started from a
    // shortcut inherits the launcher's environment block, so a toolchain
    // installed after that snapshot (MinGW, for one) is invisible here while
    // working in a fresh CMD window — the registry PATH is recovered and merged
    // instead of trusting the copy this process was started with.
    //
    // The environment is repaired on `process.env` *and* passed as `env`: on
    // Windows node-pty's ConPTY implementation starts the shell with the parent
    // process environment and ignores the option (which is what kept
    // `'g++' is not recognized` alive here while `cmd.exe` outside the app
    // worked), while the POSIX backend does read the option.
    const mergedPath = await refreshProcessPath(false);
    // A "Run in Terminal" session may need a toolchain folder the plain merged
    // PATH does not carry (a compiler's own bin, for its runtime DLLs). Those
    // additions go in front so the manual command behaves exactly like the
    // managed run; nothing already on PATH moves or stops resolving.
    const extra = Array.isArray(opts.extraPathDirs) ? opts.extraPathDirs.filter((d) => typeof d === 'string' && d) : [];
    const shellPath = extra.length ? `${extra.join(path.delimiter)}${path.delimiter}${mergedPath}` : mergedPath;
    const p = pty.spawn(shell, shellArgsFor(shell), {
      name: 'xterm-color',
      cols: clamp(opts.cols, 80),
      rows: clamp(opts.rows, 24),
      cwd,
      env: { ...process.env, PATH: shellPath } as Record<string, string>,
    });
    const id = randomUUID();
    const dataDisposable = p.onData((d) => onData(id, d));
    const exitDisposable = p.onExit((e) => {
      onExit(id, typeof e.code === 'number' ? e.code : 0);
      dispose(id);
    });
    sessions.set(id, { id, pty: p, shell, dataDisposable, exitDisposable });
    return { ok: true, sessionId: id, shell };
  } catch (err: any) {
    return {
      ok: false,
      code: 'PTY_SPAWN_FAILED',
      message: `Could not start the terminal (${err?.message || 'unknown error'}). Shell: ${shell}`,
      shell,
    };
  }
}

function shellArgsFor(shell: string): string[] {
  const base = path.basename(shell).toLowerCase();
  if (base === 'powershell.exe' || base === 'pwsh.exe') return ['-nologo', '-noexit', '-command', 'prompt'];
  return [];
}

function clamp(n: unknown, fallback: number): number {
  return typeof n === 'number' && n >= 1 && n <= 1000 ? Math.floor(n) : fallback;
}

export function write(sessionId: string, data: string): void {
  const s = sessions.get(sessionId);
  if (s && typeof data === 'string') s.pty.write(data);
}

export function resize(sessionId: string, cols: number, rows: number): void {
  const s = sessions.get(sessionId);
  if (s) s.pty.resize(clamp(cols, 80), clamp(rows, 24));
}

export function dispose(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  try {
    s.dataDisposable.dispose();
    s.exitDisposable.dispose();
    s.pty.kill();
  } catch {
    /* already gone */
  }
  sessions.delete(sessionId);
}

export function disposeAll(): void {
  for (const id of [...sessions.keys()]) dispose(id);
}

export function available(): boolean {
  if (loadPty()) return true;
  // Even without node-pty, do a cheap existence check on the default shell so the
  // UI can say whether the shell executable itself is missing.
  return false;
}

/** Non-PTY fallback used only to report shell-exe presence (not to run a shell). */
export function shellExists(): boolean {
  const shell = defaultShell();
  try {
    fs.accessSync(shell);
    return true;
  } catch {
    return false;
  }
}
