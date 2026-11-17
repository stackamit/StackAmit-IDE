/**
 * Local interactive execution.
 *
 * Unlike the batch providers (Wandbox / Piston) which run a program to
 * completion in a single request/response, this service launches the program
 * as a *live child process* on the server and streams stdin/stdout over a
 * WebSocket. That is what lets the terminal "type when input() is called":
 * the program blocks on a real read, the user's line is piped in, and it
 * continues.
 *
 * Security posture:
 *   - Disabled entirely in production unless LOCAL_RUN_ENABLED=true.
 *   - Only same/allow-listed browser origins may connect.
 *   - A hard cap on concurrent sessions and total streamed output.
 *   - Idle sessions (no client activity) are reaped.
 *   - Source is written to a throwaway temp dir that is removed on close.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

import { env, isAllowedOrigin } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getLanguage } from '../config/languages.js';
import { IS_WIN, detectRuntimes, resolveCommand, invalidateRuntimes } from './runtimes.js';
import { getInstallPlan, installRuntime } from './runtimeInstaller.js';
import { executionEnv } from './executionEnv.js';

const WS_PATH = '/api/interactive';

/**
 * Interactive run plan per language key. `sourceName` is the file we write the
 * user's code to; `compile` (optional) must succeed before `run` starts.
 * Both `compile(rt)` and `run(rt)` receive the runtime command chosen by
 * `detectRuntimes()` (e.g. python vs py launcher, g++ vs clang++) — the plans
 * must not re-hardcode a tool name the probe already resolved, or the two
 * tables drift and a run spawns a compiler the availability check never made.
 * The `|| '<name>'` fallbacks mirror exactly what RUNTIME_PROBES lists, so a
 * plan is only reached for a command detection already proved answers.
 */
const PLANS = {
  python: {
    sourceName: 'main.py',
    run: (rt) => ({ cmd: rt.cmd || 'python', args: ['-u', 'main.py'] }),
  },
  javascript: {
    sourceName: 'main.js',
    run: (rt) => ({ cmd: rt.cmd || 'node', args: ['main.js'] }),
  },
  c: {
    sourceName: 'main.c',
    compile: (rt) => ({ cmd: rt?.cmd || 'gcc', args: ['main.c', '-o', IS_WIN ? 'main.exe' : 'main'] }),
    run: () => ({ cmd: IS_WIN ? '.\\main.exe' : './main', args: [] }),
  },
  cpp: {
    sourceName: 'main.cpp',
    compile: (rt) => ({ cmd: rt?.cmd || 'g++', args: ['main.cpp', '-o', IS_WIN ? 'main.exe' : 'main'] }),
    run: () => ({ cmd: IS_WIN ? '.\\main.exe' : './main', args: [] }),
  },
  java: {
    // rt.cmd is the `java` launcher; the compile step deliberately uses
    // `javac` (detectRuntimes() proves both exist before calling Java ready).
    // NOTE: these `Main` values are placeholders only. The submitted source
    // decides the real entry class + file name; createSession() resolves them
    // with buildJavaRunPlan() and overrides compile/run before spawning, so a
    // program whose class is not literally `Main` (or lives in a package) no
    // longer fails with ClassNotFoundException at launch.
    sourceName: 'Main.java',
    compile: () => ({ cmd: 'javac', args: ['Main.java'] }),
    run: (rt) => ({ cmd: rt.cmd || 'java', args: ['Main'] }),
  },
  // --- toolchains added with the expanded language registry (Oct 2026) ---
  // Every command below is a fixed argv array built from allow-listed tool
  // names — never from user input. Languages whose local flow needs a full
  // project scaffold (C# via `dotnet`, SQL via a DB server) intentionally
  // have no interactive plan; remote batch execution covers those.
  go: {
    sourceName: 'main.go',
    run: (rt) => ({ cmd: rt.cmd || 'go', args: ['run', 'main.go'] }),
  },
  rust: {
    sourceName: 'main.rs',
    compile: (rt) => ({ cmd: rt?.cmd || 'rustc', args: ['main.rs', '-o', IS_WIN ? 'main.exe' : 'main'] }),
    run: () => ({ cmd: IS_WIN ? '.\\main.exe' : './main', args: [] }),
  },
  php: {
    sourceName: 'main.php',
    run: (rt) => ({ cmd: rt.cmd || 'php', args: ['main.php'] }),
  },
  ruby: {
    sourceName: 'main.rb',
    run: (rt) => ({ cmd: rt.cmd || 'ruby', args: ['main.rb'] }),
  },
  kotlin: {
    sourceName: 'Main.kt',
    compile: (rt) => ({ cmd: rt?.cmd || 'kotlinc', args: ['Main.kt', '-include-runtime', '-d', 'main.jar'] }),
    run: () => ({ cmd: 'java', args: ['-jar', 'main.jar'] }),
  },
  perl: {
    sourceName: 'main.pl',
    run: (rt) => ({ cmd: rt.cmd || 'perl', args: ['main.pl'] }),
  },
  lua: {
    sourceName: 'main.lua',
    run: (rt) => ({ cmd: rt.cmd || 'lua', args: ['main.lua'] }),
  },
  julia: {
    sourceName: 'main.jl',
    run: (rt) => ({ cmd: rt.cmd || 'julia', args: ['main.jl'] }),
  },
  haskell: {
    sourceName: 'Main.hs',
    run: (rt) => ({ cmd: rt.cmd || 'runghc', args: ['Main.hs'] }),
  },
  pascal: {
    sourceName: 'main.pas',
    compile: (rt) => ({ cmd: rt?.cmd || 'fpc', args: ['main.pas'] }),
    run: () => ({ cmd: IS_WIN ? '.\\main.exe' : './main', args: [] }),
  },
  shell: {
    sourceName: 'main.sh',
    run: (rt) => ({ cmd: rt.cmd || 'bash', args: ['main.sh'] }),
  },
  powershell: {
    sourceName: 'main.ps1',
    // The generated script is unsigned, so the default Windows execution
    // policy (Restricted / AllSigned) refuses it. `-ExecutionPolicy Bypass`
    // relaxes the policy for this one child process only — it never writes to
    // the registry or changes the machine setting.
    run: (rt) => ({
      cmd: rt.cmd || 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'main.ps1'],
    }),
  },
};

