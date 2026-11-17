/**
 * Language-server bridge (Electron main process).
 *
 * Spawns real LSP servers (Pyright, clangd, JDT.LS) as child processes and
 * exposes each one over a loopback WebSocket, so the sandboxed renderer can
 * drive IntelliSense through `vscode`-style JSON-RPC without ever touching
 * Node or the shell itself.
 *
 * Security model (inherited from previewServer.ts, the proven sibling):
 *  - Binds to 127.0.0.1 only, ephemeral port; never a routable interface.
 *  - One bridge per (server, workspace root); starting twice reuses the first
 *    and never double-spawns the bridge. Each *WebSocket connection* gets its
 *    own server child (LSP servers serve exactly one client over stdio).
 *  - Only binaries named by LS_DESCRIPTORS (or a user-configured absolute
 *    override) are ever spawned, with fixed argv arrays — never a shell
 *    string built from renderer input. Windows .cmd shims (npm global bins)
 *    go through cmd.exe /d /c with a validated, fully-quoted single command,
 *    mirroring how previewServer launches npm; everything else spawns direct.
 *  - Children receive the localRun allow-list environment (sanitizeEnv): no
 *    secrets are inherited, and none are ever logged.
 *  - A workspace root may only be used when it is an authorized root the user
 *    opened (resolveWithinRoots), same rule as every other fs/preview channel.
 *  - Origins on the WebSocket are checked (file:// / loopback http only), and
 *    malformed or oversize frames are dropped rather than forwarded.
 *  - Every child is tracked and killed (whole tree on Windows) when its
 *    connection closes, when the bridge is stopped, and on app exit
 *    (cleanupIpc → disposeAll).
 *  - Repeated early child crashes disable a bridge (LS_CRASHED) instead of
 *    restart-spawning forever.
 *
 * Tool state is honest and cached per session: MISSING (nothing located),
 * INCOMPATIBLE (a readable version is below the minimum, or the required
 * JDK is too old / only a JRE is installed), OK (including "version unknown" —
 * several servers do not answer --version; a genuinely broken binary surfaces
 * as LS_CRASHED). Nothing is ever downloaded or installed from here.
 *
 * Java specifically: Eclipse JDT.LS ships as an Eclipse *distribution*
 * (plugins/org.eclipse.equinox.launcher_*.jar + config_win|linux|mac), not as
 * an installable `jdtls` executable, and it only attaches the `java.*`
 * platform modules when it runs on a real JDK. So the bridge discovers a JDK
 * home (JAVA_HOME / PATH / well-known install roots / a user-configured path),
 * plans the java launch itself, and hands JAVA_HOME + <jdk>/bin to the child.
 * A child started on a JRE is what makes every standard-library import an
 * error, which is exactly the failure this module exists to prevent.
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import { resolveWithinRoots } from './workspaceFs.js';
import { discoverTool, findJdk, javaMajorOf, SAFE_CMD_PATH_RE } from './runtimeProbe.js';
import type { JdkInfo, ToolDiscovery } from './runtimeProbe.js';
import { sanitizeEnv } from './localRun.js';
import type { Result } from '../shared/ipc.js';

// ---------------------------------------------------------------------------
// Descriptors — the only binaries this service may ever spawn.
// ---------------------------------------------------------------------------
export type LsDescriptor = {
  /** Stable id of the server itself (a language may map to an existing id). */
  id: string;
  label: string;
  /** Executable name searched on PATH (unless the user configured a path). */
  tool: string;
  /** Arguments for stdio LSP mode. Fixed constants — never renderer input. */
  args: string[];
  /** Arguments that print a version and exit 0. */
  versionArgs: string[];
  /** Regex extracting [major, minor?, patch?] from the version line. */
  versionPattern: RegExp | null;
  /** Minimum acceptable [major, minor, patch] when a pattern matched. */
  minVersion: [number, number, number] | null;
  /**
   * A JVM-based server that must run on a full JDK (not a JRE). Discovered
   * through runtimeProbe's JDK finder, which rejects runtime-only installs.
   */
  jdk?: { minMajor: number; hint: string };
  /**
   * True when `tool` names an Eclipse distribution rather than an executable:
   * the launch is then planned as `<jdk>/bin/java <jvm args> -jar <launcher>`.
   */
  eclipseLayout?: boolean;
  install: { npm?: string; winget?: string; note: string };
  rootMarkers: string[];
  features: string[];
};

