/**
 * Secure preload bridge (runs with contextIsolation + sandbox).
 *
 * Exposes a narrow, typed `window.stackamit` API. No Node primitives, no
 * `require`, no raw ipcRenderer, and no unrestricted channels leak to the page —
 * only the operations below, each mapping to a validated IPC channel.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './shared/ipc.js';

type Args = Record<string, unknown>;

const invoke = (channel: string, args: Args = {}) => ipcRenderer.invoke(channel, args);

const api = {
  // Presence flag the renderer uses to choose the desktop workspace provider.
  isDesktop: true as const,

  openWorkspace: () => invoke(IPC.WorkspaceOpen),
  // Open a folder in a NEW managed window (leaves this window's workspace as-is).
  openWorkspaceNewWindow: () => invoke(IPC.WindowNewWorkspace),
  // A freshly created window asks which workspace the main process opened it for.
  getInitialWorkspace: () => invoke(IPC.WindowGetInitialWorkspace),
  saveAs: (args: { defaultPath?: string; content?: string }) => invoke(IPC.DialogSaveAs, args),

  readDirectory: (path: string) => invoke(IPC.FsReadDir, { path }),
  readFile: (path: string) => invoke(IPC.FsReadFile, { path }),
  writeFile: (path: string, content: string) => invoke(IPC.FsWriteFile, { path, content }),
  createFile: (parentPath: string, name: string) => invoke(IPC.FsCreateFile, { parentPath, name }),
  createDirectory: (parentPath: string, name: string) => invoke(IPC.FsCreateDir, { parentPath, name }),
  renamePath: (path: string, newName: string) => invoke(IPC.FsRename, { path, newName }),
  deletePath: (path: string, recursive?: boolean) => invoke(IPC.FsDelete, { path, recursive }),

  // Live preview: the main process runs a 127.0.0.1 static server per open
  // workspace root. The renderer can only start/stop/observe it by root path —
  // no ports, hosts or commands beyond validation on the main side.
  preview: {
    start: (root: string, port?: number) => invoke(IPC.PreviewStart, { root, port }),
    stop: (root: string) => invoke(IPC.PreviewStop, { root }),
    status: (root: string) => invoke(IPC.PreviewStatus, { root }),
    probe: (url: string) => invoke(IPC.PreviewProbe, { url }),
  },
  // package.json-script dev servers (e.g. `npm run dev` for Vite projects).
  dev: {
    scripts: (root: string) => invoke(IPC.DevScripts, { root }),
    start: (root: string, script: string) => invoke(IPC.DevStart, { root, script }),
    stop: (root: string) => invoke(IPC.DevStop, { root }),
    status: (root: string) => invoke(IPC.DevStatus, { root }),
  },
  openExternal: (url: string) => invoke(IPC.ShellOpenExternal, { url }),

  // Local execution of an installed runtime (python / node / powershell / java
  // / c++). The renderer names a language and hands over the source; the main
  // process owns every spawn decision, and results stream back over `onRunEvent`.
  run: {
    detect: (
      force?: boolean,
      jdkPath?: string | null,
      compilerPath?: string | null,
      tsCompilerPath?: string | null,
      workspaceRoot?: string | null,
    ) =>
      invoke(IPC.RunDetect, {
        force: Boolean(force),
        jdkPath: jdkPath || null,
        compilerPath: compilerPath || null,
        tsCompilerPath: tsCompilerPath || null,
        workspaceRoot: workspaceRoot || null,
      }),
    start: (args: {
      language: string;
      sourceCode: string;
      filePath?: string | null;
      jdkPath?: string | null;
      compilerPath?: string | null;
      projectPath?: string | null;
      workspaceRoot?: string | null;
      classpath?: string[];
    }) => invoke(IPC.RunStart, args),
    stdin: (sessionId: string, data: string) => invoke(IPC.RunStdin, { sessionId, data }),
    stop: (sessionId: string) => invoke(IPC.RunStop, { sessionId }),
    // The command line a managed run would use, for "Run in Terminal".
    terminalCommand: (args: {
      language: string;
      filePath?: string | null;
      jdkPath?: string | null;
      compilerPath?: string | null;
      projectPath?: string | null;
      workspaceRoot?: string | null;
      classpath?: string[];
    }) => invoke(IPC.RunTerminalCommand, args),
    onEvent: (cb: (payload: any) => void) => {
      const listener = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on(IPC.RunEvent, listener);
      return () => ipcRenderer.removeListener(IPC.RunEvent, listener);
    },
  },

  // Java dependency resolution (Desktop Mode only). The renderer names the
  // Maven coordinates the user explicitly added; the main process downloads
  // them into ~/.m2 and hands back absolute JAR paths for the run classpath.
  javaDeps: {
    resolve: (args: { requestId?: string; coordinates: string[]; offline?: boolean }) =>
      invoke(IPC.JavaDepsResolve, args),
    status: () => invoke(IPC.JavaDepsStatus),
    clearCache: (coordinates?: string[]) => invoke(IPC.JavaDepsClearCache, { coordinates: coordinates || [] }),
    onProgress: (cb: (payload: any) => void) => {
      const listener = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on(IPC.JavaDepsProgress, listener);
      return () => ipcRenderer.removeListener(IPC.JavaDepsProgress, listener);
    },
  },

  // Language-server IntelliSense: start/stop/status of a main-process LSP
  // bridge. The renderer never spawns anything; it only receives a
  // ws://127.0.0.1 URL to connect the editor's LSP client to.
  lsp: {
    start: (args: {
      language: string;
      root?: string | null;
      toolPath?: string | null;
      jdkPath?: string | null;
      reprobe?: boolean;
    }) => invoke(IPC.LspStart, args),
    stop: (args: { language: string; root?: string | null }) => invoke(IPC.LspStop, args),
    status: (args: { language: string; root?: string | null }) => invoke(IPC.LspStatus, args),
  },

  ai: {
    ollama: {
      health: (baseUrl?: string) => invoke(IPC.AiOllamaHealth, { baseUrl }),
      models: (baseUrl?: string) => invoke(IPC.AiOllamaModels, { baseUrl }),
      start: (args: { baseUrl?: string; model: string; messages: Array<{ role: string; content: string }> }) => invoke(IPC.AiOllamaStart, args),
      stop: (sessionId: string) => invoke(IPC.AiOllamaStop, { sessionId }),
      onEvent: (cb: (payload: any) => void) => {
        const listener = (_e: unknown, payload: any) => cb(payload);
        ipcRenderer.on(IPC.AiOllamaEvent, listener);
        return () => ipcRenderer.removeListener(IPC.AiOllamaEvent, listener);
      },
    },
  },

  auth: {
    login: (email: string, password: string) => invoke(IPC.AuthLogin, { email, password }),
    register: (email: string, password: string) => invoke(IPC.AuthRegister, { email, password }),
    restore: () => invoke(IPC.AuthRestore),
    logout: () => invoke(IPC.AuthLogout),
    updateProfile: (profile: { displayName?: string; theme?: string }) => invoke(IPC.AuthUpdateProfile, profile),
    request: (args: { path: string; method?: string; body?: unknown }) => invoke(IPC.AuthRequest, args),
    ai: {
      start: (args: { provider: string; model?: string; messages: Array<{ role: string; content: string }>; context?: unknown }) => invoke(IPC.AuthAiStart, args),
      stop: (sessionId: string) => invoke(IPC.AuthAiStop, { sessionId }),
      onEvent: (cb: (payload: any) => void) => {
        const listener = (_e: unknown, payload: any) => cb(payload);
        ipcRenderer.on(IPC.AuthAiEvent, listener);
        return () => ipcRenderer.removeListener(IPC.AuthAiEvent, listener);
      },
    },
  },

  debug: {
    capability: () => invoke(IPC.DebugCapability),
    start: (args: { sourceCode: string; sourceFile?: string; executionId: string }) => invoke(IPC.DebugStart, args),
    request: (args: { debugSessionId: string; command: string; arguments?: Record<string, unknown> }) => invoke(IPC.DebugRequest, args),
    stop: (debugSessionId: string) => invoke(IPC.DebugStop, { debugSessionId }),
    onEvent: (cb: (payload: any) => void) => {
      const listener = (_e: unknown, payload: any) => cb(payload);
      ipcRenderer.on(IPC.DebugEvent, listener);
      return () => ipcRenderer.removeListener(IPC.DebugEvent, listener);
    },
  },

  terminal: {
    create: (options: { cwd?: string; shell?: string; cols?: number; rows?: number; extraPathDirs?: string[] }) =>
      invoke(IPC.TerminalCreate, options),
    write: (sessionId: string, data: string) => ipcRenderer.send(IPC.TerminalWrite, { sessionId, data }),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.send(IPC.TerminalResize, { sessionId, cols, rows }),
    close: (sessionId: string) => ipcRenderer.send(IPC.TerminalClose, { sessionId }),
    onData: (cb: (payload: { sessionId: string; data: string }) => void) => {
      const listener = (_e: unknown, payload: { sessionId: string; data: string }) => cb(payload);
      ipcRenderer.on(IPC.TerminalData, listener);
      return () => ipcRenderer.removeListener(IPC.TerminalData, listener);
    },
    onExit: (cb: (payload: { sessionId: string; code: number }) => void) => {
      const listener = (_e: unknown, payload: { sessionId: string; code: number }) => cb(payload);
      ipcRenderer.on(IPC.TerminalExit, listener);
      return () => ipcRenderer.removeListener(IPC.TerminalExit, listener);
    },
  },

  // Clipboard through the main process (the sandboxed page has no clipboard).
  clipboard: {
    readText: () => invoke(IPC.ClipboardReadText),
    writeText: (text: string) => invoke(IPC.ClipboardWriteText, { text }),
  },
};

contextBridge.exposeInMainWorld('stackamit', api);

export type StackamitBridge = typeof api;
