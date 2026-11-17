/**
 * Shared IPC contract between the Electron main process, the preload bridge, and
 * (loosely) the renderer. Keeping channel names and result shapes in one place
 * avoids typos and lets the main process validate every inbound call.
 */

export const IPC = {
  WorkspaceOpen: 'stackamit:workspace:open',
  // Open a folder and load it in a NEW managed window (leaves the calling
  // window's workspace untouched); and the handshake that lets that fresh
  // window ask the main process which workspace it was created for.
  WindowNewWorkspace: 'stackamit:window:newWorkspace',
  WindowGetInitialWorkspace: 'stackamit:window:getInitialWorkspace',
  FsReadDir: 'stackamit:fs:readDir',
  FsReadFile: 'stackamit:fs:readFile',
  FsWriteFile: 'stackamit:fs:writeFile',
  FsCreateFile: 'stackamit:fs:createFile',
  FsCreateDir: 'stackamit:fs:createDirectory',
  FsRename: 'stackamit:fs:rename',
  FsDelete: 'stackamit:fs:delete',
  DialogSaveAs: 'stackamit:dialog:saveAs',
  TerminalCreate: 'stackamit:terminal:create',
  TerminalWrite: 'stackamit:terminal:write',
  TerminalResize: 'stackamit:terminal:resize',
  TerminalClose: 'stackamit:terminal:close',
  // Live preview (static file server bound to 127.0.0.1, per workspace root).
  PreviewStart: 'stackamit:preview:start',
  PreviewStop: 'stackamit:preview:stop',
  PreviewStatus: 'stackamit:preview:status',
  PreviewProbe: 'stackamit:preview:probe',
  // package.json script dev servers (Vite etc.) for React/Vite projects.
  DevScripts: 'stackamit:dev:scripts',
  DevStart: 'stackamit:dev:start',
  DevStop: 'stackamit:dev:stop',
  DevStatus: 'stackamit:dev:status',
  // Open an *active preview* URL in the real external browser (allow-listed).
  ShellOpenExternal: 'stackamit:shell:openExternal',
  // Local (offline) execution of the installed runtimes. Nothing here reaches
  // the network: the main process spawns the user's own toolchain directly.
  RunDetect: 'stackamit:run:detect',
  RunStart: 'stackamit:run:start',
  RunStdin: 'stackamit:run:stdin',
  RunStop: 'stackamit:run:stop',
  // Build the exact command line a managed run would execute, so "Run in
  // Terminal" types the SAME plan into a real shell instead of a second,
  // divergent build system. Resolved by the same planners as RunStart.
  RunTerminalCommand: 'stackamit:run:terminalCommand',
  // Java dependency resolution (Desktop Mode). The renderer names *which*
  // Maven coordinates it wants; the main process downloads them (with their
  // transitive deps) into ~/.m2 and returns absolute JAR paths for the run.
  // None of this exists in Web Mode — the browser never gets a resolver.
  JavaDepsResolve: 'stackamit:javaDeps:resolve',
  JavaDepsStatus: 'stackamit:javaDeps:status',
  JavaDepsClearCache: 'stackamit:javaDeps:clearCache',
  // Clipboard bridge (main-process Electron `clipboard` module) so the sandboxed
  // terminal/output can copy & paste without the renderer ever reaching Node.
  ClipboardReadText: 'stackamit:clipboard:readText',
  ClipboardWriteText: 'stackamit:clipboard:writeText',
  // Language servers (Pyright/clangd/JDT.LS): the main process spawns the
  // user's own tools and bridges them to the renderer over a loopback
  // WebSocket. The renderer only ever sees a ws://127.0.0.1 URL.
  LspStart: 'stackamit:lsp:start',
  LspStop: 'stackamit:lsp:stop',
  LspStatus: 'stackamit:lsp:status',
  AiOllamaHealth: 'stackamit:ai:ollama:health',
  AiOllamaModels: 'stackamit:ai:ollama:models',
  AiOllamaStart: 'stackamit:ai:ollama:start',
  AiOllamaStop: 'stackamit:ai:ollama:stop',
  AiOllamaEvent: 'stackamit:ai:ollama:event',
  AuthLogin: 'stackamit:auth:login',
  AuthRegister: 'stackamit:auth:register',
  AuthRestore: 'stackamit:auth:restore',
  AuthLogout: 'stackamit:auth:logout',
  AuthUpdateProfile: 'stackamit:auth:updateProfile',
  AuthRequest: 'stackamit:auth:request',
  AuthAiStart: 'stackamit:auth:ai:start',
  AuthAiStop: 'stackamit:auth:ai:stop',
  AuthAiEvent: 'stackamit:auth:ai:event',
  DebugCapability: 'stackamit:debug:capability',
  DebugStart: 'stackamit:debug:start',
  DebugRequest: 'stackamit:debug:request',
  DebugStop: 'stackamit:debug:stop',
  DebugEvent: 'stackamit:debug:event',
  // Main -> renderer push channels (via preload `on`).
  TerminalData: 'stackamit:terminal:data',
  TerminalExit: 'stackamit:terminal:exit',
  RunEvent: 'stackamit:run:event',
  // Main -> renderer progress for a running dependency resolution.
  JavaDepsProgress: 'stackamit:javaDeps:progress',
} as const;

