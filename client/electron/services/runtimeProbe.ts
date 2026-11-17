/**
 * Local runtime discovery for the desktop app (Electron main process).
 *
 * Deliberately free of any `electron` import: everything here is plain Node so
 * the module can be unit-tested under vitest and reused by the packaged app.
 *
 * Discovery does three things, in this order:
 *  1. locate the executable on PATH (no shell, so spaces and non-ASCII entries
 *     in PATH or in the user profile cannot break the lookup);
 *  2. actually spawn it with its version flag, because an executable that
 *     exists is not necessarily usable (Windows App-Execution aliases and
 *     half-installed toolchains both resolve on PATH and then fail);
 *  3. record the version line it printed, so the UI can show what was found
 *     instead of guessing.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const IS_WIN = process.platform === 'win32';

export type RuntimeProbe = {
  label: string;
  /** Candidate commands, tried in order. */
  cmds: string[];
  /** Arguments that print a version and exit 0. */
  args: string[];
  /** Where a missing runtime comes from, for an honest install hint. */
  installHint: string;
};

/**
 * The runtimes this build claims to run *locally*. Anything beyond these needs
 * the online provider, and the UI says so — Monaco highlighting is not a
 * compiler, and this file is the only place that decides what is executable.
 */
export const LOCAL_RUNTIMES: Record<string, RuntimeProbe> = {
  python: {
    label: 'Python',
    cmds: ['python', 'python3', 'py'],
    args: ['--version'],
    installHint: 'Install Python from python.org (or `winget install Python.Python.3.12`) and make sure "Add to PATH" is ticked.',
  },
  javascript: {
    label: 'Node.js',
    cmds: ['node'],
    args: ['--version'],
    installHint: 'Install Node.js from nodejs.org (or `winget install OpenJS.NodeJS.LTS`).',
  },
  powershell: {
    label: 'PowerShell',
    cmds: ['pwsh', 'powershell'],
    args: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'],
    installHint: 'Windows PowerShell 5.1 ships with Windows; for PowerShell 7 use `winget install Microsoft.PowerShell`.',
  },
  java: {
    label: 'Java',
    cmds: ['java'],
    // `--version` is JDK 10+; `-version` is the one flag every Java ever
    // printed — and it prints on stderr, which probeRuntime accepts.
    args: ['-version'],
    installHint:
      'Install a Java development kit (`winget install -e --id Microsoft.OpenJDK.21` or Eclipse.Temurin-JDK-21). A browser/plugin JRE cannot compile.',
  },
  cpp: {
    label: 'C++',
    // `g++` first (MinGW / MSYS2 / WinLibs), then clang, then the POSIX name.
    // Each candidate is *run*, so a stray `c++` shim cannot claim support.
    cmds: ['g++', 'clang++', 'c++'],
    args: ['--version'],
    installHint:
      'Install a C++ compiler: `winget install -e --id BrechtSanders.WinLibs.POSIX.UCRT` (g++), MSYS2 (`winget install -e --id MSYS2.MSYS2`, then `pacman -S mingw-w64-x86-64-gcc`), or LLVM (`winget install -e --id LLVM.LLVM`) for clang++. If it is installed but not on PATH, set "Custom compiler path" in Languages & Capabilities.',
  },
  typescript: {
    label: 'TypeScript',
    // `tsc` is the compiler. On Windows it is very often a `.cmd` shim in an npm
    // global bin, which `probeRuntime` runs through cmd.exe. That bare shim is
    // only a first guess: `detectLocalRuntimes` then runs `discoverTypeScript`
    // with the configured path and the opened workspace, so the reported
    // compiler is the same runnable `tsc` (project-local, configured, or global)
    // that a Run of a file in this workspace would actually use.
    cmds: ['tsc'],
    args: ['--version'],
    installHint:
      'Install TypeScript so the app can compile and run .ts files — the common way is a project dependency (`npm install --save-dev typescript`), or globally with `npm install -g typescript`. Node.js must also be installed.',
  },
};

export type DetectedRuntime = {
  key: string;
  label: string;
  available: boolean;
  /** The command that was chosen (e.g. `python` vs the `py` launcher). */
  cmd: string | null;
  /** Absolute path of the executable actually found, when PATH resolves it. */
  path: string | null;
  /** First version line the tool printed (stdout, or stderr for `java`). */
  version: string | null;
  installHint: string;
  /**
   * For `java`: the validated JDK this runtime belongs to. A launcher on PATH
   * proves nothing about the compiler next to it, so the run plan needs the
   * home directory (`<home>/bin/javac`) rather than the bare executable.
   */
  jdk?: JdkInfo | null;
  /**
   * For `cpp`: the compiler that was actually found and run, including the
   * folder holding the runtime DLLs the built program needs to start.
   */
  compiler?: CppCompiler | null;
  /**
   * For `typescript`: the compiler (`tsc` JS entry) and the Node executable it
   * runs under, both validated by running them. `null` when the app could only
   * see a shell shim, not a runnable compiler on this machine.
   */
  tsCompiler?: TypeScriptCompiler | null;
};

const PROBE_TIMEOUT_MS = 8000;

/** Append the platform executable suffix when a bare command name is used. */
export function executableName(cmd: string): string {
  if (cmd.includes('/') || cmd.includes('\\')) return cmd;
  return IS_WIN ? `${cmd}.exe` : cmd;
}

/**
 * Find an executable on PATH without spawning a shell. Windows also consults
 * PATHEXT so a `.cmd`/`.bat` shim is found the way `where.exe` would find it.
 * The search list is `pathSearchDirs()` — the inherited PATH plus the current
 * registry PATH — because a desktop app started from a shortcut may be holding
 * an environment snapshot from before a toolchain was installed.
 */
