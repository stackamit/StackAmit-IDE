/**
 * Live Preview & dev-server management (Electron main process).
 *
 * Security model (mirrors workspaceFs):
 *  - Serves ONLY from user-authorized workspace roots via resolveWithinRoots()
 *    on every request — path traversal, absolute paths and encoded `..` are
 *    rejected with 403; symlinks escaping the workspace resolve outside the
 *    roots and are rejected too (realpath-based guard).
 *  - Binds to 127.0.0.1 only; never to a routable interface.
 *  - One server per workspace root — starting twice does not spawn twice.
 *  - Port must be 0 (ephemeral) or 1024–65535; EADDRINUSE is reported as a
 *    structured PORT_BUSY result, never a crash or a silent fallback.
 *  - Dev runners may only execute a script that EXISTS in the root's own
 *    package.json, with a strict name allow-list. No renderer-supplied
 *    command lines ever reach the shell.
 *  - All processes are tracked and killed (whole tree on Windows) on stop,
 *    root re-close or app exit (cleanupIpc → disposeAll).
 *  - Unknown binary files are served as application/octet-stream, never
 *    sniffed as HTML.
 *
 * This module deliberately imports NO Electron APIs so it can be exercised
 * directly in tests; the IPC layer (ipc.ts) adds sender validation and owns
 * shell.openExternal with a URL allow-list built from these active servers.
 */
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolveWithinRoots } from './workspaceFs.js';
import { mergedPathEnv, refreshPathFromRegistry } from './runtimeProbe.js';
import type { Result } from '../shared/ipc.js';

// ---------------------------------------------------------------------------
// MIME types (explicit; no guessing)
// ---------------------------------------------------------------------------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8', // never served compiled-to-HTML
  '.tsx': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
function fail(code: string, message: string): Result<never> {
  return { ok: false, code, message };
}

function normKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Port 0 = let the OS pick; otherwise only non-privileged ports. */
export function validatePort(port: unknown): number | null {
  const n = port === undefined || port === null || port === 0 ? 0 : Number(port);
  if (!Number.isInteger(n)) return null;
  if (n === 0) return 0;
  return n >= 1024 && n <= 65535 ? n : null;
}

/**
 * Turn a request URL path into a canonical filesystem path *inside* the given
 * serving root, or null when anything tries to escape (traversal, encoded
 * sequences, NUL bytes, absolute paths, symlink exits).
 */
export function safeJoin(rootReal: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded.replace(/^[/\\]+/, '').replace(/\\/g, '/');
  const candidate = path.resolve(rootReal, rel);
  // resolveWithinRoots applies the same realpath guard as every fs operation.
  const guarded = resolveWithinRoots(candidate);
  if (guarded === null) return null;
  // The serving root itself must additionally contain the guarded result.
  const r = path.resolve(rootReal).toLowerCase();
  const g = guarded.toLowerCase();
  const within = g === r || g.startsWith(r + path.sep);
  return within ? guarded : null;
}

// ---------------------------------------------------------------------------
// Static preview servers (one per workspace root)
// ---------------------------------------------------------------------------
type StaticEntry = {
  server: http.Server;
  rootReal: string;
  port: number;
  url: string;
};

const staticServers = new Map<string, StaticEntry>();

