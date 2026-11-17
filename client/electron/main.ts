/**
 * StackAmit-IDE Electron main process.
 *
 * - Separate main / preload / renderer, with contextIsolation on, nodeIntegration
 *   off, and a sandboxed renderer that only reaches the OS through the narrow
 *   preload bridge.
 * - Loads the Vite dev server when ELECTRON_START_URL is set, otherwise the
 *   production `dist/index.html` (served over file://).
 * - Applies a restrictive CSP and blocks unexpected navigation / popups.
 */
import { app, BrowserWindow, Menu, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpc, cleanupIpc, type WorkspaceWindowHost } from './ipc.js';
import { refreshProcessPath } from './services/runtimeProbe.js';
import { addAuthorizedRoot } from './services/workspaceFs.js';

// Bundled to CommonJS, so Node's `__dirname` is available and points at
// client/electron/dist.
const here = __dirname;

// Backend origin baked in by scripts/build-electron.mjs (from VITE_API_URL).
// Empty when the build uses relative /api or no server is configured. Guarded
// with `typeof` so it stays safe if the bundle is ever built without the define.
declare const __STACKAMIT_API_ORIGIN__: string | undefined;
const configuredApiOrigin = typeof __STACKAMIT_API_ORIGIN__ === 'string' ? __STACKAMIT_API_ORIGIN__ : '';

const startUrl = process.env.ELECTRON_START_URL || '';
const isDev = Boolean(startUrl);
const distDir = path.join(here, '..', '..', 'dist');
const distIndex = path.join(distDir, 'index.html');

// The renderer's real URL in production is `file:///.../dist/index.html` (and
// HashRouter appends `#/ide`), so we trust any file:// URL that lives inside
// the bundled dist directory. In dev we trust the Vite origin exactly.
const httpOrigin = isDev ? new URL(startUrl).origin : '';