export const LS_DESCRIPTORS: Record<string, LsDescriptor> = {
  python: {
    id: 'pyright',
    label: 'Python (Pyright)',
    tool: 'pyright-langserver',
    args: ['--stdio'],
    versionArgs: ['--version'],
    versionPattern: /pyright\s+(\d+)\.(\d+)\.(\d+)/i,
    minVersion: [1, 1, 0],
    install: {
      npm: 'pyright',
      note: 'Install with `npm install -g pyright` (needs Node.js). Never bundled or auto-installed.',
    },
    rootMarkers: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'setup.cfg', '.git'],
    features: ['completion', 'hover', 'signatureHelp', 'definition', 'references', 'rename', 'documentSymbols', 'semanticDiagnostics', 'formatting', 'rangeFormatting'],
  },
  c: {
    id: 'clangd',
    label: 'C (clangd)',
    tool: 'clangd',
    args: ['--stdio'],
    versionArgs: ['--version'],
    versionPattern: /clangd version (\d+)\.(\d+)\.(\d+)/i,
    minVersion: [12, 0, 0],
    install: {
      winget: 'LLVM',
      note: 'Install LLVM from llvm.org or `winget install LLVM.LLVM`. Project setup wants compile_commands.json (CMake/Bear/xmake).',
    },
    rootMarkers: ['compile_commands.json', '.clangd', '.clang-tidy'],
    features: ['completion', 'hover', 'signatureHelp', 'definition', 'references', 'rename', 'documentSymbols', 'semanticDiagnostics', 'formatting', 'rangeFormatting'],
  },
  cpp: {
    id: 'clangd',
    label: 'C++ (clangd)',
    tool: 'clangd',
    args: ['--stdio'],
    versionArgs: ['--version'],
    versionPattern: /clangd version (\d+)\.(\d+)\.(\d+)/i,
    minVersion: [12, 0, 0],
    install: {
      winget: 'LLVM',
      note: 'Install LLVM from llvm.org or `winget install LLVM.LLVM`. Project setup wants compile_commands.json (CMake/Bear/xmake).',
    },
    rootMarkers: ['compile_commands.json', '.clangd', '.clang-tidy'],
    features: ['completion', 'hover', 'signatureHelp', 'definition', 'references', 'rename', 'documentSymbols', 'semanticDiagnostics', 'formatting', 'rangeFormatting'],
  },
  java: {
    id: 'jdtls',
    label: 'Java (Eclipse JDT.LS)',
    // `jdtls` is the launcher script name used by most distributions; the
    // custom tool path may equally point at the download's root folder or at
    // the equinox launcher jar, which findEclipseLayout() resolves.
    tool: 'jdtls',
    args: [],
    versionArgs: ['--version'],
    versionPattern: null,
    minVersion: null,
    eclipseLayout: true,
    jdk: {
      minMajor: 17,
      hint: 'JDT.LS runs on a JDK 17+ (separate from any JDK used to execute programs): a JRE cannot attach the java.* platform modules, so every import would be reported as unresolved.',
    },
    install: {
      winget: 'Eclipse.Temurin-JDK-21',
      note:
        'Install Eclipse JDT.LS from https://download.eclipse.org/jdtls/milestones/ and unpack it anywhere (the folder holds plugins/ and config_win/). Then either put its bin/jdtls launcher on PATH, or type the unpacked folder into "Custom tool path" here. A JDK 17+ is required as well (winget install -e --id Microsoft.OpenJDK.21) — set JAVA_HOME or type its folder into "Custom JDK path".',
    },
    rootMarkers: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', '.git'],
    features: ['completion', 'hover', 'signatureHelp', 'definition', 'references', 'rename', 'documentSymbols', 'semanticDiagnostics', 'formatting', 'rangeFormatting'],
  },
};

// ---------------------------------------------------------------------------
// Eclipse JDT.LS distributions: layout discovery + java launch planning
// ---------------------------------------------------------------------------
const EQUINOX_LAUNCHER_RE = /^org\.eclipse\.equinox\.launcher_[\d.]+(?:\.v[\d-]+)?\.jar$/i;

export type EclipseLayout = {
  /** Distribution root (the folder that contains `plugins`). */
  home: string;
  launcherJar: string;
  /** Platform config area (`config_win` etc.) when present. */
  configDir: string | null;
};

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function configAreaName(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return ['config_win'];
  if (platform === 'darwin') return ['config_mac_arm', 'config_mac'];
  return ['config_linux_arm', 'config_linux'];
}

function pickLauncherJar(pluginsDir: string): string | null {
  let names: string[] = [];
  try {
    names = fs.readdirSync(pluginsDir);
  } catch {
    return null;
  }
  const jars = names.filter((n) => EQUINOX_LAUNCHER_RE.test(n));
  if (!jars.length) return null;
  // Highest version wins (the launcher is a plain jar; several may co-exist).
  // Platform-specific launcher *bundles* (…launcher.win32.win32.x86_64_…) are
  // excluded by the pattern above: only the bare launcher jar starts equinox.
  jars.sort((a, b) => {
    const va = (a.match(/launcher_([\d][\d.]*)/) || [, ''])[1].split('.').map(Number);
    const vb = (b.match(/launcher_([\d][\d.]*)/) || [, ''])[1].split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((vb[i] || 0) !== (va[i] || 0)) return (vb[i] || 0) - (va[i] || 0);
    }
    return a.localeCompare(b);
  });
  return path.join(pluginsDir, jars[0]);
}

