/**
 * Live Preview controller.
 *
 * Desktop (Electron): the main process owns the actual servers; this module
 * only calls the validated bridge and mirrors state into the store. It never
 * spawns anything from the renderer.
 *
 * Web (browser): there is genuinely no local server to start — this module
 * builds a self-contained document from the virtual workspace files instead
 * (see utils/webPreview.js) and the UI says exactly that.
 */
import { useIdeStore } from '../store/ideStore.js';
import { workspace, getBridge } from './workspace.js';
import { buildWebPreviewDoc } from '../utils/webPreview.js';
import { previewStrategyFor } from '../utils/projectModel.js';
export { previewEntryUrl } from './previewPath.js';
import { previewEntryUrl } from './previewPath.js';

const store = useIdeStore.getState;
export const isDesktopPreview = () => workspace.mode === 'desktop' && Boolean(getBridge());

let devPollTimer = 0;


// ---------------------------------------------------------------------------
// Desktop — static Go Live
// ---------------------------------------------------------------------------
export async function startStatic(port) {
  const s = store();
  const bridge = getBridge();
  if (!bridge) return;
  if (!s.root) {
    s.setPreview({ state: 'error', error: 'Open a workspace folder first.' });
    return;
  }
  const chosen = port !== undefined ? port : s.preview.port;
  s.setPreview({ mode: 'static', state: 'starting', error: null, visible: true, port: chosen });
  const res = await bridge.preview.start(s.root, chosen);
  if (res.ok) {
    const targetUrl = previewEntryUrl(res.url, s.root, s.activePath);
    store().setPreview({ state: 'running', url: targetUrl, entry: targetUrl });
    // Probe the selected document, not only the workspace root. This supports
    // nested portfolio/index.html files while keeping the server rooted at the
    // authorized workspace directory for relative assets and sibling pages.
    const probe = await bridge.preview.probe(targetUrl);
    if (probe.ok && probe.status >= 400) {
      store().setPreview({ error: `Preview responded ${probe.status} ${probe.statusText} (index.html may be missing).` });
    }
  } else {
    store().setPreview({ state: 'error', error: res.message || 'Could not start the preview server.' });
  }
}

export async function stopStatic() {
  const s = store();
  const bridge = getBridge();
  if (bridge && s.root) await bridge.preview.stop(s.root);
  store().setPreview({ state: 'stopped', url: null, error: null });
}

export async function restartStatic() {
  await stopStatic();
  await startStatic();
}

// ---------------------------------------------------------------------------
// Desktop — package.json dev server (React/Vite projects)
// ---------------------------------------------------------------------------
export async function loadScripts() {
  const s = store();
  const bridge = getBridge();
  if (!bridge || !s.root) return;
  const res = await bridge.dev.scripts(s.root);
  const scripts = res.ok ? res.scripts : [];
  const guess = scripts.find((n) => n === 'dev') || scripts.find((n) => /dev|start|serve/.test(n)) || null;
  store().setPreview({ scripts, script: s.preview.script && scripts.includes(s.preview.script) ? s.preview.script : guess });
}

export async function startDev(script) {
  const s = store();
  const bridge = getBridge();
  if (!bridge) return;
  const chosen = script || s.preview.script;
  if (!chosen) {
    s.setPreview({ mode: 'dev', devState: 'exited', error: 'No npm script selected (package.json has none?).' });
    return;
  }
  s.setPreview({ mode: 'dev', devState: 'starting', script: chosen, error: null, visible: true, devUrl: null });
  const res = await bridge.dev.start(s.root, chosen);
  if (!res.ok) {
    store().setPreview({ devState: 'exited', error: res.message || 'Could not start the dev server.' });
    return;
  }
  pollDev();
}

function pollDev() {
  clearInterval(devPollTimer);
  const bridge = getBridge();
  if (!bridge) return;
  devPollTimer = setInterval(async () => {
    const s = store();
    const res = await bridge.dev.status(s.root);
    if (!res.ok) return clearInterval(devPollTimer);
    if (res.state === 'running' && res.url) {
      clearInterval(devPollTimer);
      store().setPreview({ devState: 'running', devUrl: res.url, error: null });
    } else if (res.state === 'exited') {
      clearInterval(devPollTimer);
      store().setPreview({
        devState: 'exited',
        devUrl: null,
        error: `Dev server exited (code ${res.exitCode}). ${String(res.output || '').split('\n').slice(-3).join(' ')}`,
      });
    }
  }, 700);
}

