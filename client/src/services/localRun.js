/**
 * Renderer access to desktop-local execution.
 *
 * The window never spawns anything: it asks the Electron main process (through
 * the narrow `window.stackamit.run` bridge) to start a run, and the main process
 * streams real stdout/stderr/exit events back. Outside the desktop app there is
 * no bridge, so every call reports honestly that this is desktop-only rather
 * than pretending a network run is the same thing.
 *
 * Event plumbing detail: `start()` returns the events emitted before the session
 * id was known (`replay`), and only then do we attach the live handler. That
 * ordering is what guarantees a short-lived program's output is never lost.
 */

const bridge = () => (typeof window !== 'undefined' ? window.stackamit?.run : undefined) || null;
const javaDepsBridge = () => (typeof window !== 'undefined' ? window.stackamit?.javaDeps : undefined) || null;

/**
 * True only in the desktop app when the main process exposes the Maven Central
 * resolver. Web Mode has no bridge here — the UI must not pretend it can.
 */
export function isDesktopJavaDeps() {
  return Boolean(javaDepsBridge()?.resolve);
}

/** True when this renderer can execute programs locally through Electron. */
export function isDesktopLocalRun() {
  return Boolean(bridge());
}

const NO_BRIDGE = {
  ok: false,
  code: 'NO_DESKTOP_BRIDGE',
  message: 'Local execution is only available in the desktop app (the browser build has no access to your runtimes).',
};

/** sessionId -> handler for runs that are still streaming. */
const handlers = new Map();
// Subscription is tracked per bridge object, not as a global "once": a window
// reload or a test harness hands over a new bridge, and events must route again.
let subscribedBridge = null;
let subscriptionBroken = false;

function ensureSubscription() {
  const b = bridge();
  if (!b || subscribedBridge === b || subscriptionBroken) return;
  try {
    b.onEvent((payload) => {
      const handler = handlers.get(payload?.sessionId);
      if (handler) handler(payload);
    });
    subscribedBridge = b;
  } catch {
    // Older preload without the run bridge: report unavailable, never throw.
    subscriptionBroken = true;
    subscribedBridge = null;
  }
}

/** Which runtimes the desktop app found on this machine (path + version). */
export async function detectDesktopRuntimes(force = false, jdkPath = null, compilerPath = null, tsCompilerPath = null, workspaceRoot = null) {
  const b = bridge();
  if (!b) return NO_BRIDGE;
  try {
    return await b.detect(force, jdkPath, compilerPath, tsCompilerPath, workspaceRoot);
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: `Could not query local runtimes: ${err?.message || err}` };
  }
}

/**
 * Start a local run. `onEvent` receives
 * `{ sessionId, type: 'stdout'|'stderr'|'info'|'error'|'exit', ... }`.
 *
 * `projectPath` / `workspaceRoot` are the file this run stands for and the
 * folder the user opened: a multi-file C++ project can only be built when the
 * main process is told where the program lives. They are advisory — the main
 * process ignores any path outside the opened workspace.
 */
export async function startLocalRun({ language, sourceCode, filePath, jdkPath, compilerPath, projectPath, workspaceRoot, classpath }, onEvent) {
  const b = bridge();
  if (!b) return NO_BRIDGE;
  ensureSubscription();
  if (subscriptionBroken) return NO_BRIDGE;

  let res;
  try {
    const payload = {
      language,
      sourceCode,
      filePath: filePath || null,
      jdkPath: jdkPath || null,
      compilerPath: compilerPath || null,
      projectPath: projectPath || null,
      workspaceRoot: workspaceRoot || null,
    };
    // Additive: a dependency-free (or non-Java) run sends exactly the payload it
    // always did. Only a resolved, non-empty classpath is attached.
    if (Array.isArray(classpath) && classpath.length) payload.classpath = classpath;
    res = await b.start(payload);
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: `Local run request failed: ${err?.message || err}` };
  }
  if (!res?.ok) {
    return res || { ok: false, code: 'IPC_FAILED', message: 'Local run could not be started.' };
  }

  let sawExit = false;
  const deliver = (event) => {
    if (event?.type === 'exit') sawExit = true;
    try {
      onEvent(event);
    } catch {
      /* a broken sink must not kill the stream */
    }
  };
  handlers.set(res.sessionId, (event) => {
    deliver(event);
    if (event.type === 'exit') handlers.delete(res.sessionId);
  });
  for (const event of res.replay || []) {
    deliver({ ...event, sessionId: res.sessionId });
    if (event.type === 'exit') handlers.delete(res.sessionId);
  }

  return { ...res, finished: sawExit };
}