/**
 * Recognize an Eclipse distribution from anything the user may have pointed
 * at: the unpacked root, its `bin/jdtls` launcher, or the launcher jar itself.
 * Returns null when the target holds no `plugins/org.eclipse.equinox.launcher_*`
 * jar — i.e. it is not a JDT.LS install, which is reported honestly rather
 * than spawned and blamed on the server.
 */
export function findEclipseLayout(target: string, platform: NodeJS.Platform = process.platform): EclipseLayout | null {
  if (!target) return null;
  const startDirs: string[] = [];
  if (isDirectory(target)) startDirs.push(target, path.dirname(target));
  else {
    // file: plugins/<jar> -> home; bin/jdtls -> home; anything else -> parent.
    const d1 = path.dirname(target);
    const d2 = path.dirname(d1);
    startDirs.push(path.basename(d1) === 'plugins' ? d2 : d1, d2, path.dirname(d2));
  }
  for (const home of startDirs.filter(Boolean)) {
    const launcherJar = pickLauncherJar(path.join(home, 'plugins'));
    if (!launcherJar) continue;
    const wanted = configAreaName(platform);
    let configDir: string | null = null;
    for (const name of wanted) {
      if (isDirectory(path.join(home, name))) {
        configDir = path.join(home, name);
        break;
      }
    }
    if (!configDir) {
      // Any `config_*` area beats inventing one: a wrong path makes equinox fail.
      const any = wanted.length ? fs.readdirSync(home, { withFileTypes: true }).filter((e) => e.isDirectory() && /^config_/i.test(e.name)).map((e) => e.name).sort() : [];
      if (any.length) configDir = path.join(home, any[0]);
    }
    return { home, launcherJar, configDir };
  }
  return null;
}

/** JVM + equinox argv for JDT.LS — the same shape the official launcher uses. */
export function planJdtlsLaunch(opts: {
  jdk: JdkInfo;
  layout: EclipseLayout;
  dataDir: string;
  logLevel?: string;
}): { cmd: string; args: string[] } {
  const { jdk, layout } = opts;
  const args = [
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    `-Dlog.protocol=true`,
    `-Dlog.level=${opts.logLevel || 'WARNING'}`,
    '-Xmx1G',
    // JDK 17+ needs the whole platform image visible plus these opens, or the
    // OSGi layer cannot read java.util/java.lang and the session dies early.
    '--add-modules=ALL-SYSTEM',
    '--add-opens',
    'java.base/java.util=ALL-UNNAMED',
    '--add-opens',
    'java.base/java.lang=ALL-UNNAMED',
    `-javaagent:${layout.launcherJar}`,
    '-jar',
    layout.launcherJar,
    ...(layout.configDir ? ['-configuration', layout.configDir] : []),
    '-data',
    opts.dataDir,
  ];
  return { cmd: jdk.javaExe, args };
}

/**
 * Per-project storage for the JDT.LS workspace index, kept under the app's own
 * data folder so nothing is ever written next to the user's sources.
 */
export function jdtlsDataDir(storageRoot: string, projectRoot: string): string {
  const digest = crypto.createHash('sha1').update(path.resolve(projectRoot || '.').toLowerCase()).digest('hex').slice(0, 12);
  const name = (projectRoot ? path.basename(path.resolve(projectRoot)) : 'standalone').replace(/[^\w.+-]/g, '_').slice(0, 40) || 'standalone';
  return path.join(storageRoot, 'jdtls-workspace', `${name}-${digest}`);
}

// ---------------------------------------------------------------------------
// Injection seams (tests fake discovery + spawn; production uses the real ones)
// ---------------------------------------------------------------------------
export type LspDeps = {
  discover: (cmd: string, opts?: { versionArgs?: string[]; customPath?: string | null; force?: boolean }) => Promise<ToolDiscovery>;
  findJdk: (opts?: { customPath?: string | null; minMajor?: number; force?: boolean }) => Promise<JdkInfo | null>;
  spawn: (cmd: string, args: string[], options: SpawnOptions) => ChildProcess;
};

const realDeps: LspDeps = { discover: discoverTool, findJdk, spawn };

// ---------------------------------------------------------------------------
// Bridge bookkeeping
// ---------------------------------------------------------------------------
type BridgeEntry = {
  key: string;
  descriptorId: string;
  language: string;
  rootReal: string; // '' when no workspace folder is open
  toolPath: string; // absolute path of the spawned executable (or shim)
  /** Set for JVM servers: the planned `<jdk>/bin/java ...` command line. */
  launch: { cmd: string; args: string[] } | null;
  /** JDK home exported to the child as JAVA_HOME (JDT.LS resolves java.* from it). */
  jdkHome: string | null;
  jdkVersion: string | null;
  version: string | null;
  http: http.Server;
  wss: WebSocketServer;
  port: number;
  url: string;
  children: Set<ChildProcess>;
  connections: number;
  crashStreak: number;
  lastError: string | null;
  /** Redacted tail of the server's own stderr, for actionable failures. */
  logTail: string[];
  disposed: boolean;
};