function isTrustedUrl(url: string): boolean {
  if (!url) return false;
  if (isDev) {
    try {
      return new URL(url).origin === httpOrigin;
    } catch {
      return false;
    }
  }
  try {
    const u = new URL(url);
    if (u.protocol !== 'file:') return false;
    const target = fileURLToPath(u);
    const rel = path.relative(distDir, target);
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

// One or more managed windows. `mainWindow` is the first one (kept for the
// activate/reopen behaviour); `windowRoots` maps each live window to the
// workspace folder it owns so a duplicate "Open Workspace" can focus the
// existing window instead of spawning a second copy of the same project.
let mainWindow: BrowserWindow | null = null;
const windowRoots = new WeakMap<BrowserWindow, string>();
// Consume-once handoff: a freshly created window asks (via IPC) which workspace
// it was opened for. The root is stored against its webContents id here and
// cleared the first time the renderer reads it, so a reload of a window that
// already loaded its workspace never re-applies a stale handoff.
const pendingWorkspace = new Map<number, string>();

/** Case-insensitive on Windows, so `C:\Foo` and `c:\foo` count as the same root. */
function rootKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Create a managed window. When `initialRoot` is supplied the folder is
 * authorized and handed to that window's renderer through the consume-once
 * `pendingWorkspace` map; without it the window opens on the Welcome screen.
 */
function createWindow(initialRoot: string | null = null): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1b1f27',
    title: 'StackAmit-IDE',
    icon: path.join(distDir, 'logo.jpg'),
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (!mainWindow) mainWindow = win;

  // Capture the webContents id while the window is alive. The 'closed' event
  // fires *after* Electron has destroyed the webContents, so reading
  // `win.webContents.id` there throws "Object has been destroyed" and surfaces
  // as a main-process crash dialog on window close.
  const wcId = win.webContents.id;

  if (initialRoot) {
    const root = addAuthorizedRoot(initialRoot);
    pendingWorkspace.set(wcId, root);
    windowRoots.set(win, rootKey(root));
    win.setTitle(`${path.basename(root)} - StackAmit-IDE`);
  }

  win.once('ready-to-show', () => win.show());

  // Deny any navigation away from our origins and all popups.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url)) {
      e.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Open external http(s) links in the OS browser; never in-app.
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void win.loadURL(startUrl);
  } else {
    void win.loadFile(distIndex);
  }

  win.on('closed', () => {
    pendingWorkspace.delete(wcId);
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

/**
 * The window-creation host handed to the IPC layer so a "new workspace" request
 * can open a managed window (and detect an existing one for the same folder)
 * without `ipc.ts` importing `electron`'s BrowserWindow construction directly.
 */
const workspaceHost: WorkspaceWindowHost = {
  openWithWorkspace(root: string): { existed: boolean } {
    const key = rootKey(root);
    for (const win of BrowserWindow.getAllWindows()) {
      if (windowRoots.get(win) === key) {
        if (win.isMinimized()) win.restore();
        win.focus();
        return { existed: true };
      }
    }
    createWindow(root);
    return { existed: false };
  },
  takePendingWorkspace(webContentsId: number): string | null {
    const root = pendingWorkspace.get(webContentsId);
    if (root !== undefined) pendingWorkspace.delete(webContentsId);
    return root ?? null;
  },
};

function cspHeader(): string {
  // When packaged against a non-localhost backend, its origin (and the matching
  // ws(s) for the dev-style proxy) must be allowed here or the renderer's own
  // API calls are blocked. `configuredApiOrigin` is '' unless VITE_API_URL was
  // an http(s) origin at build time, so the default stays localhost-only.
  const apiConnect = configuredApiOrigin
    ? ` ${configuredApiOrigin} ${configuredApiOrigin.replace(/^http/, 'ws')}`
    : '';
  // `ws://127.0.0.1:*` is the language-server bridge: the main process serves
  // LSP over an ephemeral loopback WebSocket (same wildcard already trusted
  // in frame-src). The renderer still has no process or fs access.
  const connect = isDev
    ? `'self' ws://localhost:5173 wss://localhost:5173 http://localhost:5000 ws://localhost:5000 ws://127.0.0.1:* ws://localhost:*${apiConnect}`
    : `'self' http://localhost:5000 ws://localhost:5000 ws://127.0.0.1:* ws://localhost:*${apiConnect}`;
  // Vite's dev server injects an inline React-refresh preamble into index.html;
  // without 'unsafe-inline' the renderer silently never mounts. The relaxed
  // policy applies ONLY to the dev-server origin — packaged production loads
  // keep the strict no-inline script policy.
  // The hash allows index.html's small anti-flash theme script (must match the
  // exact inline source; if it changes, regenerate from the CSP reject log).
  const scripts = isDev
    ? "'self' 'wasm-unsafe-eval' 'unsafe-inline'"
    : "'self' 'wasm-unsafe-eval' 'sha256-X6z385k8MUouZb+onsqKV2JHL++Q2fXcYZs2zBvd+nI='";
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: file:",
    "font-src 'self' data: file:",
    "worker-src 'self' blob: file:",
    // The Live Preview iframe embeds the local preview / dev servers — only
    // loopback origins, never arbitrary remote frames.
    "frame-src 'self' http://127.0.0.1:* http://localhost:*",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

app.whenReady().then(() => {
  // The app renders its own in-window menu bar (TopMenu), so suppress Electron's
  // built-in native menu to avoid a duplicate File/Edit/View/Window/Help bar.
  Menu.setApplicationMenu(null);

  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    // Only harden OUR content (bundled file:// renderer or the dev-server
    // origin). Injecting this CSP into every response also hits the Live
    // Preview server on 127.0.0.1 — its `frame-ancestors 'none'` would then
    // block our own preview iframe.
    const url = details.url;
    const isAppContent = isDev ? url.startsWith(httpOrigin + '/') || url === httpOrigin : url.startsWith('file://');
    if (!isAppContent) {
      cb({});
      return;
    }
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [cspHeader()],
      },
    });
  });

  // A launch from a desktop shortcut hands this process the environment block
  // its launcher was started with, which can predate a toolchain install — the
  // reason the app's terminal says `'g++' is not recognized` while a freshly
  // opened Command Prompt compiles the same file. The registry PATH is recovered
  // and merged additively before any child exists (nothing that already
  // resolves stops resolving). Fire-and-forget: a slow `reg.exe` must never
  // delay the first window.
  void refreshProcessPath(true).catch(() => {});

  registerIpc(() => BrowserWindow.getAllWindows(), isTrustedUrl, workspaceHost, configuredApiOrigin);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => cleanupIpc());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
