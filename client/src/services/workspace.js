/**
 * Workspace / storage abstraction.
 *
 * The IDE UI talks only to this interface, so the same editor, explorer, tabs,
 * palette and status bar work in two modes:
 *
 *  - Desktop (Electron): real files on disk via the narrow, validated `window.stackamit`
 *    IPC bridge. Every method returns a structured { ok } envelope; nothing throws.
 *  - Web (browser): a localStorage-backed *virtual* filesystem (so tabs, create,
 *    rename and delete all genuinely work) plus File System Access / download
 *    helpers for moving real files in and out. It never touches Electron APIs.
 *
 * Path style is native on desktop and POSIX-like ('/') on web; callers treat
 * paths as opaque strings.
 */
import { baseName } from '../utils/langForFile.js';

export function getBridge() {
  return typeof window !== 'undefined' && window.stackamit && window.stackamit.isDesktop ? window.stackamit : null;
}

export function isDesktopMode() {
  return Boolean(getBridge());
}

const err = (code, message) => ({ ok: false, code, message });
const EACCES = () => err('FORBIDDEN', 'This action is not available in browser mode.');

// ---------------------------------------------------------------------------
// Web virtual filesystem (persisted to localStorage)
// ---------------------------------------------------------------------------
const VFS_KEY = 'stackamit:vfs';

function posixJoin(dir, name) {
  if (dir === '/' || dir === '') return `/${name}`;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}
function posixDirname(p) {
  const idx = p.lastIndexOf('/');
  if (idx <= 0) return '/';
  return p.slice(0, idx);
}

function seedVfs() {
  return {
    dirs: ['/'],
    files: {
      '/README.md':
        '# StackAmit-IDE\n\nWelcome to the browser workspace. Files you create here are stored locally.\n\n- New File / New Folder in the Explorer\n- Ctrl+P to quick-open, F1 for the command palette\n- Use **Open folder…** to load files from your computer (where supported)\n',
    },
  };
}

function loadVfs() {
  try {
    const raw = window.localStorage.getItem(VFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.dirs && parsed.files) return parsed;
    }
  } catch {
    /* ignore */
  }
  return seedVfs();
}