const bridges = new Map<string, BridgeEntry>();
/** bridge key -> set after the crash limit; cleared by stop/disposeAll. */
const crashedKeys = new Set<string>();

const MAX_MESSAGE_BYTES = 32 * 1024 * 1024; // LSP payloads beyond this are dropped
const MAX_HEADER_BYTES = 16 * 1024;
const CRASH_WINDOW_MS = 6000;
const CRASH_LIMIT = 3;
const MAX_LOG_TAIL_LINES = 40;
const MAX_STDERR_BUFFER = 8000;

/**
 * Credential-shaped values are stripped from server output before it is kept or
 * shown: a language server can echo environment or settings content into its
 * own log, and the log travels to the renderer and the Output panel.
 */
const SECRET_VALUE_RE =
  /\b([a-z0-9_-]*(?:token|password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization|credential|client[_-]?secret)[a-z0-9_-]*)(\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;{}]+)/gi;

export function redactServerLog(text: string): string {
  return String(text || '').replace(SECRET_VALUE_RE, '$1$2[redacted]');
}

function fail(code: string, message: string): Result<never> {
  return { ok: false, code, message };
}

function normKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function bridgeKey(descriptorId: string, rootReal: string): string {
  return `${descriptorId}|${normKey(rootReal || '.')}`;
}

// ---------------------------------------------------------------------------
// Version honesty: MISSING vs INCOMPATIBLE vs OK
// ---------------------------------------------------------------------------
function parseVersionTriple(text: string | null, pattern: RegExp | null): [number, number, number] | null {
  if (!text) return null;
  if (pattern) {
    const m = text.match(pattern);
    if (m) return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
    return null;
  }
  const any = text.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (any) return [Number(any[1]), Number(any[2]), Number(any[3] || 0)];
  const majorOnly = text.match(/(\d+)/);
  return majorOnly ? [Number(majorOnly[1]), 0, 0] : null;
}

function atLeast(v: [number, number, number], min: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (v[i] > min[i]) return true;
    if (v[i] < min[i]) return false;
  }
  return true;
}

/** Java-style version: "1.8.0_452" means major 8; "21.0.2" means major 21. */
export type ToolState =
  | { state: 'ok'; path: string; version: string | null; jdk: JdkInfo | null }
  | { state: 'missing'; message: string }
  | { state: 'incompatible'; message: string };

/**
 * Decide whether the descriptor's server can run here. Tool discovery is cached
 * by discoverTool/findJdk themselves, so this never re-probes on every editor
 * event; `force` re-reads after the user installs something.
 */
export async function resolveToolState(
  d: LsDescriptor,
  customPath: string | null,
  deps: LspDeps,
  extra: { jdkPath?: string | null; force?: boolean } = {},
): Promise<ToolState> {
  const disc = await deps.discover(d.tool, { versionArgs: d.versionArgs, customPath, force: extra.force });
  // The note is the distribution-specific truth (JDT.LS is an unpacked folder,
  // not a package manager entry), so it is appended rather than shadowed by the
  // package-manager line — otherwise the Java hint would suggest winget installs
  // the language server, when it only installs the JDK it runs on.
  const installLine = [
    d.install.npm ? `npm install -g ${d.install.npm}` : null,
    d.install.winget ? `winget install -e --id ${d.install.winget}` : null,
    d.install.note || null,
  ]
    .filter(Boolean)
    .join(' — ');
  if (!disc.path) {
    return {
      state: 'missing',
      message: `${d.tool} was not found on PATH. Install it (${installLine}). You can also configure an absolute tool path in Languages & Capabilities.`,
    };
  }
  // A failed version probe alone does not prove a broken install: several
  // real language servers (pyright-langserver among them) simply do not
  // answer --version. Treat the version as unknown in that case — a truly
  // broken binary is caught honestly downstream by the crash limit
  // (LS_CRASHED), never by claiming a version we did not read.
  const version = disc.found ? disc.version : null;
  if (d.minVersion && d.versionPattern && version) {
    const triple = parseVersionTriple(version, d.versionPattern);
    if (triple && !atLeast(triple, d.minVersion)) {
      return {
        state: 'incompatible',
        message: `${d.label} needs ${d.minVersion.join('.') || 'a newer'} or later; found "${version}". Update the tool.`,
      };
    }
  }
  // A JVM server needs a JDK, and specifically one new enough. Finding only a
  // `java` launcher is not enough: a JRE starts, then reports every `java.*`
  // import as unresolved, which looks like a broken project rather than a
  // broken runtime — so it is named here as its own honest state.
  let jdk: JdkInfo | null = null;
  const need = d.jdk;
  if (need) {
    const locatedJdk = await deps.findJdk({ customPath: extra.jdkPath || null, minMajor: 0, force: extra.force });
    if (!locatedJdk) {
      const located = await deps.discover('java', { versionArgs: ['-version'] });
      if (located.path) {
        return {
          state: 'incompatible',
          message:
            `A Java launcher was found (${located.path}) but no full JDK is installed — ${need.hint} ` +
            'On a JRE every java.* import fails to resolve. Install JDK ' +
            `${need.minMajor}+ (for example: winget install -e --id Microsoft.OpenJDK.21) and set JAVA_HOME, or type the JDK folder into "Custom JDK path" in Languages & Capabilities.`,
        };
      }
      return {
        state: 'missing',
        message:
          `No JDK found — ${need.hint} JAVA_HOME is ${process.env.JAVA_HOME ? 'set but does not point at a usable JDK' : 'not set'}, and no JDK was found in the usual install folders. ` +
          `Install JDK ${need.minMajor}+ (winget install -e --id Microsoft.OpenJDK.21) or set "Custom JDK path" in Languages & Capabilities.`,
      };
    }
    const major = locatedJdk.major ?? javaMajorOf(locatedJdk.version);
    if (major !== null && major < need.minMajor) {
      return {
        state: 'incompatible',
        message: `${d.label} needs JDK ${need.minMajor}+; found "${locatedJdk.version || 'unknown'}" in ${locatedJdk.home}. Install a newer JDK.`,
      };
    }
    jdk = locatedJdk;
  }
  return { state: 'ok', path: disc.path, version, jdk };
}