export function locateOnPath(cmd: string): string | null {
  if (path.isAbsolute(cmd)) return fs.existsSync(cmd) ? cmd : null;
  const exts = IS_WIN
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const dir of pathSearchDirs()) {
    for (const ext of exts) {
      const candidate = path.join(dir, IS_WIN ? cmd + ext : cmd);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Environment freshness (why the inherited PATH is not enough on Windows)
// ---------------------------------------------------------------------------
/**
 * A Windows process gets the environment block of whatever started it, so an app
 * launched from a desktop shortcut carries the PATH as it looked when that
 * shell's own environment was created. A compiler installed afterwards — or a
 * PATH edit that was never broadcast — is therefore invisible to the desktop app
 * while a freshly opened `cmd.exe` finds it. That mismatch is exactly why
 * `g++ 'is not recognized'` can appear in the app's integrated terminal next to
 * a Command Prompt where the same command works.
 *
 * Rather than telling the user to restart everything, the authoritative PATH is
 * read from the registry and *appended* to the search list: the inherited PATH
 * keeps priority, so nothing that already resolves changes, and only the entries
 * the snapshot is missing become visible. `reg.exe` is spawned with an argv array
 * of constant key names — no path, source or user input ever reaches a shell.
 */
const REG_PATH_KEYS = [
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  'HKCU\\Environment',
] as const;

/** Extra PATH directories recovered from the registry (order preserved). */
let registryDirs: string[] = [];
let registryChecked = false;

/**
 * The `Path` value out of `reg query` output, or null. The value is
 * REG_(EXPAND_)SZ and the data starts after the type name, so a PATH entry may
 * legally contain spaces — the whole rest of the line is the value.
 */
export function parseRegValue(stdout: string, name = 'Path'): string | null {
  const re = new RegExp(`^\\s+${name}\\s+REG_[A-Z_]+\\s+(\\S.*)$`, 'im');
  const m = String(stdout || '').match(re);
  return m ? m[1].trim() : null;
}

/** Expand `%VAR%` tokens the way Windows does when it reads a PATH value. */
export function expandEnvTokens(value: string): string {
  return String(value).replace(/%([^%]+)%/g, (whole, name: string) => {
    const actual = Object.keys(process.env).find((k) => k.toUpperCase() === name.toUpperCase());
    const repl = actual ? process.env[actual] : undefined;
    return repl ? repl : whole; // an unknown token is left as-is, never guessed
  });
}

/** Split + de-duplicate PATH strings, keeping first-seen order. */
export function mergePathDirs(...values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    for (const raw of String(value || '').split(path.delimiter)) {
      let trimmed = raw.trim().replace(/^["']+|["']+$/g, '');
      // `C:\Tools` and `C:\Tools\` are the same directory to Windows, and the
      // registry value usually has the trailing separator while an inherited
      // environment usually does not. Left alone they would be searched twice
      // and one spelling could hide the fact that the other was already found.
      // A drive root (`C:\`) and the POSIX root (`/`) keep their separator.
      while (trimmed.length > 3 && /[\\/]$/.test(trimmed)) trimmed = trimmed.slice(0, -1);
      if (!trimmed) continue;
      // Windows path comparison is case-insensitive; a duplicated folder would
      // otherwise be searched twice.
      const key = IS_WIN ? trimmed.toLowerCase() : trimmed;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * The directories a tool lookup searches: the inherited PATH first, then the
 * registry PATH entries the snapshot is missing. Synchronous by design (it is
 * used by `locateOnPath`), fed by `refreshPathFromRegistry()`.
 */
export function pathSearchDirs(): string[] {
  return mergePathDirs(process.env.PATH, registryDirs.join(path.delimiter));
}

/**
 * The PATH a child process should get: `base` (this process's own by default)
 * first, then the registry entries the snapshot is missing.
 *
 * A caller passes *its own* base when it is building an environment for someone
 * else — a sanitised child environment, a preview launcher — so the allow-list it
 * chose stays in charge and this only ever *adds* what the inherited snapshot
 * was missing. Without it, a lookup that found a tool through the merged list
 * and a child that was handed the raw snapshot would disagree, which is how a
 * program the app just ran fails to find `npm`, `git` or its own compiler while
 * the IDE reports that very tool as available.
 */
export function mergedPathEnv(base?: string | null): string {
  return mergePathDirs(base ?? process.env.PATH, registryDirs.join(path.delimiter)).join(path.delimiter);
}

/**
 * Make this process's own PATH the merged one, so every child inherits it.
 *
 * Necessary because a Windows pseudo-terminal does not honour an `env` option:
 * `node-pty` (ConPTY) launches the shell with *this process's* environment, so
 * passing a merged PATH to `pty.spawn` silently changes nothing and the
 * integrated terminal keeps reporting `'g++' is not recognized` next to a
 * Command Prompt where the same command works. The change is purely additive —
 * `mergePathDirs` keeps the inherited entries in front and appends only what the
 * snapshot is missing, so nothing that already resolves can stop resolving.
 *
 * Returns the value applied (idempotent: applying it twice changes nothing).
 */
export function applyMergedPathToProcess(): string {
  const merged = mergedPathEnv();
  if (process.env.PATH !== merged) {
    process.env.PATH = merged;
  }
  return merged;
}

/**
 * Re-read the registry PATH and push it into this process. Called once at
 * startup (before any child exists) and again whenever the user re-checks
 * runtimes, so a toolchain installed *after* the app was launched becomes
 * visible to the terminal, the runners and the language servers.
 */
export async function refreshProcessPath(force = false): Promise<string> {
  await refreshPathFromRegistry(force);
  return applyMergedPathToProcess();
}

/** Read one registry `Path` value through `reg.exe` (argv array, no shell). */
function queryRegistryPath(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('reg.exe', ['query', key, '/v', 'Path'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      resolve(null);
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve(null);
    }, PROBE_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(parseRegValue(out));
    });
  });
}

/**
 * Recover the current Machine + User PATH from the registry once (and on every
 * forced re-detection, which is what "I just installed it" uses). A missing
 * `reg.exe`, a locked hive or a timeout is not an error: the inherited PATH
 * simply stays the whole truth, exactly as it was before this existed.
 */
export async function refreshPathFromRegistry(force = false): Promise<string[]> {
  if (!IS_WIN) {
    registryChecked = true;
    return registryDirs;
  }
  if (registryChecked && !force) return registryDirs;
  const values = await Promise.all(REG_PATH_KEYS.map((key) => queryRegistryPath(key)));
  const expanded = values.filter(Boolean).map((v) => expandEnvTokens(v as string));
  // Machine first: it is where a system-wide compiler install lands.
  registryDirs = mergePathDirs(...expanded);
  registryChecked = true;
  return registryDirs;
}

/** Forget the recovered PATH (tests, or a toolchain installed mid-session). */
export function invalidatePathCache(): void {
  registryDirs = [];
  registryChecked = false;
}

/**
 * Chars a tool path may contain to be safely embedded (quoted) into a
 * cmd.exe command line with windowsVerbatimArguments: letters, digits,
 * spaces and path punctuation only — never quotes, & | < > ^ % ! ( ) or
 * other shell metacharacters. Used by both version probes and the
 * language-server bridge, which run .cmd shims through cmd.exe.
 */
export const SAFE_CMD_PATH_RE = /^[\p{L}\p{N} .:\/\\=+@,_\-]+$/u;

/** Spawn `cmd args` and report success plus the version line it printed. */
export function probeRuntime(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; version: string | null; path: string | null }> {
  const located = locateOnPath(cmd);
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (ok: boolean, version: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ok, version, path: located });
    };
    let child;
    try {
      const exe = located || executableName(cmd);
      // npm/Python global bins on Windows are `.cmd` shims, which Node refuses
      // to spawn directly (EINVAL). Run them via cmd.exe with the bridge's
      // verbatim-quoting pattern; every real .exe still spawns without a shell.
      const isShim = IS_WIN && /\.(cmd|bat)$/i.test(exe);
      if (isShim && !SAFE_CMD_PATH_RE.test(exe)) {
        done(false, null); // never embed an unsafe path into a cmd command line
        return;
      }
      const file = isShim ? process.env.ComSpec || 'cmd.exe' : exe;
      const argv = isShim ? ['/d', '/c', `"${exe}" ${args.join(' ')}`] : args;
      child = spawn(file, argv, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        ...(isShim ? { windowsVerbatimArguments: true } : {}),
      });
    } catch {
      done(false, null);
      return;
    }
    let out = '';
    const capture = (chunk: Buffer) => {
      // Some tools (notably `java -version`) print to stderr; accept either.
      if (!out) out = String(chunk);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      done(false, null);
    }, PROBE_TIMEOUT_MS);
    child.on('error', () => done(false, null));
    child.on('close', (code) => {
      const line = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || null;
      done(code === 0 && Boolean(line), line);
    });
  });
}