async function ensureDirectory(p: string): Promise<boolean> {
  try {
    const st = await fsp.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function handleStaticRequest(entry: StaticEntry, req: http.IncomingMessage, res: http.ServerResponse): void {
  const finish = (code: number, body?: string, headers?: Record<string, string>) => {
    res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    finish(405, 'Method Not Allowed', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }
  const target = safeJoin(entry.rootReal, req.url || '/');
  if (target === null) {
    finish(403, 'Forbidden: outside the workspace', { 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }
  void (async () => {
    let stat;
    let filePath = target;
    try {
      stat = await fsp.stat(target);
      if (stat.isDirectory()) {
        filePath = path.join(target, 'index.html');
        stat = await fsp.stat(filePath);
      }
    } catch {
      finish(404, 'Not Found: ' + path.basename(target), { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    if (!stat.isFile()) {
      finish(404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    let data: Buffer;
    try {
      data = await fsp.readFile(filePath);
    } catch {
      finish(500, 'Internal: unreadable file', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeFor(filePath), 'Content-Length': data.byteLength, 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  })();
}

/** Start (or reuse) a static preview server for an authorized workspace root. */
export async function startStatic(args: { root?: string; port?: number }): Promise<Result<{ url: string; port: number; reused: boolean }>> {
  if (typeof args?.root !== 'string' || args.root.length === 0) return fail('BAD_ROOT', 'A workspace root is required.');
  const rootReal = resolveWithinRoots(args.root);
  if (rootReal === null) return fail('FORBIDDEN', 'Open a workspace folder before starting a preview.');
  if (!(await ensureDirectory(rootReal))) return fail('BAD_ROOT', 'The preview root is not a folder.');

  const key = normKey(rootReal);
  const existing = staticServers.get(key);
  if (existing) return { ok: true, url: existing.url, port: existing.port, reused: true };

  const port = validatePort(args.port);
  if (port === null) return fail('BAD_PORT', 'Choose port 0 (automatic) or a number between 1024 and 65535.');

  const entry: StaticEntry = { rootReal, port, url: '', server: null as unknown as http.Server };
  const server = http.createServer((req, res) => handleStaticRequest(entry, req, res));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
  } catch (err: any) {
    server.close();
    if (err?.code === 'EADDRINUSE') return fail('PORT_BUSY', `Port ${port} is already in use. Try another (or 0).`);
    return fail('LISTEN_FAILED', 'Could not start the preview server.');
  }
  const actual = (server.address() as { port: number }).port;
  entry.server = server;
  entry.port = actual;
  entry.url = `http://127.0.0.1:${actual}/`;
  staticServers.set(key, entry);
  return { ok: true, url: entry.url, port: actual, reused: false };
}

export async function stopStatic(args: { root?: string }): Promise<Result<{}>> {
  const key = normKey(String(args?.root || ''));
  const entry = staticServers.get(key);
  if (!entry) return { ok: true };
  staticServers.delete(key);
  await new Promise<void>((resolve) => entry.server.close(() => resolve()));
  return { ok: true };
}

export function staticStatus(args: { root?: string }): Result<{ state: 'running' | 'stopped'; url?: string; port?: number }> {
  const entry = staticServers.get(normKey(String(args?.root || '')));
  if (!entry) return { ok: true, state: 'stopped' };
  return { ok: true, state: 'running', url: entry.url, port: entry.port };
}

// ---------------------------------------------------------------------------
// Dev servers (package.json scripts, e.g. Vite)
// ---------------------------------------------------------------------------
const SCRIPT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9@/._:-]{0,63}$/;
const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/\S*)?/i;

export type DevState = 'starting' | 'running' | 'exited';

type DevEntry = {
  child: ChildProcess;
  rootReal: string;
  script: string;
  url: string | null;
  exitCode: number | null;
  output: string[]; // last lines, for honest failure reporting
  stopped: boolean;
};

const devServers = new Map<string, DevEntry>();

/** Validate a dev-script request against the project's own package.json. */
export async function validateDevScript(rootReal: string, script: unknown): Promise<Result<{ script: string }>> {
  if (typeof script !== 'string' || !SCRIPT_NAME_RE.test(script)) {
    return fail('BAD_SCRIPT', 'Script name contains unsupported characters.');
  }
  let pkg: any;
  try {
    pkg = JSON.parse(await fsp.readFile(path.join(rootReal, 'package.json'), 'utf8'));
  } catch {
    return fail('NO_PACKAGE', 'This folder has no readable package.json.');
  }
  const names = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? Object.keys(pkg.scripts) : [];
  if (!names.includes(script)) {
    return fail('SCRIPT_MISSING', `package.json has no script "${script}". Available: ${names.join(', ') || '(none)'}`);
  }
  return { ok: true, script };
}

/** List runnable scripts of an authorized project root (for the UI picker). */
export async function listDevScripts(args: { root?: string }): Promise<Result<{ scripts: string[] }>> {
  const rootReal = typeof args?.root === 'string' ? resolveWithinRoots(args.root) : null;
  if (rootReal === null) return fail('FORBIDDEN', 'Open a workspace folder first.');
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(rootReal, 'package.json'), 'utf8'));
    const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts ? Object.keys(pkg.scripts) : [];
    return { ok: true, scripts };
  } catch {
    return { ok: true, scripts: [] };
  }
}

/**
 * The environment a dev-server child is started with: this process's own, with
 * a PATH that also carries the directories the recovered registry PATH knows but
 * the inherited snapshot does not. `npm` is the one thing looked up *by name*
 * here, and a Node.js installed after the desktop app was launched is exactly
 * the case where the app can see it and the child cannot.
 */
export function devEnvironment(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return { ...base, PATH: mergedPathEnv(base.PATH), NO_COLOR: '1' };
}

export async function startDev(args: { root?: string; script?: string }): Promise<Result<{ state: DevState }>> {
  const rootReal = typeof args?.root === 'string' ? resolveWithinRoots(args.root) : null;
  if (rootReal === null) return fail('FORBIDDEN', 'Open a workspace folder first.');
  const key = normKey(rootReal);
  const existing = devServers.get(key);
  if (existing && existing.exitCode === null) {
    return { ok: true, state: existing.url ? 'running' : 'starting' }; // never double-spawn
  }
  if (existing) devServers.delete(key); // reaped; collect fresh below

  const v = await validateDevScript(rootReal, args.script);
  if (!v.ok) return v;

  // Fixed launcher: npm run <validated-name>. The name passed the allow-list
  // above and exists in package.json, so nothing user-controlled reaches shelling.
  // POSIX spawns npm directly (no shell); Windows goes through cmd /c because
  // npm is a .cmd there — still an argv array, never an interpolated string.
  //
  // `npm` is the one thing here found *by name*, so the child has to be given
  // the PATH the app searches rather than the block it happened to inherit: a
  // Node.js installed after the desktop app was launched is in the registry PATH
  // but not in the snapshot a shortcut started the app with, and that is what
  // makes a perfectly valid `npm run dev` report "'npm' is not recognized".
  await refreshPathFromRegistry();
  const childEnv = devEnvironment();
  const isWin = process.platform === 'win32';
  const child = isWin
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm', 'run', v.script], {
        cwd: rootReal,
        windowsHide: true,
        env: childEnv,
      })
    : spawn('npm', ['run', v.script], {
        cwd: rootReal,
        env: childEnv,
      });

  const entry: DevEntry = { child, rootReal, script: v.script, url: null, exitCode: undefined as unknown as number, output: [], stopped: false };
  const onData = (buf: Buffer) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      entry.output.push(line);
      if (entry.output.length > 200) entry.output.shift();
      if (!entry.url) {
        const m = line.match(LOCAL_URL_RE);
        if (m) entry.url = m[0].replace(/\/$/, '');
      }
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('exit', (code) => {
    entry.exitCode = code ?? -1;
  });
  child.on('error', () => {
    entry.exitCode = -1;
    entry.output.push('Failed to launch npm — is Node.js installed and on PATH?');
  });
  devServers.set(key, entry);
  return { ok: true, state: 'starting' };
}

function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    // npm spawns node.exe children; kill the whole tree, no shell involved.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

export async function stopDev(args: { root?: string }): Promise<Result<{}>> {
  const key = normKey(String(args?.root || ''));
  const entry = devServers.get(key);
  if (!entry) return { ok: true };
  entry.stopped = true;
  killTree(entry.child);
  await new Promise<void>((resolve) => {
    if (entry.exitCode !== undefined) return resolve();
    entry.child.once('exit', () => resolve());
    setTimeout(resolve, 4000); // taskkill is async; never hang the IPC
  });
  devServers.delete(key);
  return { ok: true };
}

export function devStatus(args: { root?: string }): Result<{ state: DevState; url?: string; script?: string; exitCode?: number | null; output?: string }> {
  const entry = devServers.get(normKey(String(args?.root || '')));
  if (!entry) return { ok: true, state: 'exited', exitCode: null, output: '' };
  const state: DevState = entry.exitCode !== undefined ? 'exited' : entry.url ? 'running' : 'starting';
  return {
    ok: true,
    state,
    url: entry.url || undefined,
    script: entry.script,
    exitCode: state === 'exited' ? entry.exitCode : undefined,
    output: state === 'exited' ? entry.output.slice(-20).join('\n') : undefined,
  };
}

// ---------------------------------------------------------------------------
// Allow-listed probing & external-open support (consumed by ipc.ts)
// ---------------------------------------------------------------------------

/** Every URL currently served by this service (127.0.0.1/localhost only). */
export function activeServerUrls(): string[] {
  const urls: string[] = [];
  for (const e of staticServers.values()) urls.push(e.url);
  for (const d of devServers.values()) if (d.url) urls.push(d.url);
  return urls;
}

/**
 * True when `url` targets an active, locally served preview (used to gate
 * shell.openExternal and the readiness probe). Path under the server is free;
 * the HOST and PORT must match a live server exactly.
 */
export function isAllowedServerUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return false;
  return activeServerUrls().some((base) => {
    const b = new URL(base);
    return b.port === parsed.port;
  });
}

/** Same-origin HTTP probe against an active server — for readiness/errors. */
export async function probeUrl(url: string): Promise<Result<{ status: number; statusText: string }>> {
  if (!isAllowedServerUrl(url)) return fail('FORBIDDEN', 'Only active local preview URLs can be probed.');
  const mod = await import('node:http');
  return new Promise((resolve) => {
    const req = mod.request(url, { method: 'GET', timeout: 4000 }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode || 0, statusText: res.statusMessage || '' });
    });
    req.on('error', () => resolve(fail('PROBE_FAILED', 'Preview server did not respond.')));
    req.on('timeout', () => {
      req.destroy();
      resolve(fail('PROBE_TIMEOUT', 'Preview server timed out.'));
    });
    req.end();
  });
}

/** Terminate everything (app exit / workspace switch). */
export function disposeAll(): void {
  for (const e of staticServers.values()) {
    try {
      e.server.close();
    } catch {
      /* ignore */
    }
  }
  staticServers.clear();
  for (const d of devServers.values()) {
    d.stopped = true;
    try {
      killTree(d.child);
    } catch {
      /* ignore */
    }
  }
  devServers.clear();
}