// ---------------------------------------------------------------------------
// Spawning (argv arrays only; Windows .cmd shims via cmd.exe /d /c, validated
// path + constant args only — the same pattern previewServer uses for npm)
// ---------------------------------------------------------------------------
const SAFE_ARG_RE = /^[\w.:\/\\=+@,\- ]+$/;

export function buildSpawn(
  toolPath: string,
  args: string[],
  env: Record<string, string>,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  comSpec: string = process.env.ComSpec || 'cmd.exe',
): { cmd: string; args: string[]; options: SpawnOptions } {
  const base: SpawnOptions = { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
  const isShim = platform === 'win32' && /\.(cmd|bat)$/i.test(toolPath);
  if (!isShim) return { cmd: toolPath, args, options: base };
  // The command line below is passed to cmd.exe verbatim (Node's own argv
  // quoting breaks cmd's parser), so neither the tool path nor the constant
  // args may contain quotes or shell metacharacters.
  if (!SAFE_CMD_PATH_RE.test(toolPath)) {
    throw new Error('Refusing to build a cmd line from an unsafe tool path.');
  }
  if (!args.every((a) => SAFE_ARG_RE.test(a))) {
    throw new Error('Refusing to build a cmd line from unsafe arguments.');
  }
  const commandLine = `"${toolPath}"${args.length ? ' ' + args.join(' ') : ''}`;
  return { cmd: comSpec, args: ['/d', '/c', commandLine], options: { ...base, windowsVerbatimArguments: true } };
}

// ---------------------------------------------------------------------------
// Content-Length framing <-> one-JSON-RPC-message-per-WebSocket-frame
// ---------------------------------------------------------------------------
function encodeFrame(msg: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, body]);
}

/** Pull complete Content-Length framed payloads out of `buf` (in place). */
function drainFrames(
  buf: Buffer[],
  total: { bytes: number },
  onPayload: (payload: Buffer) => void,
): 'ok' | 'overflow' | 'garbage' {
  for (;;) {
    // Flatten only when a full header could exist.
    if (total.bytes < 4) return 'ok';
    const joined = Buffer.concat(buf);
    const sep = joined.indexOf('\r\n\r\n');
    if (sep === -1) {
      if (joined.byteLength > MAX_HEADER_BYTES) return 'garbage';
      // Cache the scan position so a big stream stays cheap.
      buf.length = 0;
      buf.push(joined);
      return 'ok';
    }
    const headerText = joined.subarray(0, sep).toString('ascii').toLowerCase();
    const m = headerText.match(/content-length:\s*(\d+)/);
    if (!m) return 'garbage';
    const len = Number(m[1]);
    if (!Number.isFinite(len) || len < 0 || len > MAX_MESSAGE_BYTES) return 'overflow';
    const bodyStart = sep + 4;
    if (joined.byteLength < bodyStart + len) {
      buf.length = 0;
      buf.push(joined);
      total.bytes = joined.byteLength;
      return 'ok';
    }
    onPayload(joined.subarray(bodyStart, bodyStart + len));
    const rest = joined.subarray(bodyStart + len);
    buf.length = 0;
    if (rest.byteLength > 0) buf.push(rest);
    total.bytes = rest.byteLength;
  }
}