/**
 * Downgrade a candidate that a deeper, authoritative lookup rejected.
 *
 * `available: false` must mean the record carries no half-truths: leaving the
 * `cmd`/`path`/`version` of the rejected candidate populated let callers (and
 * the UI) render "not available — python 3.12 (C:\…)", and any code that read
 * `cmd` without checking `available` would launch a tool the probe had just
 * decided could not run this language. So the fields go null together.
 */
function markUnavailable<T extends Partial<DetectedRuntime>>(record: T, extra: Record<string, unknown> = {}): T {
  return { ...record, available: false, cmd: null, path: null, version: null, ...extra } as T;
}

let cache: { key: string; runtimes: Record<string, DetectedRuntime> } | null = null;

/**
 * Detect the locally runnable runtimes; the result is cached until forced.
 * `jdkPath` is the user-configured JDK folder (Languages & Capabilities): it has
 * to reach the Java lookup here, or a run would report "no Java" next to an
 * IntelliSense session that is working fine on that very JDK.
 */
export async function detectLocalRuntimes(
  force = false,
  jdkPath: string | null = null,
  compilerPath: string | null = null,
  context: { tsCompilerPath?: string | null; workspaceRoot?: string | null } = {},
): Promise<Record<string, DetectedRuntime>> {
  const tsCompilerPath = context.tsCompilerPath ?? null;
  const workspaceRoot = context.workspaceRoot ?? null;
  const cacheKey = `${jdkPath || ''}|${compilerPath || ''}|${tsCompilerPath || ''}|${workspaceRoot || ''}`;
  if (cache && !force && cache.key === cacheKey) return cache.runtimes;
  // A shortcut-launched app may hold a PATH snapshot from before a compiler was
  // installed, so the registry PATH is recovered before anything is looked up.
  await refreshPathFromRegistry(force);
  const entries = await Promise.all(
    Object.entries(LOCAL_RUNTIMES).map(async ([key, probe]) => {
      let chosen: DetectedRuntime = {
        key,
        label: probe.label,
        available: false,
        cmd: null,
        path: null,
        version: null,
        installHint: probe.installHint,
      };
      for (const cmd of probe.cmds) {
        const res = await probeRuntime(cmd, probe.args);
        if (res.ok) {
          chosen = {
            key,
            label: probe.label,
            available: true,
            cmd,
            path: res.path,
            version: res.version,
            installHint: probe.installHint,
          };
          break;
        }
      }
      // Java is not "a command on PATH": `java` is very often a JRE with no
      // compiler, and running a program on it fails on the first line. Ask the
      // JDK finder, which validates the home directory, and let its answer win
      // — so the UI reports Java available only when Java can really run.
      if (key === 'java') {
        const jdk = await findJdk({ customPath: jdkPath, force });
        if (jdk) {
          chosen = {
            key,
            label: probe.label,
            available: true,
            cmd: 'java',
            path: jdk.javaExe,
            version: jdk.version || chosen.version,
            installHint: probe.installHint,
            jdk,
          };
        } else if (chosen.available) {
          chosen = markUnavailable(chosen, { jdk: null });
        }
      }
      // C++ is a toolchain, not a command name: PATH is searched, then the
      // well-known install folders, then the configured path — and the answer
      // that is *run and read* wins over whatever `g++` happened to resolve to.
      if (key === 'cpp') {
        const discovery = await discoverCpp({ customPath: compilerPath, force });
        if (discovery.compiler) {
          chosen = {
            key,
            label: probe.label,
            available: true,
            cmd: discovery.compiler.cmd,
            path: discovery.compiler.exe,
            version: discovery.compiler.version,
            installHint: probe.installHint,
            compiler: discovery.compiler,
          };
        } else {
          if (chosen.available) chosen = markUnavailable(chosen);
          // A compiler that exists but cannot be used is reported as such —
          // "no C++ compiler" would be a lie, and "C++ ready" would be worse.
          if (discovery.rejected.length) {
            chosen = {
              ...chosen,
              installHint: `${probe.installHint} Also found but unusable: ${discovery.rejected
                .map((r) => `${path.basename(r.exe)} — ${r.reason}`)
                .join('; ')}.`,
            };
          }
        }
      }
      // TypeScript runs on Node as a compiler that must be *executed*, not just
      // named on PATH: the plain `tsc` probe above may only have found a shell
      // shim. `discoverTypeScript` locates the runnable JS entry and validates
      // it — given the configured path and the opened workspace — so the badge
      // reports exactly the compiler a Run of a file in this workspace would use
      // (a project `node_modules/typescript` wins over a global install), and the
      // UI can never contradict the run.
      if (key === 'typescript') {
        const discovery = await discoverTypeScript({
          customPath: tsCompilerPath,
          workspaceRoot,
          force,
        });
        if (discovery.compiler) {
          chosen = {
            key,
            label: probe.label,
            available: true,
            cmd: 'tsc',
            path: discovery.compiler.tscJs,
            version: discovery.compiler.version,
            installHint: probe.installHint,
            tsCompiler: discovery.compiler,
          };
        } else {
          if (chosen.available) chosen = markUnavailable(chosen, { tsCompiler: null });
          if (discovery.rejected.length) {
            chosen = {
              ...chosen,
              installHint: `${probe.installHint} Also seen but unusable: ${discovery.rejected
                .map((r) => `${path.basename(r.where)} — ${r.reason}`)
                .join('; ')}.`,
            };
          }
        }
      }
      return [key, chosen] as const;
    }),
  );
  cache = { key: cacheKey, runtimes: Object.fromEntries(entries) };
  return cache.runtimes;
}