/**
 * Languages that can run from a single local file but have no batch-provider
 * entry (so `getLanguage()` knows nothing about them). They are interactive /
 * local-only: nothing here claims remote execution for them.
 */
export const LOCAL_ONLY_LABELS = {
  kotlin: 'Kotlin',
  powershell: 'PowerShell',
};

export { PLANS as INTERACTIVE_PLANS };

// Candidates probed and command resolution now live in ./runtimes.js

/**
 * Remove line/block comments and string/char literals from Java source, so the
 * entry-point scan below never matches `class`, `package`, or `main` text that
 * only appears inside a comment or a quoted string. Literals collapse to empty
 * placeholders; identifiers and structure are left untouched.
 */
function stripJavaNoise(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"') {
      if (src.startsWith('"""', i)) { // text block """ ... """
        i += 3;
        while (i < n && !src.startsWith('"""', i)) i += 1;
        i += 3;
        out += '""';
        continue;
      }
      i += 1;
      while (i < n && src[i] !== '"') { if (src[i] === '\\') i += 1; i += 1; }
      i += 1;
      out += '""';
      continue;
    }
    if (c === "'") {
      i += 1;
      while (i < n && src[i] !== "'") { if (src[i] === '\\') i += 1; i += 1; }
      i += 1;
      out += "'x'";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * Decide which class to launch and what to name the source file, from the
 * program text. The server only ever receives code (never the editor's file
 * name), so it must not assume the entry class is `Main`:
 *   - javac requires the file to be named after its public top-level class,
 *   - `java` must be given the exact (package-qualified) class holding main.
 * Returns { ok, sourceName, fqn, runClass, pkg } or { ok: false, error }.
 * Pure and JVM-free so command construction is deterministically testable.
 */
export function analyzeJavaSource(sourceCode) {
  const src = stripJavaNoise(String(sourceCode ?? ''));

  const pkgMatch = src.match(/\bpackage\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/);
  const pkg = pkgMatch ? pkgMatch[1] : null;

  const classDecls = [];
  const cre = /\bclass\s+([A-Za-z_$][\w$]*)/g;
  let cm;
  while ((cm = cre.exec(src)) !== null) classDecls.push({ name: cm[1], index: cm.index });

  // A `public` top-level class also dictates the required file name.
  const publicMatch = src.match(/\bpublic\s+(?:(?:final|abstract|sealed|non-sealed|strictfp)\s+)*class\s+([A-Za-z_$][\w$]*)/);
  const publicClass = publicMatch ? publicMatch[1] : null;

  // Which class owns a `main(String[])` entry point (accepts String[]/String...
  // and an optional final modifier)? Map each to its nearest preceding class.
  const mre = /\bvoid\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\s*\]|\.\.\.)\s*[A-Za-z_$][\w$]*\s*\)/g;
  const mainOwners = new Set();
  let dm;
  while ((dm = mre.exec(src)) !== null) {
    let owner = null;
    for (const c of classDecls) { if (c.index < dm.index) owner = c.name; else break; }
    if (owner) mainOwners.add(owner);
  }

  if (mainOwners.size > 1) {
    return { ok: false, error: `Multiple classes declare a main(String[]) entry point (${[...mainOwners].join(', ')}). The runner cannot pick one — keep a single main class.` };
  }

  const runClass = [...mainOwners][0] || null;
  if (!runClass) {
    if (publicClass || classDecls.length) {
      return { ok: false, error: 'No `public static void main(String[] args)` entry point was found in the submitted Java source.' };
    }
    return { ok: false, error: 'No Java class with a main(String[]) method was found in the submitted source.' };
  }

  // Name the file after the public class when present (javac filename rule),
  // otherwise after the entry class.
  const sourceName = `${publicClass || runClass}.java`;
  const fqn = pkg ? `${pkg}.${runClass}` : runClass;
  return { ok: true, sourceName, fqn, runClass, pkg };
}