/** Every fs/terminal result is a discriminated envelope — never a thrown string. */
export type Ok<T> = { ok: true } & T;
export type Err = { ok: false; code: string; message: string };
export type Result<T> = Ok<T> | Err;

export type DirEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
};

export type WorkspaceInfo = { root: string };

/**
 * Result of opening a folder in a new window: the authorized root, plus whether
 * an existing window already had it open (so the renderer never claims a second
 * window was created when the first was simply focused).
 */
export type NewWorkspaceResult = { ok: true; root: string; existed: boolean } | { ok: false; code: string; message: string };

/**
 * What "Run in Terminal" hands back: a ready command line per step, the working
 * directory it must run in, and any compiler/runtime folders to prepend to that
 * terminal session's PATH so the manual command matches the managed run exactly.
 */
export type TerminalRunCommand = {
  ok: true;
  commands: string[];
  cwd: string;
  extraPathDirs: string[];
  notes: string[];
};

export type TerminalCreateResult =
  | { ok: true; sessionId: string; shell: string }
  | { ok: false; code: string; message: string; shell?: string };

/** One streamed line/event from a local run, pushed over IPC.RunEvent. */
export type RunEventPayload = {
  sessionId: string;
  type: 'stdout' | 'stderr' | 'info' | 'error' | 'exit';
  data?: string;
  code?: number | null;
  timedOut?: boolean;
  stopped?: boolean;
};

/** What `runtimeProbe` reports about the toolchains found on this machine. */
export type RuntimeInfo = {
  key: string;
  label: string;
  available: boolean;
  cmd: string | null;
  path: string | null;
  version: string | null;
  installHint: string;
  /**
   * Compiled toolchains only (C++): where the compiler came from and which
   * family it is. The UI shows it so "found" is never a bare claim — the user
   * can see the exact executable and whether it was PATH, registry PATH, a
   * scan, or their own configured path.
   */
  compiler?: {
    exe: string;
    binDir: string;
    cmd: string;
    family: 'gcc' | 'clang' | 'msvc' | 'unknown';
    version: string | null;
    major: number | null;
    minor: number | null;
    /** 'custom' | 'PATH' | 'registry PATH' | 'scan'. */
    source: string;
  } | null;
};

/** Names of the operations exposed on the `window.stackamit` bridge. */
export const ALLOWED_CHANNELS = new Set<string>(Object.values(IPC));

/**
 * A single resolved Java dependency reported back to the renderer after
 * `JavaDepsResolve`. Absolute `jarPath`s are the classpath entries the run
 * should receive; everything else is UI metadata (never a secret/credential).
 */
export type JavaDepResolved = {
  coordinate: string;
  version: string;
  packaging: string;
  depth: number;
  requestedBy: string;
  jarPath?: string;
};

export type JavaDepIssue = { coordinate: string; reason: string };

export type JavaDepsResolveResult = {
  ok: boolean;
  classpath: string[];
  resolved: JavaDepResolved[];
  missing: JavaDepIssue[];
  conflicts: { coordinate: string; kept: string; skipped: string }[];
  errors: { coordinate: string; message: string }[];
  fromCacheOnly: boolean;
};

/** Pushed over IPC.JavaDepsProgress while a resolution is in flight. */
export type JavaDepsProgressPayload = {
  requestId: string;
  phase: 'start' | 'fetch' | 'done' | 'error';
  message: string;
  completed?: number;
  total?: number;
};