// ---------------------------------------------------------------------------
// Bridge lifecycle
// ---------------------------------------------------------------------------
/**
 * Environment for one server child: the localRun allow-list (never the whole
 * `process.env`), plus the selected JDK as JAVA_HOME with its `bin` first on
 * PATH. The second half is the actual Java fix — a launcher that resolves
 * `java` to a JRE starts happily and then reports every `java.*` import as
 * unresolvable, because a JRE carries no platform module image to attach.
 */
export function childEnvironment(entry: { jdkHome: string | null }, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env = sanitizeEnv(base);
  const home = entry.jdkHome;
  if (!home) return env;
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const bin = path.join(home, 'bin');
  env.JAVA_HOME = home;
  env[pathKey] = env[pathKey] ? `${bin}${path.delimiter}${env[pathKey]}` : bin;
  return env;
}

function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } catch {
      /* already gone */
    }
  } else {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function isAllowedOrigin(origin: string): boolean {
  // The renderer's own origins only: packaged file:// (ws clients send
  // Origin: file://) and the dev server / loopback http origins.
  if (!origin) return false;
  if (origin === 'file://') return true;
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

function handleConnection(entry: BridgeEntry, socket: WebSocket, deps: LspDeps): void {
  const d = LS_DESCRIPTORS[entry.language];
  if (!d) {
    socket.close();
    return;
  }
  const startedAt = Date.now();
  const env = childEnvironment(entry);
  let child: ChildProcess;
  try {
    const planned = entry.launch || { cmd: entry.toolPath, args: d.args };
    const spec = buildSpawn(planned.cmd, planned.args, env, entry.rootReal || os.tmpdir());
    child = deps.spawn(spec.cmd, spec.args, spec.options);
  } catch {
    entry.lastError = `Could not start ${d.tool}.`;
    socket.close();
    return;
  }
  entry.children.add(child);
  entry.connections += 1;

  const outBuf: Buffer[] = [];
  const outTotal = { bytes: 0 };
  let sawResponse = false;
  let parseDrops = 0;

  const sendToClient = (payload: Buffer) => {
    if (socket.readyState === socket.OPEN) socket.send(payload.toString('utf8'));
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    sawResponse = true;
    outBuf.push(chunk);
    outTotal.bytes += chunk.byteLength;
    const st = drainFrames(outBuf, outTotal, sendToClient);
    if (st !== 'ok') {
      // A server that emits non-framed output is unusable; kill it rather
      // than leaking a corrupt stream into the editor.
      entry.lastError = `${d.label} sent malformed protocol data (dropped).`;
      killTree(child);
      if (socket.readyState === socket.OPEN) socket.close(1011, 'protocol-error');
    }
  });
  // The server's own diagnostics. This is the only place a real JDT.LS/clangd
  // explains *why* it failed (missing bundle, unreadable workspace, JVM flag),
  // so it is kept — redacted and bounded — instead of being thrown away, and it
  // is surfaced through status() rather than written to any log file.
  let stderrPending = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrPending += chunk;
    if (stderrPending.length > MAX_STDERR_BUFFER) stderrPending = stderrPending.slice(-MAX_STDERR_BUFFER);
    const lines = stderrPending.split(/\r?\n/);
    stderrPending = lines.pop() ?? '';
    for (const line of lines) {
      const text = redactServerLog(line).trim();
      if (!text) continue;
      entry.logTail.push(text.slice(0, 400));
      if (entry.logTail.length > MAX_LOG_TAIL_LINES) entry.logTail.shift();
    }
  });

  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (isBinary || entry.disposed) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      parseDrops += 1;
      return; // malformed frame: drop, never forward
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof (msg as any).method !== 'string' && (msg as any).jsonrpc !== '2.0') {
      parseDrops += 1;
      return; // not a single JSON-RPC message: drop
    }
    try {
      child.stdin?.write(encodeFrame(msg as Record<string, unknown>));
    } catch {
      /* child gone; the exit handler closes the socket */
    }
  });

  let settled = false;
  const closeSocket = () => {
    if (settled) return;
    settled = true;
    entry.connections = Math.max(0, entry.connections - 1);
    entry.children.delete(child);
    if (socket.readyState === socket.OPEN || socket.readyState === socket.CONNECTING) {
      try {
        socket.close(1000, 'server-exited');
      } catch {
        /* ignore */
      }
    }
    const lifeMs = Date.now() - startedAt;
    if (lifeMs < CRASH_WINDOW_MS && !sawResponse) {
      entry.crashStreak += 1;
      if (entry.crashStreak >= CRASH_LIMIT) {
        // The tail is what makes this actionable ("could not create the Java
        // virtual machine", "Configuration ... not found") instead of a dead end.
        const why = entry.logTail.length ? ` Last output: ${entry.logTail.slice(-3).join(' | ')}` : '';
        entry.lastError = `${d.label} exited abnormally ${entry.crashStreak} times in a row; disabled until restarted.${why}`;
        crashedKeys.add(entry.key);
        void disposeBridge(entry);
      }
    } else if (sawResponse) {
      entry.crashStreak = 0;
    }
  };
  child.on('close', closeSocket);
  child.on('error', () => {
    entry.lastError = `${d.tool} could not be started.`;
    closeSocket();
  });
  socket.on('close', () => {
    entry.children.delete(child);
    killTree(child);
  });
  socket.on('error', () => {
    /* drop; close follows */
  });
}