/** Send a line to the running program's stdin. */
export async function sendLocalRunStdin(sessionId, data) {
  const b = bridge();
  if (!b) return NO_BRIDGE;
  if (!sessionId) return { ok: false, code: 'NO_SESSION', message: 'No local run is connected.' };
  try {
    return await b.stdin(sessionId, data);
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: `Could not write stdin: ${err?.message || err}` };
  }
}

/**
 * Ask the main process to build (but not run) the exact command line a managed
 * run would use, so "Run in Terminal" types the identical plan into a real
 * shell. Only a saved file qualifies (a shell runs the real file, not a buffer).
 * Returns the same { ok } envelope as the other bridge calls; there is no second
 * build system here — it reuses the planners behind startLocalRun.
 */
export async function buildTerminalCommand({ language, filePath, jdkPath, compilerPath, projectPath, workspaceRoot, classpath }) {
  const b = bridge();
  if (!b?.terminalCommand) return NO_BRIDGE;
  try {
    const payload = {
      language,
      filePath: filePath || null,
      jdkPath: jdkPath || null,
      compilerPath: compilerPath || null,
      projectPath: projectPath || null,
      workspaceRoot: workspaceRoot || null,
    };
    if (Array.isArray(classpath) && classpath.length) payload.classpath = classpath;
    return await b.terminalCommand(payload);
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: `Could not prepare the terminal command: ${err?.message || err}` };
  }
}

/** Ask the main process to terminate a running program. */
export async function stopLocalRun(sessionId) {
  const b = bridge();
  if (!b) return NO_BRIDGE;
  if (!sessionId) return { ok: false, code: 'NO_SESSION', message: 'No local run is connected.' };
  try {
    return await b.stop(sessionId);
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: `Could not stop the run: ${err?.message || err}` };
  }
}

/** Forget pending handlers (test / hot-reload hygiene). */
export function resetLocalRunHandlers() {
  handlers.clear();
}

/**
 * Resolve a set of Maven coordinates into absolute classpath JARs (Desktop
 * Mode). Offline reuses the local `~/.m2` cache without any network. Returns a
 * structured envelope; there is no bridge in the browser, so it says so.
 */
export async function resolveJavaDeps({ coordinates, offline = false, requestId = '' }) {
  const b = javaDepsBridge();
  if (!b?.resolve) return { ok: false, code: 'NO_DESKTOP_BRIDGE', message: 'Java dependency resolution is only available in the desktop app.', classpath: [], resolved: [], missing: [], conflicts: [], errors: [] };
  try {
    return await b.resolve({ coordinates, offline, requestId });
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: `Dependency resolution request failed: ${err?.message || err}`, classpath: [], resolved: [], missing: [], conflicts: [], errors: [{ coordinate: '', message: String(err?.message || err) }] };
  }
}

/** Where the local Maven repository lives, and whether it exists (Desktop). */
export async function javaDepsStatus() {
  const b = javaDepsBridge();
  if (!b?.status) return { ok: false, code: 'NO_DESKTOP_BRIDGE' };
  try {
    return await b.status();
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: String(err?.message || err) };
  }
}

/** Remove only the given coordinates from the local cache (never a whole wipe). */
export async function clearJavaDepsCache(coordinates = []) {
  const b = javaDepsBridge();
  if (!b?.clearCache) return { ok: false, code: 'NO_DESKTOP_BRIDGE' };
  try {
    return await b.clearCache(coordinates);
  } catch (err) {
    return { ok: false, code: 'IPC_FAILED', message: String(err?.message || err) };
  }
}

/** Subscribe to main-process resolution progress; returns an unsubscribe fn. */
export function onJavaDepsProgress(cb) {
  const b = javaDepsBridge();
  if (!b?.onProgress) return () => {};
  try {
    return b.onProgress((payload) => cb(payload));
  } catch {
    return () => {};
  }
}
