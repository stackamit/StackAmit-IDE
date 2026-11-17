/**
 * Central editor/workspace state, shared by the explorer, tabs, Monaco host,
 * status bar, command palette and AI panel. Kept in one Zustand store so actions
 * (open / close / save / rename) stay consistent across every surface.
 */
import { create } from 'zustand';
import { baseName, isUntitled, monacoLanguageFor } from '../utils/langForFile.js';
import { DEFAULT_THEME_ID, THEMES, PACK_THEMES } from '../monaco/themes.js';
import { extensionById, resolveExtensionState } from '../extensions/registry.js';
import { workspace, isDesktopMode } from '../services/workspace.js';
import { readPrefs, clampAutoSaveDelay } from '../hooks/useEditorPrefs.js';

// The bottom panel opens on the tab that actually works in this mode. In the
// browser there is no terminal to show, so starting the IDE with that panel
// visible would present an unavailable feature as the default surface.
const DEFAULT_BOTTOM_PANEL = isDesktopMode()
  ? { open: true, tab: 'terminal' }
  : { open: false, tab: 'output' };

const THEME_KEY = 'stackamit:ide-theme';
const storedTheme = (() => {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    if (v && [...THEMES, ...PACK_THEMES].some((t) => t.id === v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_THEME_ID;
})();

const EXT_KEY = 'stackamit:extensions';

let executionSequence = 0;

/** Generate a renderer-local identifier without depending on output length. */
export function createExecutionId() {
  executionSequence += 1;
  try {
    if (globalThis.crypto?.randomUUID) return `exec-${globalThis.crypto.randomUUID()}`;
  } catch {
    /* Older Electron/browser runtimes can lack randomUUID. */
  }
  return `exec-${Date.now().toString(36)}-${executionSequence.toString(36)}`;
}
function loadExtensions() {
  let stored = null;
  try {
    const raw = window.localStorage.getItem(EXT_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  // Built-in extensions (file-icons) ship installed & enabled, so a fresh or
  // offline-desktop profile still shows real file/folder icons; anything the
  // user has actually chosen is stored verbatim and wins over the default.
  return resolveExtensionState(stored); // id -> { installed, enabled }
}
function persistExtensions(extensions) {
  try {
    window.localStorage.setItem(EXT_KEY, JSON.stringify(extensions));
  } catch {
    /* ignore */
  }
}

// User-configured absolute paths for language-server tools (used before
// PATH when starting a bridge — for tools that are installed but not on PATH).
const LSP_TOOL_PATHS_KEY = 'stackamit:lsp-tool-paths';
function loadLspToolPaths() {
  try {
    const raw = window.localStorage.getItem(LSP_TOOL_PATHS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {}; // languageId -> absolute path
}

// Same idea for the JDK a Java language server must run on: JAVA_HOME and PATH
// are searched first, this is the explicit override when they are wrong/absent.
const LSP_JDK_PATHS_KEY = 'stackamit:lsp-jdk-paths';
function loadLspJdkPaths() {
  try {
    const raw = window.localStorage.getItem(LSP_JDK_PATHS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {}; // languageId -> absolute JDK folder/launcher path
}

// The build tool an offline desktop run compiles with (C++ → g++/clang++).
// Deliberately separate from the language-server tool path: `clangd` powers
// IntelliSense while `g++` builds and runs the program, and on most machines
// they are not the same installation — conflating them would break one of the
// two when the user configures the other.
const COMPILER_PATHS_KEY = 'stackamit:compiler-paths';
function loadCompilerPaths() {
  try {
    const raw = window.localStorage.getItem(COMPILER_PATHS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {}; // languageId -> absolute compiler executable or its bin folder
}

// Where a program runs: the managed Output panel, or a real integrated terminal
// typed with the identical command. A user choice, so it persists across restarts.
const RUN_MODE_KEY = 'stackamit:run-mode';
function loadRunMode() {
  try {
    const v = window.localStorage.getItem(RUN_MODE_KEY);
    if (v === 'output' || v === 'terminal') return v;
  } catch {
    /* ignore */
  }
  return 'output';
}

let untitledSeq = 0;
const nextUntitledPath = () => {
  untitledSeq += 1;
  return `untitled:Untitled-${untitledSeq}`;
};

// ---------------------------------------------------------------------------
// Auto Save machinery (module scope, not React state).
//
// Timers and in-flight flags live here so the persistence layer never re-uses a
// stale closure and so a write already running can absorb a newer edit instead
// of racing it. The store's per-doc `saveState` is what the UI renders; these
// maps are the private scheduling that mutates it. Kept out of the store object
// so nothing can read them as reactive state and so they survive re-renders.
// ---------------------------------------------------------------------------
const autoSaveTimers = new Map(); // path -> timeout id (debounce pending)
const savingPaths = new Set(); // path with a write currently in flight
const requestedSaves = new Set(); // path that must be written once a write settles
let saveWaiters = []; // { path, resolve } callers awaiting the in-flight drain

// A Java build descriptor changed on disk must reach the language server, or the
// project model stays stale. This lives behind a lazy import so the store never
// pulls the whole Monaco/LSP client into contexts that only need editor state.
function maybeNotifyLspOfSave(savedPath) {
  if (!/[/\\](pom\.xml|build\.gradle(\.kts)?)$/i.test(String(savedPath))) return;
  import('../monaco/lspClient.js')
    .then((m) => m.notifyLspFilesChanged?.(savedPath))
    .catch(() => {
      /* IntelliSense re-sync is best-effort; the file is already saved */
    });
}

// Derived view of a document's save status. The stored `saveState` only ever
// holds 'saving' | 'saved' | 'failed'; 'modified' is derived from content so a
// newer edit can never be misrepresented as saved while an older write settles.
export function saveStateFor(doc) {
  if (!doc) return 'saved';
  if (doc.saveState === 'saving') return 'saving';
  if (doc.saveState === 'failed') return 'failed';
  if (doc.content !== doc.savedContent) return 'modified';
  return 'saved';
}

export const useIdeStore = create((set, get) => ({
  // ---- workspace ----
  root: null,
  rootName: null,
  treeRevision: 0,
  selectedPath: null,
  // What the workspace declares it is (Web Mode): { kind, framework, moduleType,
  // scripts, devServerScript, ... } from utils/projectModel.js. null = not read
  // yet, or a desktop workspace where the real toolchain answers instead.
  project: null,
  setProject: (project) => set({ project }),

  // One text question at a time, answered by <PromptModal/>. Electron throws on
  // window.prompt, so the IDE owns its own input dialog (see ui/PromptModal.jsx).
  prompt: null, // { title, defaultValue, okLabel, resolve }
  requestPrompt: ({ title, defaultValue = '', okLabel = 'OK' }) =>
    new Promise((resolve) => set({ prompt: { title, defaultValue, okLabel, resolve } })),
  answerPrompt: (value) => {
    const pending = get().prompt;
    if (!pending) return;
    set({ prompt: null });
    pending.resolve(value);
  },

  // ---- documents (open tabs) ----
  docs: {}, // path -> { path, name, language, content, savedContent, untitled, viewState }
  order: [], // tab order (paths)
  activePath: null,

  // ---- layout / panels ----
  activityView: 'explorer', // explorer | search | scm | debug | extensions | settings
  sidebarVisible: true,
  rightPanelVisible: false,
  bottomPanel: DEFAULT_BOTTOM_PANEL, // tab: terminal | problems | output | debug
  sidebarWidth: 260,
  rightPanelWidth: 340,
  bottomHeight: 240,

  // ---- run mode (persisted) ----
  // 'output' = the managed execution service; 'terminal' = a real integrated
  // terminal running the same command. Applied by the Run action.
  runMode: loadRunMode(),
  setRunMode: (runMode) => {
    const mode = runMode === 'terminal' ? 'terminal' : 'output';
    try {
      window.localStorage.setItem(RUN_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
    set({ runMode: mode });
  },
  // A one-shot request for TerminalPanel to open a session (optionally running a
  // command). `nonce` makes every request distinct so repeat runs always fire.
  terminalLaunch: null, // { cwd, extraPathDirs, command, nonce }
  requestTerminalLaunch: (req) =>
    set((s) => ({
      terminalLaunch: {
        cwd: req?.cwd ?? undefined,
        extraPathDirs: Array.isArray(req?.extraPathDirs) ? req.extraPathDirs : [],
        command: typeof req?.command === 'string' ? req.command : null,
        executionId: typeof req?.executionId === 'string' ? req.executionId : null,
        nonce: (s.terminalLaunch?.nonce || 0) + 1,
      },
    })),
  clearTerminalLaunch: () => set({ terminalLaunch: null }),

  // ---- diagnostics & output ----
  problems: {}, // path -> markers[]
  output: [], // { id, executionId?, sourcePath?, text, kind, timestamp }
  activeExecution: null, // { id, sourcePath, name, mode?, startedAt, active }
  runState: 'idle', // idle | running — drives the Output view's loading/Stop state
  // The run in flight, so Stop / stdin can be routed to the right place:
  // { mode: 'local' | 'remote' | 'browser' | 'interactive', sessionId, language, name }
  runHandle: null,
  setRunHandle: (runHandle) => set({ runHandle: runHandle || null }),
  // Web Mode local-interactive capability, read once from the server's
  // /api/interactive/status: { enabled, runtimes: { key: { available, cmd } } }.
  // null = not fetched yet (or an older server), which means batch-only. The Run
  // action consults it to decide interactive-vs-batch per language, and the
  // Output panel uses it to avoid offering a pre-run stdin box for a language it
  // is about to run live. Never claims interactive the server has not confirmed.
  interactiveStatus: null,
  setInteractiveStatus: (interactiveStatus) =>
    set({ interactiveStatus: interactiveStatus || null }),
  // Batch stdin staged for the next run (Web Mode remote/batch providers and the
  // browser JS runner both consume it before execution). Kept in the store so it
  // survives tab switches and is bound to the run it is sent with.
  runStdin: '',
  setRunStdin: (runStdin) => set({ runStdin: String(runStdin ?? '') }),
  // A live input request from the sandboxed browser JS runner, surfaced in the
  // Output panel and answered only when the user submits or cancels. Correlated
  // by the run `token` + `promptId` so an answer from another run is rejected.
  // { token, promptId, kind: 'prompt'|'confirm'|'alert', message, resolve }
  runPrompt: null,
  requestRunPrompt: ({ token, promptId, kind = 'prompt', message = '' }) =>
    new Promise((resolve) => {
      // A new prompt supersedes any unanswered one: resolve the stale request as
      // EOF (null) rather than letting a program wait on an input it never sees.
      const pending = get().runPrompt;
      if (pending) pending.resolve(null);
      set({ runPrompt: { token, promptId, kind, message, resolve } });
    }),
  // Resolve the displayed prompt. Returns false — leaving it pending — when the
  // answering session does not match the run/prompt still on screen, so stale or
  // misrouted input can never leak into a different execution.
  answerRunPrompt: (value, { token, promptId } = {}) => {
    const pending = get().runPrompt;
    if (!pending) return false;
    if (token != null && pending.token !== token) return false;
    if (promptId != null && pending.promptId !== promptId) return false;
    set({ runPrompt: null });
    pending.resolve(value);
    return true;
  },
  // EOF / cancel: resolve the pending prompt with null without touching output.
  cancelRunPrompt: () => {
    const pending = get().runPrompt;
    if (!pending) return;
    set({ runPrompt: null });
    pending.resolve(null);
  },
  // Runtimes the desktop app discovered locally (null = not checked / web build).
  localRuntimes: null,
  setLocalRuntimes: (localRuntimes) => set({ localRuntimes }),
  // User-configured build tools for offline runs that compile first (cpp → g++).
  // Empty by default: finding the compiler on this machine is the normal answer.
  compilerPaths: loadCompilerPaths(),
  setCompilerPath: (languageId, compilerPath) =>
    set((s) => {
      const compilerPaths = { ...s.compilerPaths, [languageId]: compilerPath || null };
      try {
        window.localStorage.setItem(COMPILER_PATHS_KEY, JSON.stringify(compilerPaths));
      } catch {
        /* ignore */
      }
      // The stored path is what the next detection query reads; nothing here
      // trusts it until the main process has located and run the tool.
      return { compilerPaths };
    }),

  // ---- language servers (desktop IntelliSense bridges) ----
  // `${monacoLanguageId}|${workspaceRoot}` -> 'idle' | 'starting' | 'ready'
  // | 'missing-tool' | 'error'. Only the registry's wired languages ever get
  // an entry; everything else stays plain 'basic' editing.
  lsp: {},
  setLspState: (languageId, root, state) =>
    set((s) => ({ lsp: { ...s.lsp, [`${languageId}|${root || ''}`]: state } })),
  lspToolPaths: loadLspToolPaths(),
  lspJdkPaths: loadLspJdkPaths(),
  // Bumped whenever a configured path changes: the editor re-attaches with a
  // forced re-probe and the stale bridge (old tool/JDK) is stopped first.
  lspProbeRevision: 0,
  setLspToolPath: (languageId, toolPath) =>
    set((s) => {
      const lspToolPaths = { ...s.lspToolPaths, [languageId]: toolPath || null };
      try {
        window.localStorage.setItem(LSP_TOOL_PATHS_KEY, JSON.stringify(lspToolPaths));
      } catch {
        /* ignore */
      }
      return { lspToolPaths, lspProbeRevision: s.lspProbeRevision + 1 };
    }),
  setLspJdkPath: (languageId, jdkPath) =>
    set((s) => {
      const lspJdkPaths = { ...s.lspJdkPaths, [languageId]: jdkPath || null };
      try {
        window.localStorage.setItem(LSP_JDK_PATHS_KEY, JSON.stringify(lspJdkPaths));
      } catch {
        /* ignore */
      }
      return { lspJdkPaths, lspProbeRevision: s.lspProbeRevision + 1 };
    }),

  // ---- live preview (desktop: real 127.0.0.1 server; web: in-browser render) ----
  preview: {
    visible: false,
    mode: 'static', // static | dev (dev = package.json script server, desktop only)
    state: 'stopped', // stopped | starting | running | error
    url: null, // static server URL (desktop)
    devUrl: null, // dev server URL discovered on its stdout (desktop)
    devState: 'stopped', // stopped | starting | running | exited
    port: 0, // 0 = let the OS pick
    error: null,
    scripts: [], // package.json script names (desktop)
    script: null, // selected dev script
    entry: null, // web-mode entry html (defaults to index.html under root)
    epoch: 0, // bump to reload the iframe after saves
  },
  previewWidth: 480,
  setPreview: (patch) => set((s) => ({ preview: { ...s.preview, ...patch } })),
  togglePreviewPanel: () => set((s) => ({ preview: { ...s.preview, visible: !s.preview.visible } })),
  // A save inside the workspace should refresh a visible preview (the static
  // server re-reads from disk, so a plain iframe reload is enough).
  touchPreviewOnSave: (savedPath) => {
    const s = get();
    if (!s.preview.visible || typeof s.root !== 'string') return;
    const r = s.root.replace(/[\\/]+$/, '').toLowerCase();
    const p = String(savedPath).toLowerCase();
    if (p === r || p.startsWith(r + '/') || p.startsWith(r + '\\') || (r === '' && p.startsWith('/'))) {
      set((st) => ({ preview: { ...st.preview, epoch: st.preview.epoch + 1 } }));
    }
  },

  // ---- extensions (persisted install/enable state) ----
  extensions: loadExtensions(),
  extState: (id) => get().extensions[id] || { installed: false, enabled: false },
  installExtension: (id) =>
    set((s) => {
      // Snapshot the catalog version at install time — update checks compare
      // against this, so an "update" is a real version delta, never invented.
      const ext = extensionById(id);
      const extensions = { ...s.extensions, [id]: { installed: true, enabled: true, version: ext?.version || '0.0.0' } };
      persistExtensions(extensions);
      return { extensions };
    }),
  uninstallExtension: (id) =>
    set((s) => {
      const extensions = { ...s.extensions, [id]: { installed: false, enabled: false } };
      persistExtensions(extensions);
      // If a theme-pack theme is active and the pack is being removed, fall back.
      let themeId = s.themeId;
      if (id === 'extra-themes' && PACK_THEMES.some((t) => t.id === s.themeId)) themeId = DEFAULT_THEME_ID;
      return { extensions, themeId };
    }),
  setExtensionEnabled: (id, enabled) =>
    set((s) => {
      const cur = s.extensions[id] || { installed: true, enabled: false };
      const extensions = { ...s.extensions, [id]: { ...cur, installed: true, enabled } };
      persistExtensions(extensions);
      return { extensions };
    }),
  toggleExtension: (id) => {
    const st = get().extensions[id];
    if (!st || !st.installed) get().installExtension(id);
    else get().setExtensionEnabled(id, !st.enabled);
  },

  // ---- theme ----
  themeId: storedTheme,
  setThemeId: (id) => {
    try {
      window.localStorage.setItem(THEME_KEY, id);
    } catch {
      /* ignore */
    }
    set({ themeId: id });
  },
  cycleTheme: () => {
    const cur = get().themeId;
    const i = THEMES.findIndex((t) => t.id === cur);
    get().setThemeId(THEMES[(i + 1) % THEMES.length].id);
  },

  // ---- workspace ----
  setRoot: (root, rootName) => set({ root, rootName: rootName || baseName(root) || 'workspace' }),
  setSelectedPath: (path) => set({ selectedPath: path }),
  bumpTree: () => set((s) => ({ treeRevision: s.treeRevision + 1 })),

  // ---- documents ----
  openDocument: ({ path, content, language }) => {
    const { docs, order } = get();
    if (docs[path]) {
      set({ activePath: path });
      return;
    }
    const doc = {
      path,
      name: baseName(path) || 'Untitled',
      language: language || monacoLanguageFor(path),
      content: content ?? '',
      savedContent: content ?? '',
      untitled: isUntitled(path),
      viewState: null,
      // 'saved' | 'saving' | 'failed'; 'modified' is derived (see saveStateFor).
      saveState: 'saved',
      saveError: null,
    };
    set({ docs: { ...docs, [path]: doc }, order: [...order, path], activePath: path });
  },

  newUntitled: () => {
    const path = nextUntitledPath();
    get().openDocument({ path, content: '', language: 'plaintext' });
    return path;
  },

  setActive: (path) => set({ activePath: path }),

  updateContent: (path, content) =>
    set((s) => {
      const doc = s.docs[path];
      if (!doc || doc.content === content) return {};
      return { docs: { ...s.docs, [path]: { ...doc, content } } };
    }),

  saveDocument: (path, savedContent) =>
    set((s) => {
      const doc = s.docs[path];
      if (!doc) return {};
      // Committing saved content means the persist succeeded: clear any failure
      // and let saveStateFor derive 'modified' if a newer edit already landed.
      return {
        docs: {
          ...s.docs,
          [path]: { ...doc, savedContent: savedContent ?? doc.content, saveState: 'saved', saveError: null },
        },
      };
    }),

  // After Save-As / rename on disk, move the buffer to a new path.
  reassignPath: (oldPath, newPath, name) => {
    // A rename must re-point persistence, not carry a stale target. Any pending
    // debounce on the old path is dropped (its closure captured that path) and
    // rescheduled against the new one after the buffer moves; a coalescing
    // in-flight request is handed over so the write continues on the new path.
    const hadTimer = autoSaveTimers.has(oldPath);
    const oldTimer = autoSaveTimers.get(oldPath);
    if (oldTimer !== undefined) clearTimeout(oldTimer);
    autoSaveTimers.delete(oldPath);
    if (requestedSaves.delete(oldPath)) requestedSaves.add(newPath);
    if (savingPaths.delete(oldPath)) savingPaths.add(newPath);
    for (const w of saveWaiters) if (w.path === oldPath) w.path = newPath;
    set((s) => {
      const doc = s.docs[oldPath];
      if (!doc) return {};
      const moved = {
        ...doc,
        path: newPath,
        name: name || baseName(newPath),
        untitled: isUntitled(newPath),
        saveError: null,
      };
      const docs = { ...s.docs };
      delete docs[oldPath];
      docs[newPath] = moved;
      const order = s.order.map((p) => (p === oldPath ? newPath : p));
      const activePath = s.activePath === oldPath ? newPath : s.activePath;
      return { docs, order, activePath };
    });
    if (hadTimer) get().scheduleAutoSave(newPath);
  },

  closeTab: (path) => {
    // Cancel the debounce timer outright; a doc that is gone must never write.
    const timer = autoSaveTimers.get(path);
    if (timer !== undefined) clearTimeout(timer);
    autoSaveTimers.delete(path);
    requestedSaves.delete(path);
    // An in-flight write can't be aborted, but once the doc is deleted below,
    // _persistOnce's post-write guard sees no doc and drops the result.
    set((s) => {
      const docs = { ...s.docs };
      delete docs[path];
      const order = s.order.filter((p) => p !== path);
      let activePath = s.activePath;
      if (activePath === path) activePath = order.length ? order[order.length - 1] : null;
      return { docs, order, activePath };
    });
  },

  saveViewState: (path, viewState) =>
    set((s) => {
      const doc = s.docs[path];
      if (!doc) return {};
      return { docs: { ...s.docs, [path]: { ...doc, viewState } } };
    }),

  isDirty: (path) => {
    const doc = get().docs[path];
    return Boolean(doc && doc.content !== doc.savedContent);
  },

  /**
   * Any editor buffer that is not on disk yet — unsaved edits *and* untitled
   * files, which in the browser exist nowhere but this tab. Drives the
   * leave-the-page guard and the confirmations before destructive actions.
   */
  hasUnsavedChanges: () =>
    Object.values(get().docs).some((doc) => doc.untitled || doc.content !== doc.savedContent),

  // ---- auto save ----
  // The single persist path shared by manual Save and the debounced Auto Save,
  // so there is exactly one file-writing pipeline in the app (never two).
  //
  // Concurrency: at most one write per path runs at a time. A request made while
  // a write is in flight records `requestedSaves` and awaits the drain, so the
  // latest content always wins without a second overlapping write. Each drain
  // iteration re-reads doc.content, so nothing is ever written from a stale
  // closure. A failed write leaves the doc dirty ('failed') for a retry.
  setSaveState: (path, saveState, saveError = null) =>
    set((s) => {
      const doc = s.docs[path];
      if (!doc) return {};
      if (doc.saveState === saveState && doc.saveError === saveError) return {};
      return { docs: { ...s.docs, [path]: { ...doc, saveState, saveError } } };
    }),

  // Write the current contents of one document through the workspace pipeline.
  // Resolves to the final persistence envelope once every coalesced request for
  // the path has settled — never merely because a save was scheduled.
  saveFile: (path) => {
    const doc = get().docs[path];
    if (!doc || doc.untitled || isUntitled(path)) {
      return Promise.resolve({ ok: false, skipped: true, message: 'Nothing to save.' });
    }
    requestedSaves.add(path);
    // A write is already draining this path: join it rather than start a second.
    if (savingPaths.has(path)) {
      return new Promise((resolve) => {
        saveWaiters.push({ path, resolve });
      });
    }
    return get()._drainSave(path);
  },

  _drainSave: async (path) => {
    savingPaths.add(path);
    let last = { ok: true };
    try {
      // Keep draining while requests arrive; re-read content every pass so the
      // newest editor value is what finally lands on disk.
      while (requestedSaves.delete(path)) {
        const doc = get().docs[path];
        if (!doc) {
          last = { ok: false, closed: true };
          break;
        }
        if (doc.content === doc.savedContent && doc.saveState !== 'failed') {
          // Already up to date: no need to touch storage again.
          get().setSaveState(path, 'saved', null);
          last = { ok: true };
          break;
        }
        last = await get()._persistOnce(path, doc.content);
        // Stop draining on failure — the doc stays dirty/'failed' for a retry,
        // and we never spin re-attempting a write the backend is rejecting.
        if (!last || !last.ok) break;
      }
    } finally {
      savingPaths.delete(path);
      const mine = saveWaiters.filter((w) => w.path === path);
      saveWaiters = saveWaiters.filter((w) => w.path !== path);
      for (const w of mine) w.resolve(last || { ok: true });
    }
    return last || { ok: true };
  },

  _persistOnce: async (path, content) => {
    const doc = get().docs[path];
    if (!doc) return { ok: false, closed: true };
    get().setSaveState(path, 'saving', null);
    let res;
    try {
      res = await workspace.writeFile(path, content);
    } catch (e) {
      res = { ok: false, message: String((e && e.message) || e) };
    }
    // The write may have finished after the doc closed or was renamed away.
    const cur = get().docs[path];
    if (!cur) return { ok: Boolean(res && res.ok), closed: true };
    if (res && res.ok) {
      // Commit exactly the content we wrote; a newer edit stays 'modified'.
      get().saveDocument(path, content);
      get().touchPreviewOnSave(path); // a visible preview re-reads the saved file
      maybeNotifyLspOfSave(path); // a saved pom.xml / build.gradle must reach the LS
      get().setSaveState(path, 'saved', null);
    } else {
      get().setSaveState(path, 'failed', (res && res.message) || 'Could not save the file.');
    }
    return res && res.ok ? { ok: true } : res || { ok: false, message: 'Could not save the file.' };
  },

  // Schedule a debounced save for one document. Reset on every edit so a burst
  // of typing produces a single write after the last keystroke. Untitled and
  // already-clean buffers are skipped; Auto Save off changes nothing for manual
  // Save. Reads settings live, so a toggle applies without a restart.
  scheduleAutoSave: (path) => {
    const prefs = readPrefs();
    if (!prefs.autoSave) return;
    const doc = get().docs[path];
    if (!doc || doc.untitled || isUntitled(path)) return;
    if (doc.content === doc.savedContent && doc.saveState !== 'failed') return;
    const existing = autoSaveTimers.get(path);
    if (existing !== undefined) clearTimeout(existing);
    const delay = clampAutoSaveDelay(prefs.autoSaveDelay);
    const id = setTimeout(() => {
      autoSaveTimers.delete(path);
      get().saveFile(path);
    }, delay);
    autoSaveTimers.set(path, id);
  },

  // Drop a document's pending debounce (used on close and by a manual save so
  // the timer does not fire a redundant write right after an explicit Save).
  cancelAutoSave: (path) => {
    const existing = autoSaveTimers.get(path);
    if (existing !== undefined) clearTimeout(existing);
    autoSaveTimers.delete(path);
    requestedSaves.delete(path);
  },

  // Cancel every pending debounce (called when the user turns Auto Save off).
  cancelAllAutoSaves: () => {
    for (const id of autoSaveTimers.values()) clearTimeout(id);
    autoSaveTimers.clear();
    requestedSaves.clear();
  },

  // Best-effort flush on graceful shutdown: run every debounced save now. Async
  // persistence cannot be guaranteed to finish before the page tears down, so
  // dirty-state safeguards remain; this just gives pending edits the chance.
  flushAllAutoSaves: async () => {
    const paths = [...autoSaveTimers.keys()];
    for (const p of paths) {
      const id = autoSaveTimers.get(p);
      if (id !== undefined) clearTimeout(id);
      autoSaveTimers.delete(p);
    }
    await Promise.all(paths.map((p) => get().saveFile(p)));
    return paths;
  },

  // ---- panels ----
  setActivityView: (view) =>
    set((s) => ({ activityView: view, sidebarVisible: s.sidebarVisible || true })),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleRightPanel: () => set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),
  toggleBottomPanel: () => set((s) => ({ bottomPanel: { ...s.bottomPanel, open: !s.bottomPanel.open } })),
  setBottomTab: (tab) => set((s) => ({ bottomPanel: { open: true, tab } })),
  setPanelSize: (key, px) => set({ [key]: px }),

  // ---- problems / output ----
  setProblems: (path, markers) => set((s) => ({ problems: { ...s.problems, [path]: markers || [] } })),
  beginExecution: ({ sourcePath = null, name = null, mode = null } = {}) => {
    const id = createExecutionId();
    set({
      activeExecution: { id, sourcePath, name, mode, startedAt: Date.now(), active: true },
      runState: 'idle',
      runHandle: null,
    });
    return id;
  },
  getActiveExecution: () => get().activeExecution,
  isExecutionCurrent: (executionId, activeOnly = true) => {
    const execution = get().activeExecution;
    return Boolean(execution && execution.id === executionId && (!activeOnly || execution.active));
  },
  finishExecution: (executionId) =>
    set((s) => {
      if (!executionId || s.activeExecution?.id !== executionId) return s;
      if (s.runPrompt) s.runPrompt.resolve(null);
      return {
        activeExecution: { ...s.activeExecution, active: false, stoppedAt: Date.now() },
        runState: 'idle',
        runHandle: null,
        runPrompt: null,
      };
    }),
  pushOutput: (line = {}) =>
    set((s) => {
      const requestedExecutionId = line.executionId;
      if (requestedExecutionId && (!s.activeExecution || !s.activeExecution.active || s.activeExecution.id !== requestedExecutionId)) {
        return s;
      }
      const executionId = requestedExecutionId || (s.activeExecution?.active ? s.activeExecution.id : undefined);
      if (line.replace && s.output.length) {
        const index = [...s.output].findLastIndex((item) => item.executionId === requestedExecutionId && item.kind === line.kind && item.stream === line.stream);
        if (index >= 0) {
          const last = s.output[index];
          return { output: [...s.output.slice(0, index), { ...last, ...line, id: last.id, timestamp: line.timestamp ?? last.timestamp }, ...s.output.slice(index + 1)] };
        }
      }
      const id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? `out-${crypto.randomUUID()}`
        : `out-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      return {
        output: [...s.output, {
          ...line,
          id,
          executionId,
          sourcePath: line.sourcePath ?? s.activeExecution?.sourcePath ?? undefined,
          timestamp: line.timestamp ?? Date.now(),
        }].slice(-2000),
      };
    }),
  clearOutput: () => set({ output: [] }),
  setRunState: (runState) =>
    set((s) => {
      // Leaving 'running' (finish, Stop, or a fresh run) must never strand a
      // pending prompt: resolve it as EOF so the browser program unwinds instead
      // of hanging, and drop any stale input from the previous execution.
      const clear = s.runPrompt ? { runPrompt: null } : {};
      if (s.runPrompt) s.runPrompt.resolve(null);
      const activeExecution = runState === 'running'
        ? s.activeExecution
        : s.activeExecution?.active
          ? { ...s.activeExecution, active: false, stoppedAt: Date.now() }
          : s.activeExecution;
      return runState === 'running'
        ? { runState, runHandle: null, ...clear }
        : { runState: 'idle', runHandle: null, activeExecution, ...clear };
    }),
}));

export function totalProblemCount(problems) {
  return Object.values(problems).reduce((n, list) => n + (list ? list.length : 0), 0);
}