async function disposeBridge(entry: BridgeEntry): Promise<void> {
  if (entry.disposed) return;
  entry.disposed = true;
  bridges.delete(entry.key);
  for (const child of entry.children) killTree(child);
  entry.children.clear();
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    entry.wss.close(done);
    entry.http.close(done);
    for (const client of entry.wss.clients) {
      try {
        client.close(1000, 'stopped');
      } catch {
        /* ignore */
      }
    }
    setTimeout(done, 1500);
  });
}

// ---------------------------------------------------------------------------
// Public API (called from ipc.ts through the validating wrap())
// ---------------------------------------------------------------------------
export type LspStartResult = {
  wsUrl: string;
  port: number;
  tool: string;
  version: string | null;
  reused: boolean;
  /** JDK the server runs on (Java): the renderer hands its home to the server as `java.home`. */
  jdkHome: string | null;
  jdkVersion: string | null;
};

/**
 * Start (or reuse) the bridge for `language` rooted at `root`.
 * Returns the loopback ws URL the renderer connects to, or an honest
 * MISSING_TOOL / INCOMPATIBLE / FORBIDDEN / UNSUPPORTED_LANGUAGE result.
 */
export async function start(
  args: {
    language?: string;
    root?: string | null;
    toolPath?: string | null;
    /** Absolute JDK folder/launcher override (Java only), used before JAVA_HOME. */
    jdkPath?: string | null;
    /** Drop cached tool/JDK discovery (the user just installed or re-pointed something). */
    reprobe?: boolean;
    /** App data folder for server workspaces (supplied by main, never by the renderer). */
    storageRoot?: string | null;
  },
  deps: LspDeps = realDeps,
): Promise<Result<LspStartResult>> {
  const language = typeof args?.language === 'string' ? args.language : '';
  const d = LS_DESCRIPTORS[language];
  if (!d) return fail('UNSUPPORTED_LANGUAGE', `"${language}" has no configured language server in this app.`);

  let rootReal = '';
  if (typeof args.root === 'string' && args.root) {
    const guarded = resolveWithinRoots(args.root);
    if (guarded === null) return fail('FORBIDDEN', 'That folder is not an opened workspace root.');
    rootReal = guarded;
  }

  let customPath: string | null = null;
  if (typeof args.toolPath === 'string' && args.toolPath) {
    if (!path.isAbsolute(args.toolPath)) return fail('BAD_TOOL_PATH', 'A configured tool path must be absolute.');
    customPath = args.toolPath;
  }
  let jdkPath: string | null = null;
  if (typeof args.jdkPath === 'string' && args.jdkPath) {
    if (!path.isAbsolute(args.jdkPath)) return fail('BAD_TOOL_PATH', 'A configured JDK path must be absolute.');
    jdkPath = args.jdkPath;
  }

  const key = bridgeKey(d.id, rootReal);
  if (crashedKeys.has(key)) {
    return fail('LS_CRASHED', `The ${d.label} server crashed repeatedly and is disabled for this folder. Stop it or restart the app to try again.\n${bridges.get(key)?.lastError || ''}`.trim());
  }
  const existing = bridges.get(key);
  if (existing && !existing.disposed && !args.reprobe) {
    return {
      ok: true,
      wsUrl: existing.url,
      port: existing.port,
      tool: d.tool,
      version: existing.version,
      reused: true,
      jdkHome: existing.jdkHome,
      jdkVersion: existing.jdkVersion,
    };
  }
  if (existing && !existing.disposed && args.reprobe) {
    // Same key, new settings: the old child (and its JDK) must not be reused.
    await disposeBridge(existing);
    crashedKeys.delete(key);
  }

  const toolState = await resolveToolState(d, customPath, deps, { jdkPath, force: Boolean(args.reprobe) });
  if (toolState.state === 'missing') return fail('MISSING_TOOL', toolState.message);
  if (toolState.state === 'incompatible') return fail('INCOMPATIBLE', toolState.message);

  // JVM servers are launched through the discovered JDK, with the distribution
  // layout resolved from whatever the user pointed at (folder, script or jar).
  let launch: { cmd: string; args: string[] } | null = null;
  if (d.eclipseLayout) {
    if (!toolState.jdk) return fail('MISSING_TOOL', `No usable JDK for ${d.label}.`);
    const layout = findEclipseLayout(toolState.path);
    if (!layout) {
      return fail(
        'MISSING_TOOL',
        `${toolState.path} is not an Eclipse JDT.LS install (no plugins/org.eclipse.equinox.launcher_*.jar next to it). Point "Custom tool path" at the unpacked jdtls folder — the one that contains plugins/ and config_win/ — or at its bin/jdtls launcher.`,
      );
    }
    const storage = typeof args.storageRoot === 'string' && args.storageRoot ? args.storageRoot : path.join(os.tmpdir(), 'stackamit-ide');
    launch = planJdtlsLaunch({
      jdk: toolState.jdk,
      layout,
      // One data area per project, reused between sessions so the index (and
      // therefore offline startup) survives restarts.
      dataDir: jdtlsDataDir(storage, rootReal || path.join(storage, 'standalone')),
    });
  }

  const entry: BridgeEntry = {
    key,
    descriptorId: d.id,
    language,
    rootReal,
    toolPath: toolState.path,
    launch,
    jdkHome: toolState.jdk?.home ?? null,
    jdkVersion: toolState.jdk?.version ?? null,
    version: toolState.version,
    http: null as unknown as http.Server,
    wss: null as unknown as WebSocketServer,
    port: 0,
    url: '',
    children: new Set(),
    connections: 0,
    crashStreak: 0,
    lastError: null,
    logTail: [],
    disposed: false,
  };

  const httpServer = http.createServer((_req, res) => {
    // This server only speaks WebSocket on /lsp; plain HTTP gets nothing.
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('Upgrade required');
  });
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/lsp',
    verifyClient: ({ origin }: { origin: string }) => isAllowedOrigin(origin),
    maxPayload: MAX_MESSAGE_BYTES,
  });
  wss.on('connection', (socket) => handleConnection(entry, socket, deps));
  wss.on('error', () => {
    entry.lastError = 'The local bridge could not be started.';
  });
  entry.http = httpServer;
  entry.wss = wss;

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
  } catch {
    try {
      wss.close();
      httpServer.close();
    } catch {
      /* ignore */
    }
    return fail('LISTEN_FAILED', `Could not open a local address for ${d.label}.`);
  }
  entry.port = (httpServer.address() as { port: number }).port;
  entry.url = `ws://127.0.0.1:${entry.port}/lsp`;
  bridges.set(key, entry);
  return {
    ok: true,
    wsUrl: entry.url,
    port: entry.port,
    tool: d.tool,
    version: entry.version,
    reused: false,
    jdkHome: entry.jdkHome,
    jdkVersion: toolState.jdk?.version ?? null,
  };
}