export async function stopDev() {
  clearInterval(devPollTimer);
  const s = store();
  const bridge = getBridge();
  if (bridge && s.root) await bridge.dev.stop(s.root);
  store().setPreview({ devState: 'stopped', devUrl: null });
}

// ---------------------------------------------------------------------------
// Shared control
// ---------------------------------------------------------------------------
export function reload() {
  store().setPreview({ epoch: store().preview.epoch + 1 });
}

/** Status-bar Go Live: desktop starts the static server; web just opens the honest panel. */
export async function toggleGoLive() {
  const s = store();
  if (isDesktopPreview()) {
    if (s.preview.mode === 'dev' ? s.preview.devState === 'running' : s.preview.state === 'running') {
      await stopEverything();
      return;
    }
    if (s.preview.mode === 'dev') return startDev();
    return startStatic();
  }
  // Web: no server to start — toggle the in-browser preview surface.
  s.togglePreviewPanel();
}

export async function stopEverything() {
  const s = store();
  const bridge = getBridge();
  if (bridge && s.root) {
    try {
      await bridge.dev.stop(s.root);
      await bridge.preview.stop(s.root);
    } catch {
      /* best effort */
    }
  }
  clearInterval(devPollTimer);
  store().setPreview({ state: 'stopped', url: null, devState: 'stopped', devUrl: null, error: null });
}

export async function openExternal(url) {
  const bridge = getBridge();
  if (!bridge || !url) return;
  await bridge.openExternal(url);
}

// ---------------------------------------------------------------------------
// Web — build the in-browser document from the virtual workspace
// ---------------------------------------------------------------------------
async function collectVfs(dir, out, depth) {
  if (depth > 12 || out.size > 400) return;
  const res = await workspace.readDirectory(dir);
  if (!res.ok) return;
  for (const e of res.entries || []) {
    if (e.isDirectory) await collectVfs(e.path, out, depth + 1);
    else if (e.isFile && !out.has(e.path)) out.set(e.path, null);
  }
}

/**
 * Build { doc, unsupported } for the web preview. Files are read from the
 * virtual workspace (saved content). The active editor buffer is layered on
 * top so unsaved edits preview live only after save — consistent with the
 * desktop server, which also serves saved files from disk.
 */
export async function buildWebPreview(entryHint) {
  const s = store();
  const root = s.root || '/';

  // A framework project is not a static page: saying so is the honest answer,
  // where rendering its raw index.html would show a blank frame and look broken.
  const strategy = s.project ? previewStrategyFor(s.project) : { mode: 'static', reason: null };
  if (strategy.mode === 'needs-dev-server') {
    return { ok: false, needsDevServer: true, message: strategy.reason };
  }
  const candidates = [];
  if (entryHint) candidates.push(entryHint);
  if (s.preview.entry) candidates.push(s.preview.entry);
  if (s.activePath && /\.html?$/i.test(s.activePath)) candidates.push(s.activePath);
  candidates.push(`${root}/index.html`.replace(/\/+/g, '/') || '/index.html', '/index.html');

  let entry = null;
  let entryHtml = null;
  for (const c of candidates) {
    const res = await workspace.readFile(c);
    if (res.ok) {
      entry = c;
      entryHtml = res.content;
      break;
    }
  }
  if (!entry) return { ok: false, message: 'No HTML file found in the browser workspace. Create an index.html and save it.' };

  // Load workspace asset files (css/js/images) so relative refs resolve.
  const files = new Map();
  await collectVfs(root === '/' ? '/' : root, files, 0);
  const loaders = [];
  for (const [p, v] of files) {
    if (v === null && /\.(css|js|mjs|cjs|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(p)) {
      loaders.push(
        workspace.readFile(p).then((r) => {
          if (r.ok && typeof r.content === 'string' && r.content.length < 2_000_000) files.set(p, r.content);
        }),
      );
    }
  }
  await Promise.all(loaders);

  const { doc, unsupported, modules } = buildWebPreviewDoc(entryHtml, entry, (abs) => (files.has(abs) ? files.get(abs) : null));
  return { ok: true, doc, unsupported, modules: modules || [], entry };
}