/**
 * Build the concrete compile/run argv for a Java session. Mirrors PLANS.java's
 * tool choices (`javac`, the detected `java` launcher) but points the compiler
 * output (`-d .`) and the runtime classpath (`-cp .`) at the session's temp dir
 * and launches the fully-qualified entry class, so compile output and runtime
 * lookup always agree. Returns { ok, sourceName, compile, run, fqn } or
 * { ok: false, error, stage }.
 */
export function buildJavaRunPlan(rt, sourceCode) {
  const a = analyzeJavaSource(sourceCode);
  if (!a.ok) return { ok: false, error: a.error, stage: 'entry' };
  return {
    ok: true,
    sourceName: a.sourceName,
    fqn: a.fqn,
    runClass: a.runClass,
    compile: { cmd: 'javac', args: ['-d', '.', a.sourceName] },
    run: { cmd: (rt && rt.cmd) || 'java', args: ['-cp', '.', a.fqn] },
  };
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* socket closing */
    }
  }
}

/**
 * Handle one interactive session on a connected socket.
 * Returns a dispose() that tears down the child process and temp dir.
 */
function createSession(ws, languageKey, sourceCode) {
  const plan = PLANS[languageKey];
  const lang = getLanguage(languageKey);
  const label = lang?.label || LOCAL_ONLY_LABELS[languageKey] || languageKey;
  let child = null;
  let compileChild = null;
  let tempDir = null;
  let disposed = false;
  let stdoutCap = env.maxOutputBytes;
  let sequence = 0;
  const emit = (payload) => send(ws, { ...payload, sequence: ++sequence });

  const stream = (kind, data) => {
    if (disposed || stdoutCap <= 0) return;
    const text = String(data);
    if (text.length > stdoutCap) {
      emit({ type: kind, data: text.slice(0, stdoutCap) });
      emit({ type: 'info', data: '\n… output truncated (limit reached).' });
      stdoutCap = 0;
      return;
    }
    stdoutCap -= text.length;
    emit({ type: kind, data: text });
  };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    if (compileChild && compileChild.exitCode === null && compileChild.signalCode === null) {
      try { compileChild.kill('SIGKILL'); } catch { /* ignore */ }
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
    if (tempDir) {
      rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  };

  const start = async () => {
    if (disposed) return;
    if (!plan) {
      emit({ type: 'error', data: `Language "${languageKey}" cannot run interactively.` });
      emit({ type: 'exit', code: null });
      return;
    }
    const runtimes = await detectRuntimes();
    if (disposed) return;
    const rt = runtimes[languageKey];
    if (!rt || !rt.available) {
      emit({ type: 'error', data: `No local ${label} runtime was found on the server. Install it, or switch back to Batch mode.` });
      emit({ type: 'exit', code: null });
      return;
    }

    // Java's entry class and file name are decided by the source, not the
    // `Main` placeholder in PLANS.java: the server receives only code, so the
    // class holding main() (and any package) must drive both `javac` output and
    // the `java` launch. Resolving it here is what prevents a compiled-but-
    // unlaunchable class (ClassNotFoundException). Other languages keep their
    // static plan.
    let javaPlan = null;
    if (languageKey === 'java') {
      javaPlan = buildJavaRunPlan(rt, sourceCode);
      if (!javaPlan.ok) {
        emit({ type: 'error', data: javaPlan.error });
        emit({ type: 'exit', code: 1, stage: javaPlan.stage });
        return;
      }
    }
    const sourceName = javaPlan ? javaPlan.sourceName : plan.sourceName;

    try {
      tempDir = await mkdtemp(path.join(tmpdir(), 'stackamit-run-'));
      await writeFile(path.join(tempDir, sourceName), sourceCode, 'utf8');
    } catch (err) {
      emit({ type: 'error', data: `Could not prepare workspace: ${err.message}` });
      emit({ type: 'exit', code: null });
      cleanup();
      return;
    }

    // Optional compile step (C/C++/Java/Rust/Kotlin/Pascal) — with the same
    // detected command the availability check proved, not a re-resolved name.
    if (plan.compile) {
      const c = javaPlan ? javaPlan.compile : plan.compile(rt);
      const compiled = await new Promise((resolve) => {
        let proc;
        try {
          proc = spawn(resolveCommand(c.cmd), c.args, { cwd: tempDir, windowsHide: true, env: executionEnv(process.env, { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
          compileChild = proc;
        } catch (err) {
          emit({ type: 'error', data: `Compiler not available: ${err.message}` });
          return resolve(false);
        }
        proc.stdout.on('data', (d) => stream('compile', d));
        proc.stderr.on('data', (d) => stream('compile', d));
        proc.on('error', (err) => {
          emit({ type: 'error', data: `Compiler error: ${err.message}` });
          resolve(false);
        });
        proc.on('close', (code) => resolve(code === 0));
      });
      compileChild = null;
      if (disposed) return;
      if (!compiled) {
        emit({ type: 'exit', code: 1, stage: 'compile' });
        cleanup();
        return;
      }
      // A successful javac run proves the source was valid, but the class the
      // runner is about to launch must actually exist as an artifact. Confirm it
      // before spawning the JVM: if it is missing, say exactly which class was
      // expected and where, instead of letting `java` throw a bare
      // ClassNotFoundException that looks like a runtime crash.
      if (javaPlan) {
        const expectedClass = path.join(tempDir, ...javaPlan.fqn.split('.')) + '.class';
        if (!existsSync(expectedClass)) {
          emit({
            type: 'error',
            data: `Compilation finished but the entry class "${javaPlan.fqn}" was not produced (expected ${expectedClass}). Make sure the class holding \`public static void main(String[] args)\` matches its package declaration and filename.`,
          });
          emit({ type: 'exit', code: 1, stage: 'entry' });
          cleanup();
          return;
        }
      }
      emit({ type: 'info', data: 'Compiled. Running…\n' });
    }

    // Launch the program interactively.
    const r = javaPlan ? javaPlan.run : plan.run(rt);
    if (disposed) return;
    try {
      child = spawn(resolveCommand(r.cmd), r.args, {
        cwd: tempDir,
        windowsHide: true,
        env: executionEnv(process.env, { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      emit({ type: 'error', data: `Failed to start process: ${err.message}` });
      emit({ type: 'exit', code: null });
      cleanup();
      return;
    }

    child.stdout.on('data', (d) => stream('stdout', d));
    child.stderr.on('data', (d) => stream('stderr', d));
    child.on('error', (err) => {
      emit({ type: 'error', data: `Process error: ${err.message}` });
    });
    child.on('close', (code) => {
      emit({ type: 'exit', code });
      cleanup();
    });
    emit({ type: 'started' });
  };

  start();

  return {
    writeStdin(data) {
      if (child && child.stdin && child.stdin.writable) {
        try {
          child.stdin.write(data);
          emit({ type: 'stdin', data });
        } catch {
          // The process may have exited between the writable check and write.
        }
      }
    },
    kill() {
      if (child && child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
      emit({ type: 'exit', code: null, stopped: true });
      cleanup();
    },
    dispose: cleanup,
  };
}

/** Origin allow-list for WebSocket upgrades — the same set the HTTP CORS
 *  policy uses (config/env.js), so the two can never drift apart. */
function originAllowed(origin) {
  return isAllowedOrigin(origin); // no-Origin stays allowed (curl/tests)
}

let activeSessions = 0;

export function getInteractiveActiveSessionCount() {
  return activeSessions;
}

export function attachInteractiveServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req, socket, head) => {
    const url = req.url || '';
    const [pathname] = url.split('?');
    if (pathname !== WS_PATH) return; // not ours — let other handlers/upgrade pass

    if (!env.localRunEnabled) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!originAllowed(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (activeSessions >= env.maxConcurrentExecutions) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };

  httpServer.on('upgrade', onUpgrade);

  wss.on('connection', (ws) => {
    activeSessions += 1;
    let session = null;
    let idleTimer = null;

    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        send(ws, { type: 'info', data: 'Session idle — closing.' });
        session?.kill();
        ws.close();
      }, env.interactiveIdleTimeoutMs);
    };
    bumpIdle();

    ws.on('message', async (raw) => {
      bumpIdle();
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'start') {
        if (session) session.dispose();
        const code = typeof msg.sourceCode === 'string' ? msg.sourceCode.slice(0, env.maxSourceBytes) : '';
        if (!code.trim()) {
          send(ws, { type: 'error', data: 'Source code is empty.' });
          send(ws, { type: 'exit', code: null });
          return;
        }
        session = createSession(ws, String(msg.language || ''), code);
      } else if (msg.type === 'stdin') {
        session?.writeStdin(typeof msg.data === 'string' ? msg.data.slice(0, env.maxStdinBytes) : '');
      } else if (msg.type === 'stop') {
        session?.kill();
      } else if (msg.type === 'install') {
        // Consent-driven runtime install (the popup is the permission gate).
        if (session) { session.dispose(); session = null; }
        const language = String(msg.language || '');
        send(ws, { type: 'install-progress', data: `Preparing to install ${language} runtime…\n` });
        const emit = (line) => {
          bumpIdle(); // keep the socket alive during a long install
          send(ws, { type: 'install-progress', data: line });
        };
        try {
          const result = await installRuntime(language, emit);
          invalidateRuntimes();
          const runtimes = await detectRuntimes(true);
          send(ws, { type: 'install-done', ...result, runtime: runtimes[language] || null });
        } catch (err) {
          send(ws, { type: 'install-done', success: false, language, message: err.message || 'Install failed.' });
        }
      }
    });

    let tornDown = false;
    const teardown = () => {
      if (tornDown) return;
      tornDown = true;
      if (idleTimer) clearTimeout(idleTimer);
      session?.dispose();
      activeSessions = Math.max(0, activeSessions - 1);
    };
    ws.on('close', teardown);
    ws.on('error', teardown);
  });

  logger.info({ msg: `Interactive local-run WebSocket ready at ${WS_PATH} (enabled=${env.localRunEnabled})` });

  return () => {
    httpServer.off('upgrade', onUpgrade);
    wss.close();
  };
}