export async function stop(args: { language?: string; root?: string | null }): Promise<Result<{ stopped: boolean }>> {
  const d = LS_DESCRIPTORS[typeof args?.language === 'string' ? args.language : ''];
  if (!d) return fail('UNSUPPORTED_LANGUAGE', 'No configured language server.');
  let rootReal = '';
  if (typeof args.root === 'string' && args.root) {
    rootReal = resolveWithinRoots(args.root) || '';
  }
  const key = bridgeKey(d.id, rootReal);
  crashedKeys.delete(key);
  const entry = bridges.get(key);
  if (!entry) return { ok: true, stopped: false };
  await disposeBridge(entry);
  return { ok: true, stopped: true };
}

export function status(args: {
  language?: string;
  root?: string | null;
}): Result<{
  state: 'running' | 'stopped';
  wsUrl?: string;
  connections?: number;
  tool?: string;
  version?: string | null;
  error?: string | null;
  logTail?: string[];
}> {
  const d = LS_DESCRIPTORS[typeof args?.language === 'string' ? args.language : ''];
  if (!d) return fail('UNSUPPORTED_LANGUAGE', 'No configured language server.');
  let rootReal = '';
  if (typeof args.root === 'string' && args.root) {
    rootReal = resolveWithinRoots(args.root) || '';
  }
  const key = bridgeKey(d.id, rootReal);
  if (crashedKeys.has(key)) {
    const dead = bridges.get(key);
    return { ok: true, state: 'stopped', tool: d.tool, error: dead?.lastError || 'crashed', logTail: dead?.logTail || [] };
  }
  const entry = bridges.get(key);
  if (!entry || entry.disposed) return { ok: true, state: 'stopped', tool: d.tool, logTail: [] };
  return {
    ok: true,
    state: 'running',
    wsUrl: entry.url,
    connections: entry.connections,
    tool: d.tool,
    version: entry.version,
    error: entry.lastError,
    logTail: entry.logTail.slice(-10),
  };
}

/** Test/debug view of live bridges. */
export function activeBridges(): { key: string; tool: string; url: string; connections: number }[] {
  return [...bridges.values()].map((b) => ({ key: b.key, tool: b.descriptorId, url: b.url, connections: b.connections }));
}

/** Terminate every bridge and child (app exit / window destroyed). */
export function disposeAll(): void {
  crashedKeys.clear();
  for (const entry of bridges.values()) {
    entry.disposed = true;
    for (const child of entry.children) killTree(child);
    entry.children.clear();
    try {
      entry.wss.close();
      entry.http.close();
    } catch {
      /* ignore */
    }
  }
  bridges.clear();
}