/** Forget the cached detection (after an install, or for tests). */
export function invalidateLocalRuntimes(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// JDK discovery (a language server needs a JDK, not just any `java`)
// ---------------------------------------------------------------------------
/**
 * Why this exists: `java` on PATH only proves a launcher is reachable. On
 * Windows it very often belongs to a browser/plugin **JRE**, which has no
 * compiler and no JDK module image. A Java language server started on such a
 * runtime cannot attach the platform libraries to the project, and the editor
 * then reports every standard-library import (`java.util`, `java.time`,
 * `java.io`) as an error. So the JDK is located as a *home directory* that
 * demonstrably carries the development libraries, independently of whichever
 * `java` happens to be first on PATH.
 */
export type JdkInfo = {
  /** The JDK home directory (the folder that contains `bin`). */
  home: string;
  /** Absolute path of `<home>/bin/java(.exe)`. */
  javaExe: string;
  /** Release line from `<home>/release`, or printed by `java -version`. */
  version: string | null;
  /** Java major version (`1.8.0_452` -> 8, `21.0.2` -> 21); null if unknown. */
  major: number | null;
  /** How it was found: 'custom' | 'JAVA_HOME' | 'PATH' | 'scan'. */
  source: string;
};

/** "1.8.0_452" -> 8, "21.0.2" -> 21, "11" -> 11. Null when unparseable. */
export function javaMajorOf(version: string | null): number | null {
  if (!version) return null;
  const m = String(version).match(/"?(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const first = Number(m[1]);
  const second = Number(m[2] || 0);
  return first === 1 && second > 0 ? second : first;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** `<home>/release` -> JAVA_VERSION value, or null when absent/unreadable. */
export function readJdkReleaseVersion(home: string): string | null {
  try {
    const text = fs.readFileSync(path.join(home, 'release'), 'utf8');
    const m = text.match(/^JAVA_VERSION="?([^"\r\n]+)"?/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * True when `home` is a Java development kit rather than a runtime-only
 * install: a `bin/java` launcher plus either the compiler (`bin/javac`) or the
 * JDK module image / `release` file (JDK 9+ layouts).
 */
export function isJdkHome(home: string): boolean {
  if (!home || !isDirectory(home)) return false;
  const javaBin = path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java');
  if (!isFile(javaBin)) return false;
  return (
    isFile(path.join(home, 'bin', IS_WIN ? 'javac.exe' : 'javac')) ||
    isFile(path.join(home, 'lib', 'modules')) ||
    isFile(path.join(home, 'release'))
  );
}

/**
 * Accept a home folder, a `.../bin` folder or the launcher itself and return
 * the JDK home. Keeps a user-configured path labelled with its real origin.
 */
function normalizeJdkHome(raw: string): string {
  let h = String(raw).replace(/["'\s]+$/g, '');
  // A configured path may point at the launcher itself or at `<jdk>/bin`.
  if (/java(\.exe)?$/i.test(h)) h = path.dirname(path.dirname(h));
  else if (/[/\\]bin$/i.test(h)) h = path.dirname(h);
  return path.resolve(h);
}

/** Candidate JDK homes in preference order, from settings and well-known roots. */
export function jdkCandidateHomes(customPath?: string | null): string[] {
  const out: string[] = [];
  const push = (raw?: string | null) => {
    if (!raw) return;
    let h: string;
    try {
      h = normalizeJdkHome(raw);
    } catch {
      return;
    }
    if (!out.includes(h)) out.push(h);
  };

  push(customPath);
  push(process.env.JAVA_HOME);

  // `java` on PATH: its grandparent is the home directory (JDK or JRE —
  // isJdkHome() is what rejects the runtime-only one).
  const onPath = locateOnPath('java');
  if (onPath) push(path.dirname(path.dirname(onPath)));

  const roots: string[] = IS_WIN
    ? [
        path.join(process.env.USERPROFILE || '', '.jdks'),
        'C:\\Program Files\\Java',
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Microsoft',
        'C:\\Program Files\\Zulu',
        'C:\\Program Files\\Amazon Corretto',
        'C:\\Program Files\\BellSoft',
        'C:\\Program Files\\Semeru',
        'C:\\Program Files (x86)\\Java',
      ]
    : process.platform === 'darwin'
      ? ['/Library/Java/JavaVirtualMachines', '/System/Library/Java/JavaVirtualMachines']
      : ['/usr/lib/jvm', '/usr/java', '/opt/java'];

  for (const root of roots) {
    if (!root || !isDirectory(root)) continue;
    let names: string[] = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names.slice().sort()) {
      const candidate = path.join(root, name);
      // macOS bundles keep the real home one level deeper.
      if (isDirectory(path.join(candidate, 'Contents', 'Home'))) push(path.join(candidate, 'Contents', 'Home'));
      else push(candidate);
    }
  }
  return out;
}

const jdkCache = new Map<string, JdkInfo | null>();

/**
 * Locate a usable JDK. `minMajor` filters by parsed version; a JDK whose
 * version cannot be read is kept rather than rejected (claiming it was too old
 * would be invented). An explicit `customPath` wins when it validates, and
 * otherwise the newest qualifying home wins, so a leftover `1.8` never shadows
 * a freshly installed 21.
 */
export async function findJdk(
  opts: { customPath?: string | null; minMajor?: number; force?: boolean } = {},
): Promise<JdkInfo | null> {
  const custom = typeof opts.customPath === 'string' && opts.customPath ? opts.customPath : null;
  const minMajor = opts.minMajor ?? 0;
  const key = `${custom || ''}|${minMajor}`;
  if (!opts.force && jdkCache.has(key)) return jdkCache.get(key) ?? null;

  // JAVA_HOME is allowed to name `<jdk>` or `<jdk>\bin`; candidate homes are
  // normalized the same way so the comparison (and the 'JAVA_HOME' label) holds.
  const javaHome = process.env.JAVA_HOME ? normalizeJdkHome(process.env.JAVA_HOME) : null;
  const customHome = custom ? normalizeJdkHome(custom) : null;
  const onPathHome = (() => {
    const located = locateOnPath('java');
    return located ? path.dirname(path.dirname(located)) : null;
  })();

  const found: JdkInfo[] = [];
  for (const home of jdkCandidateHomes(custom)) {
    if (!isJdkHome(home)) continue;
    const version = readJdkReleaseVersion(home) || (await probeRuntime(path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'), ['-version'])).version;
    const source =
      customHome && home === customHome ? 'custom'
        : javaHome && home === javaHome ? 'JAVA_HOME'
          : onPathHome && home === onPathHome ? 'PATH'
            : 'scan';
    found.push({ home, javaExe: path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'), version, major: javaMajorOf(version), source });
  }

  // Newest first; an unknown version is the least attractive candidate.
  found.sort((a, b) => (b.major ?? -1) - (a.major ?? -1));
  const usable = minMajor > 0 ? found.filter((j) => j.major === null || j.major >= minMajor) : found;
  // An explicitly configured folder beats a newer one found by the scan. The
  // setting exists to pin a project to a specific kit (a JDK 8 codebase sitting
  // next to a fresh JDK 27 install), and quietly answering with a different JDK
  // than the one the user named is not this app's choice to make. The path was
  // still validated above, so a bad override can never win.
  const result = usable.find((j) => j.source === 'custom') || usable[0] || null;
  jdkCache.set(key, result);
  return result;
}

/** Forget cached JDK discovery (settings changed, install completed, tests). */
export function invalidateJdkDiscovery(): void {
  jdkCache.clear();
}

// ---------------------------------------------------------------------------
// C++ compiler discovery (a compiler is a toolchain, not a command name)
// ---------------------------------------------------------------------------
/**
 * What `g++` on PATH cannot answer on its own:
 *  - *which* toolchain it actually is (MinGW g++ and LLVM clang++ take the same
 *    flags but are different installs), and which version, so `-std=c++17` can
 *    be proposed against something we measured instead of guessed;
 *  - **which folder holds the runtime DLLs**. A program built by MinGW imports
 *    `libstdc++-6.dll` / `libgcc_s_dw2-1.dll` from the compiler's own `bin`, so
 *    an executable that compiled perfectly fails to start when that folder is
 *    not on the child PATH. `binDir` is what the run step prepends;
 *  - whether the tool is even reachable through the inherited PATH at all — an
 *    app started from a shortcut may be holding an older environment snapshot,
 *    which is why the registry PATH and the vendor default install folders are
 *    searched too.
 *
 * The default install folders below are the public vendor prefixes (MinGW.org
 * installs to `C:\MinGW`, WinLibs to `C:\mingw64`, MSYS2 to `C:\msys64\…`,
 * Chocolatey to `C:\tools\mingw64`, LLVM to `%ProgramFiles%\LLVM`), the same way
 * the JDK lookup uses `C:\Program Files\Java`. No user- or machine-specific path
 * is encoded, and every candidate is validated by running it before anything is
 * claimed.
 */
export type CppCompiler = {
  /** Absolute path of the compiler executable that was run and read. */
  exe: string;
  /** Its folder — also where the runtime DLLs a built program needs live. */
  binDir: string;
  /** Bare command name (`g++`, `clang++`, `c++`). */
  cmd: string;
  family: 'gcc' | 'clang' | 'msvc' | 'unknown';
  /** The first `--version` line, verbatim, for the UI to show. */
  version: string | null;
  major: number | null;
  minor: number | null;
  /** 'custom' | 'PATH' | 'registry PATH' | 'scan'. */
  source: string;
};

export type CppDiscovery = {
  compiler: CppCompiler | null;
  /**
   * Compilers that were found but cannot be used here, each with the reason the
   * UI shows. This is how `cl.exe` is reported honestly: it needs the Visual
   * Studio developer environment (`INCLUDE`/`LIB`), which the runner does not
   * pass to child processes, so it is never silently used.
   */
  rejected: { exe: string; reason: string }[];
};

/** Command names tried for C++, in order (g++ first — it is the common one). */
export const CPP_COMMANDS = ['g++', 'clang++', 'c++'] as const;

/**
 * `g++.exe (MinGW.org GCC-6.3.0-1) 6.3.0` / `clang version 17.0.6 (…)` /
 * `Microsoft (R) C/C++ Optimizing Compiler Version 19.29.30133 for x64`.
 * Unparseable output keeps the family `unknown` and the raw line as the version
 * — reporting a version that was not in the output would be invented.
 */
export function parseCppVersionLine(line: string | null): {
  family: CppCompiler['family'];
  version: string | null;
  major: number | null;
  minor: number | null;
} {
  const text = String(line || '').trim();
  if (!text) return { family: 'unknown', version: null, major: null, minor: null };
  const asNumber = (v: string | undefined) => (v === undefined ? null : Number(v));

  let m = text.match(/\bclang version\s+(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  if (m) return { family: 'clang', version: m.slice(1, 4).filter(Boolean).join('.'), major: asNumber(m[1]), minor: asNumber(m[2]) };

  m = text.match(/C\/C\+\+ Optimizing Compiler Version\s+(\d+)\.(\d+)/i);
  if (m) return { family: 'msvc', version: `${m[1]}.${m[2]}`, major: asNumber(m[1]), minor: asNumber(m[2]) };

  // GCC prints the release *after* the closing bracket of its description:
  // `g++ (Ubuntu 9.4.0-1ubuntu1~20.04.2) 9.4.0` — the tail is the real version.
  m = text.match(/\)\s*(\d+)\.(\d+)(?:\.(\d+))?/) || text.match(/\b(\d+)\.(\d+)(?:\.(\d+))?\b/);
  if (m) {
    const family: CppCompiler['family'] = /\bGCC\b|g\+\+|\bGNU\b/i.test(text) ? 'gcc' : 'unknown';
    return { family, version: m.slice(1, 4).filter(Boolean).join('.'), major: asNumber(m[1]), minor: asNumber(m[2]) };
  }
  return { family: 'unknown', version: text, major: null, minor: null };
}

/** Vendor default folders holding a compiler executable (Windows). */
export function cppKnownBinDirs(): string[] {
  if (!IS_WIN) return ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/lib/ccache'];
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pd = process.env.ProgramData || 'C:\\ProgramData';
  const local = process.env.LOCALAPPDATA || '';
  const user = process.env.USERPROFILE || '';
  return [
    'C:\\MinGW\\bin', // MinGW.org default prefix
    'C:\\mingw64\\bin',
    'C:\\mingw32\\bin',
    'C:\\TDM-GCC-64\\bin',
    'C:\\msys64\\mingw64\\bin',
    'C:\\msys64\\ucrt64\\bin',
    'C:\\msys64\\clang64\\bin',
    'C:\\msys64\\mingw32\\bin',
    'C:\\tools\\mingw64\\bin',
    'C:\\Strawberry\\c\\bin',
    path.join(pf, 'LLVM', 'bin'),
    path.join(pf86, 'LLVM', 'bin'),
    path.join(pd, 'chocolatey\\bin'),
    local && path.join(local, 'Programs\\mingw64\\bin'),
    local && path.join(local, 'Programs\\LLVM\\bin'),
    user && path.join(user, 'scoop\\shims'),
    user && path.join(user, 'AppData\\Local\\Microsoft\\WinGet\\Links'),
  ].filter(Boolean) as string[];
}

/** Where a located executable came from, for an honest `source` label. */
function cppCandidateSource(exe: string): string {
  const dir = path.dirname(exe).toLowerCase();
  if (mergePathDirs(process.env.PATH).some((d) => d.toLowerCase() === dir)) return 'PATH';
  if (registryDirs.some((d) => d.toLowerCase() === dir)) return 'registry PATH';
  return 'scan';
}

/**
 * Absolute compiler executables to probe, in priority order: the configured
 * path first (a folder, its `bin`, or the launcher itself), then PATH (inherited
 * + registry), then the vendor default folders. `cl.exe` is included only when
 * something located it, and is always reported rather than used (see above).
 */
export function cppCandidateExes(customPath?: string | null): { exe: string; cmd: string; source: string }[] {
  const out: { exe: string; cmd: string; source: string }[] = [];
  const seen = new Set<string>();
  const push = (exe: string | null, cmd: string, source: string) => {
    if (!exe) return;
    let abs: string;
    try {
      abs = path.resolve(exe);
    } catch {
      return;
    }
    const key = IS_WIN ? abs.toLowerCase() : abs;
    if (seen.has(key)) return;
    if (!isFile(abs)) return;
    seen.add(key);
    out.push({ exe: abs, cmd, source });
  };

  const cmdOf = (base: string) => base.replace(/\.exe$/i, '').toLowerCase();

  if (customPath) {
    const raw = String(customPath).replace(/["']/g, '').trim();
    if (raw) {
      if (/\.(exe|com|bat|cmd)$/i.test(raw)) push(raw, cmdOf(path.basename(raw)), 'custom');
      else {
        const bins = [raw, path.join(raw, 'bin')];
        for (const dir of bins) {
          for (const cmd of [...CPP_COMMANDS, 'cl']) push(path.join(dir, executableName(cmd)), cmd, 'custom');
        }
      }
    }
  }

  for (const cmd of [...CPP_COMMANDS, 'cl']) {
    const located = locateOnPath(cmd);
    if (located) push(located, cmd, cppCandidateSource(located));
  }

  for (const dir of cppKnownBinDirs()) {
    for (const cmd of [...CPP_COMMANDS, 'cl']) push(path.join(dir, executableName(cmd)), cmd, 'scan');
  }
  return out;
}

const cppCache = new Map<string, CppDiscovery>();

/**
 * Locate a C++ compiler that can actually be run. Every candidate is spawned
 * with `--version` (an existing file is not the same as a usable toolchain), and
 * the first one that answers wins — an explicitly configured path wins over a
 * newer scanned install, exactly as the JDK finder does.
 */
export async function discoverCpp(
  opts: { customPath?: string | null; force?: boolean } = {},
): Promise<CppDiscovery> {
  const custom = typeof opts.customPath === 'string' && opts.customPath ? opts.customPath : null;
  const key = custom || '';
  if (!opts.force && cppCache.has(key)) return cppCache.get(key)!;
  // The PATH must be current before anything is located, and this caller may be
  // a run (not the UI poll), so the recovery is asked for here as well.
  await refreshPathFromRegistry(Boolean(opts.force));

  const rejected: CppDiscovery['rejected'] = [];
  let compiler: CppCompiler | null = null;
  for (const cand of cppCandidateExes(custom)) {
    // `cl.exe` is a different flag dialect *and* needs the MSVC environment;
    // the runner passes an allow-listed environment without INCLUDE/LIB, so
    // using it here would be a run that fails for reasons we cannot see.
    if (cand.cmd === 'cl') {
      rejected.push({
        exe: cand.exe,
        reason: 'cl.exe only compiles inside a Visual Studio developer environment (INCLUDE/LIB), which this runner does not pass to child processes — use g++/clang++ instead',
      });
      continue;
    }
    const res = await probeRuntime(cand.exe, ['--version']);
    if (!res.ok) {
      rejected.push({ exe: cand.exe, reason: 'it is installed but `--version` did not run, so this install looks broken' });
      continue;
    }
    const info = parseCppVersionLine(res.version);
    compiler = {
      exe: cand.exe,
      binDir: path.dirname(cand.exe),
      cmd: cand.cmd,
      family: info.family,
      version: info.version && info.version !== String(res.version).trim() ? `${info.version} — ${res.version}` : (res.version || info.version),
      major: info.major,
      minor: info.minor,
      source: cand.source,
    };
    break;
  }
  const result: CppDiscovery = { compiler, rejected };
  cppCache.set(key, result);
  return result;
}

/** The compiler this machine can build with, or null. */
export async function findCppCompiler(opts: { customPath?: string | null; force?: boolean } = {}): Promise<CppCompiler | null> {
  return (await discoverCpp(opts)).compiler;
}

/** Forget cached C++ discovery (settings changed, install completed, tests). */
export function invalidateCppDiscovery(): void {
  cppCache.clear();
}

// ---------------------------------------------------------------------------
// TypeScript discovery (a compiler that must be *run through Node*, not a shim)
// ---------------------------------------------------------------------------
/**
 * TypeScript runs on Node, so the app never spawns a `tsc` shell shim for a
 * real build (an argv-only child cannot start a `.cmd`). Instead it locates the
 * compiler's JavaScript entry (`typescript/bin/tsc`), runs it with `node` and
 * runs the compiled `.js` the same way. A project's own `node_modules/typescript`
 * wins over a global install, and both are validated by running them.
 */
export type TypeScriptCompiler = {
  /** Absolute path of the `tsc` JavaScript entry to run under Node. */
  tscJs: string;
  /** The `typescript` package folder (its `package.json` carries the version). */
  packageRoot: string;
  /** Node executable used to run the compiler (and later the emitted program). */
  nodeExe: string;
  /** `tsc --version` line, verbatim. */
  version: string | null;
  /** 'custom' | 'project' (node_modules under the workspace) | 'global'. */
  source: string;
};

/**
 * Walk up from `startDir` to `stopDir` (inclusive) looking for
 * `node_modules/typescript`. Returns the package root, or null. Bounded so a
 * stray path cannot walk the entire drive.
 */
export function findTypescriptPackage(startDir: string, stopDir: string | null): string | null {
  let dir = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : null;
  for (let up = 0; up < 24; up++) {
    const pkg = path.join(dir, 'node_modules', 'typescript');
    if (isDirectory(path.join(pkg, 'bin')) || isDirectory(path.join(pkg, 'lib'))) return pkg;
    if (stop && dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * The JavaScript entry of a `typescript` package that `node` can run directly:
 * `bin/tsc` (no extension) → `bin/tsc.js` → `lib/tsc.js`, first one that exists.
 */
export function typescriptTscEntry(packageRoot: string): string | null {
  const candidates = [
    path.join(packageRoot, 'bin', 'tsc'),
    path.join(packageRoot, 'bin', 'tsc.js'),
    path.join(packageRoot, 'lib', 'tsc.js'),
  ];
  return candidates.find((c) => isFile(c)) || null;
}

/** The `node` executable to run a compiler with, or null if Node is absent. */
function locateNode(): string | null {
  return locateOnPath('node');
}

const tsCache = new Map<string, { compiler: TypeScriptCompiler | null; rejected: { where: string; reason: string }[] }>();

/**
 * Locate a TypeScript compiler the app can actually run. Priority mirrors the
 * C++ finder: an explicitly configured path first, then a `node_modules/typescript`
 * inside the opened project, then the global npm install a PATH `tsc` belongs to.
 * Every candidate is validated by running `node <tsc> --version`, so "found"
 * always means "can compile".
 */
export async function discoverTypeScript(
  opts: { customPath?: string | null; entryDir?: string | null; workspaceRoot?: string | null; force?: boolean } = {},
): Promise<{ compiler: TypeScriptCompiler | null; rejected: { where: string; reason: string }[] }> {
  const custom = typeof opts.customPath === 'string' && opts.customPath ? opts.customPath : null;
  const entryDir = opts.entryDir || null;
  const wsRoot = opts.workspaceRoot || null;
  const key = `${custom || ''}|${entryDir || ''}|${wsRoot || ''}`;
  if (!opts.force && tsCache.has(key)) return tsCache.get(key)!;
  await refreshPathFromRegistry(Boolean(opts.force));

  const rejected: { where: string; reason: string }[] = [];
  let compiler: TypeScriptCompiler | null = null;
  let nodeExe: string | null = null; // resolved lazily; Node is required for every candidate

  const tryPackage = async (packageRoot: string, source: string): Promise<boolean> => {
    const tscJs = typescriptTscEntry(packageRoot);
    if (!tscJs) {
      rejected.push({ where: packageRoot, reason: 'no bin/tsc or lib/tsc.js entry in the typescript package' });
      return false;
    }
    if (!nodeExe) nodeExe = locateNode();
    if (!nodeExe) {
      rejected.push({ where: packageRoot, reason: 'Node.js is not installed, so the TypeScript compiler cannot be run' });
      return false;
    }
    const res = await probeRuntime(nodeExe, [tscJs, '--version']);
    if (!res.ok) {
      rejected.push({ where: tscJs, reason: 'it is installed but `node tsc --version` did not run, so this install looks broken' });
      return false;
    }
    compiler = { tscJs, packageRoot, nodeExe, version: res.version, source };
    return true;
  };

  // 1. An explicitly configured path: a package folder, its bin, or tsc.js.
  if (custom) {
    const raw = String(custom).replace(/["']/g, '').trim();
    if (raw) {
      let pkgRoot: string | null = null;
      if (isFile(raw)) pkgRoot = path.dirname(path.dirname(raw)); // .../typescript/bin/tsc.js → typescript
      else if (isDirectory(raw)) pkgRoot = path.basename(raw) === 'typescript' ? raw : path.join(raw, 'typescript');
      if (pkgRoot && isDirectory(pkgRoot)) {
        if (await tryPackage(pkgRoot, 'custom')) {
          const result = { compiler, rejected };
          tsCache.set(key, result);
          return result;
        }
      } else {
        rejected.push({ where: raw, reason: 'the configured TypeScript path does not look like a typescript package' });
      }
    }
  }

  // 2. A `node_modules/typescript` at or above the project (the common case).
  if (!compiler) {
    const from = entryDir || (wsRoot ? path.resolve(wsRoot) : null);
    if (from) {
      const pkg = findTypescriptPackage(from, wsRoot ? path.resolve(wsRoot) : null);
      if (pkg && (await tryPackage(pkg, 'project'))) {
        const result = { compiler, rejected };
        tsCache.set(key, result);
        return result;
      }
    }
  }

  // 3. A global install that a PATH `tsc` belongs to: resolve the shim's folder
  //    and look for the package next to it (`<bin>/node_modules/typescript`) or
  //    one level up (`<bin>/../lib/node_modules/typescript`).
  if (!compiler) {
    const shim = locateOnPath('tsc');
    if (shim) {
      const binDir = path.dirname(shim);
      const guesses = [
        path.join(binDir, 'node_modules', 'typescript'),
        path.join(binDir, '..', 'lib', 'node_modules', 'typescript'),
        path.join(binDir, '..', 'node_modules', 'typescript'),
      ];
      for (const g of guesses) {
        if (isDirectory(g) && (await tryPackage(g, 'global'))) break;
      }
      if (!compiler) rejected.push({ where: shim, reason: 'a tsc command was found but its typescript package could not be located next to it' });
    }
  }

  const result = { compiler, rejected };
  tsCache.set(key, result);
  return result;
}

/** Forget cached TypeScript discovery (settings changed, install completed, tests). */
export function invalidateTypeScriptDiscovery(): void {
  tsCache.clear();
}

// ---------------------------------------------------------------------------
// Generic tool discovery (language servers etc.)
// ---------------------------------------------------------------------------
export type ToolDiscovery = {
  cmd: string;
  /** True when the tool was located AND its version probe exited 0 with output. */
  found: boolean;
  /** Absolute path when something was located on PATH (or via custom path). */
  path: string | null;
  /** First version line the tool printed, when usable. */
  version: string | null;
  /** The located file exists but did not run — broken/incompatible install. */
  locatedButUnusable: boolean;
};

const toolCache = new Map<string, ToolDiscovery>();

/**
 * Locate and sanity-run one external tool (a language-server binary etc.).
 * A user-configured absolute path wins over PATH; results are cached per
 * `(cmd, customPath)` until invalidated, so UI polls never re-spawn. Spaces
 * and Unicode in paths are handled by the PATH search + direct spawn — no
 * shell is involved in the lookup itself.
 */
export async function discoverTool(
  cmd: string,
  opts: { versionArgs?: string[]; customPath?: string | null; force?: boolean } = {},
): Promise<ToolDiscovery> {
  const custom = typeof opts.customPath === 'string' && opts.customPath ? opts.customPath : null;
  const key = `${cmd}|${custom || ''}`;
  if (!opts.force && toolCache.has(key)) return toolCache.get(key)!;
  const args = opts.versionArgs || ['--version'];
  let result: ToolDiscovery;
  if (custom) {
    // Absolute paths are probed directly; PATH is consulted only as fallback
    // so a stale configured path cannot mask a working installed tool.
    const located = locateOnPath(custom);
    if (located) {
      const res = await probeRuntime(custom, args);
      result = { cmd, found: res.ok, path: located, version: res.version, locatedButUnusable: !res.ok };
    } else {
      result = await discoverTool(cmd, { ...opts, customPath: null, force: opts.force });
    }
  } else {
    const located = locateOnPath(cmd);
    if (!located) {
      result = { cmd, found: false, path: null, version: null, locatedButUnusable: false };
    } else {
      const res = await probeRuntime(cmd, args);
      result = { cmd, found: res.ok, path: located, version: res.version, locatedButUnusable: !res.ok };
    }
  }
  toolCache.set(key, result);
  return result;
}

/** Forget cached tool discovery (settings changed, install completed, tests). */
export function invalidateToolDiscovery(): void {
  toolCache.clear();
  jdkCache.clear();
  cppCache.clear();
  tsCache.clear();
  registryDirs = [];
  registryChecked = false;
}