function saveVfs(state) {
  try {
    window.localStorage.setItem(VFS_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Quota exceeded: the caller must not claim the content was kept.
    return false;
  }
}

function createWebProvider() {
  let state = loadVfs();

  const flush = () => saveVfs(state);

  const listChildren = (dir) => {
    const entries = [];
    for (const d of state.dirs) {
      if (posixDirname(d) === dir && d !== dir) {
        entries.push({ name: baseName(d), path: d, isDirectory: true, isFile: false });
      }
    }
    for (const f of Object.keys(state.files)) {
      if (posixDirname(f) === dir) {
        entries.push({ name: baseName(f), path: f, isDirectory: false, isFile: true });
      }
    }
    entries.sort((a, b) =>
      a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1,
    );
    return entries;
  };

  return {
    mode: 'web',
    supportsTerminal: false,

    async openWorkspace() {
      // Browser "workspace" is the virtual root; loading a real folder is handled
      // separately by importFromDirectory().
      return { ok: true, root: '/' };
    },

    async readDirectory(dir) {
      return { ok: true, entries: listChildren(dir || '/') };
    },

    async readFile(path) {
      if (!(path in state.files)) return err('NOT_FOUND', 'File not found in this browser workspace.');
      return { ok: true, content: state.files[path], path };
    },

    async writeFile(path, content) {
      const prev = state.files[path];
      const existed = path in state.files;
      state.files[path] = content;
      const persisted = flush();
      if (!persisted) {
        // localStorage refused the whole tree (quota or teardown). Roll the
        // in-memory file back to its prior value so a later read never reports
        // content that was never durably saved, and tell the caller the truth:
        // a browser-workspace write that cannot persist is a failure, not a save.
        if (existed) state.files[path] = prev;
        else delete state.files[path];
        return err('QUOTA', 'Browser storage is full or unavailable — the change could not be saved.');
      }
      return { ok: true, path };
    },

    async createFile(parentPath, name) {
      const path = posixJoin(parentPath || '/', name);
      if (path in state.files) return err('EXISTS', 'A file with that name already exists.');
      state.files[path] = '';
      flush();
      return { ok: true, path };
    },

    async createDirectory(parentPath, name) {
      const path = posixJoin(parentPath || '/', name);
      if (state.dirs.includes(path)) return err('EXISTS', 'A folder with that name already exists.');
      state.dirs.push(path);
      flush();
      return { ok: true, path };
    },

    async rename(oldPath, newName) {
      const newPath = posixJoin(posixDirname(oldPath), newName);
      if (newPath === oldPath) return { ok: true, path: newPath };
      const isDir = state.dirs.includes(oldPath);
      if (isDir) {
        if (state.dirs.includes(newPath)) return err('EXISTS', 'An item with that name already exists.');
        // Move the directory and everything under it.
        state.dirs = state.dirs.map((d) => (d === oldPath ? newPath : d.startsWith(oldPath + '/') ? newPath + d.slice(oldPath.length) : d));
        const moved = {};
        for (const f of Object.keys(state.files)) {
          if (f === oldPath || f.startsWith(oldPath + '/')) moved[newPath + f.slice(oldPath.length)] = state.files[f];
          else moved[f] = state.files[f];
        }
        state.files = moved;
      } else {
        if (!(oldPath in state.files)) return err('NOT_FOUND', 'Item no longer exists.');
        if (newPath in state.files) return err('EXISTS', 'An item with that name already exists.');
        const moved = {};
        for (const f of Object.keys(state.files)) {
          if (f === oldPath) moved[newPath] = state.files[f];
          else moved[f] = state.files[f];
        }
        state.files = moved;
      }
      flush();
      return { ok: true, path: newPath };
    },

    async remove(path, recursive) {
      const isDir = state.dirs.includes(path);
      if (isDir) {
        const children = listChildren(path);
        if (children.length && !recursive) return err('NOT_EMPTY', 'Folder is not empty. Confirm a recursive delete to remove it.');
        state.dirs = state.dirs.filter((d) => d !== path && !d.startsWith(path + '/'));
        for (const f of Object.keys(state.files)) if (f.startsWith(path + '/')) delete state.files[f];
      } else {
        if (!(path in state.files)) return err('NOT_FOUND', 'Item no longer exists.');
        delete state.files[path];
      }
      flush();
      return { ok: true, path };
    },

    async saveAs(path, content) {
      // Prefer a real "Save As" to disk via File System Access when available.
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const ext = '.' + (baseName(path).split('.').pop() || 'txt');
          const handle = await window.showSaveFilePicker({ suggestedName: baseName(path), types: [{ description: 'Source file', accept: { 'text/plain': [ext] } }] });
          const w = await handle.createWritable();
          await w.write(content);
          await w.close();
          return { ok: true, path: handle.name || baseName(path) };
        } catch (e) {
          if (e && e.name === 'AbortError') return err('CANCELED', 'Canceled.');
          // fall through to virtual write
        }
      }
      return this.writeFile(path, content);
    },

    /**
     * How much the browser workspace holds right now, so a destructive action
     * (an import that replaces the whole tree) can ask first instead of lying.
     */
    describeContent() {
      return { ok: true, files: Object.keys(state.files).length };
    },

    /**
     * Import every file from a user-picked directory (if the browser supports it).
     *
     * Two root-cause fixes: the walk now builds a *separate* state and is only
     * installed once it has finished, so a folder that fails halfway no longer
     * leaves the workspace wiped to an empty tree; and `replace` must be true
     * when the current browser workspace holds files (the caller asks the user).
     */
    async importFromDirectory({ replace = false } = {}) {
      if (typeof window.showDirectoryPicker !== 'function') return EACCES();
      let dirHandle;
      try {
        dirHandle = await window.showDirectoryPicker();
      } catch (e) {
        if (e && e.name === 'AbortError') return err('CANCELED', 'Canceled.');
        return err('IMPORT_FAILED', 'Could not open that folder.');
      }
      const rootName = dirHandle.name || 'imported';
      if (!replace && Object.keys(state.files).length) {
        return err(
          'REPLACE_CONFIRM',
          'Opening a folder replaces the whole browser workspace, including files you have created here.',
        );
      }
      // localStorage holds roughly 5 MB per origin, so an unbounded folder (a
      // node_modules, a build output) would import and then silently not persist.
      const MAX_FILE_BYTES = 512 * 1024;
      const MAX_TOTAL_BYTES = 3 * 1024 * 1024;
      const next = seedEmptyImport(rootName);
      const skipped = [];
      let total = 0;
      try {
        const walk = async (handle, prefix) => {
          for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
              const file = await entry.getFile();
              const at = posixJoin(prefix, entry.name);
              if (file.size > MAX_FILE_BYTES || total + file.size > MAX_TOTAL_BYTES) {
                skipped.push(at);
                continue;
              }
              const text = await file.text();
              next.files[at] = text;
              total += text.length;
            } else if (entry.kind === 'directory') {
              const child = posixJoin(prefix, entry.name);
              next.dirs.push(child);
              await walk(entry, child);
            }
          }
        };
        await walk(dirHandle, `/${rootName}`);
      } catch {
        return err('IMPORT_FAILED', 'Could not read that folder. The current workspace was left unchanged.');
      }
      state = next;
      const persisted = flush();
      return {
        ok: true,
        root: `/${rootName}`,
        skipped,
        persisted,
        message: persisted
          ? undefined
          : 'The imported folder is open for this session, but it is too large to store in the browser, so it will not survive a reload.',
      };
    },

    // Terminal is desktop-only.
    terminal: null,
  };
}

function seedEmptyImport(root) {
  return { dirs: [`/${root}`], files: {} };
}

// ---------------------------------------------------------------------------
// Desktop provider (wraps the Electron bridge)
// ---------------------------------------------------------------------------
function createDesktopProvider() {
  const bridge = getBridge();
  return {
    mode: 'desktop',
    supportsTerminal: true,
    bridge,

    openWorkspace: () => bridge.openWorkspace(),
    // Desktop "Open Workspace" loads the folder in a NEW managed window so the
    // current window keeps its workspace. Absent on the web provider.
    openWorkspaceInNewWindow: () => bridge.openWorkspaceNewWindow?.(),
    // A freshly created window asks the main process which folder it was opened
    // for (consume-once). Only the desktop bridge answers; web returns no root.
    getInitialWorkspace: () => bridge.getInitialWorkspace?.(),
    readDirectory: (path) => bridge.readDirectory(path),
    readFile: (path) => bridge.readFile(path),
    writeFile: (path, content) => bridge.writeFile(path, content),
    createFile: (parentPath, name) => bridge.createFile(parentPath, name),
    createDirectory: (parentPath, name) => bridge.createDirectory(parentPath, name),
    rename: (path, newName) => bridge.renamePath(path, newName),
    remove: (path, recursive) => bridge.deletePath(path, Boolean(recursive)),
    saveAs: (path, content) => bridge.saveAs({ defaultPath: path, content }),
    importFromDirectory: async () => bridge.openWorkspace(),
    terminal: bridge.terminal,
  };
}

// A single active provider for the current environment.
export const workspace = isDesktopMode() ? createDesktopProvider() : createWebProvider();

// Re-export for tests / callers that want a fresh instance.
export { createWebProvider, createDesktopProvider };
