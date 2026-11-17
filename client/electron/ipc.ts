/**
 * IPC handler registration (Electron main process).
 *
 * Each handler validates the sender frame against the trusted origin(s), checks
 * argument types, and delegates to a service that returns a structured result.
 * No handler ever throws a raw error to the renderer; failures are { ok:false }.
 */
import { ipcMain, dialog, BrowserWindow, shell, app, clipboard } from 'electron';
import path from 'node:path';
import * as fsSvc from './services/workspaceFs.js';
import * as term from './services/terminal.js';
import * as preview from './services/previewServer.js';
import * as localRun from './services/localRun.js';
import * as javaDeps from './services/javaDeps.js';
import * as lsp from './services/languageServer.js';
import * as ollama from './services/ollama.js';
import * as desktopAuth from './services/desktopAuth.js';
import crypto from 'node:crypto';
import { detectLocalRuntimes, refreshProcessPath } from './services/runtimeProbe.js';
import { IPC } from './shared/ipc.js';
import * as pythonDebug from './services/pythonDebug.js';

/** Cap on the source a single IPC run request may carry (defense in depth). */
const MAX_RUN_SOURCE_CHARS = 1_000_000;

/**
 * Window-creation callbacks supplied by the main process so a "new workspace"
 * request can open a managed window without `ipc.ts` importing BrowserWindow
 * construction. `host` is optional so the pure-Node IPC unit tests (which pass
 * only the two original arguments) still register every other channel.
 */
export type WorkspaceWindowHost = {
  /** Focus an existing window for `root`, or open a new one. Says which happened. */
  openWithWorkspace(root: string): { existed: boolean };
  /** Pop the consume-once initial workspace handed to a freshly created window. */
  takePendingWorkspace(webContentsId: number): string | null;
};

export function registerIpc(
  getWindows: () => BrowserWindow[],
  isTrustedUrl: (url: string) => boolean,
  host?: WorkspaceWindowHost,
  apiOrigin = '',
): void {
  const isTrusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean => {
    const frame = (event as Electron.IpcMainInvokeEvent).senderFrame;
    const url = frame?.url || event.sender.getURL?.() || '';
    return isTrustedUrl(url);
  };

  const wrap = (
    _channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, args: any) => Promise<any> | any,
  ) => {
    return async (event: Electron.IpcMainInvokeEvent, args: any) => {
      if (!isTrusted(event)) return { ok: false, code: 'UNTRUSTED_SENDER', message: 'Untrusted request.' };
      try {
        return await handler(event, args);
      } catch (err: any) {
        return { ok: false, code: 'INTERNAL', message: err?.message || 'Unexpected error.' };
      }
    };
  };

  const ollamaSessions = new Map<string, { owner: number; controller: AbortController }>();
  const aiSessions = new Map<string, { owner: number; controller: AbortController }>();
  ipcMain.handle(IPC.AiOllamaHealth, wrap(IPC.AiOllamaHealth, (_e, args: { baseUrl?: string }) => ollama.health(args?.baseUrl)));
  ipcMain.handle(IPC.AiOllamaModels, wrap(IPC.AiOllamaModels, (_e, args: { baseUrl?: string }) => ollama.models(args?.baseUrl)));
  ipcMain.handle(IPC.AiOllamaStart, wrap(IPC.AiOllamaStart, async (event, args: { baseUrl?: string; model?: string; messages?: Array<{ role: string; content: string }> }) => {
    if (typeof args?.model !== 'string' || !args.model.trim() || !Array.isArray(args.messages) || args.messages.length > 50) throw new Error('Invalid Ollama chat request.');
    if (args.messages.some((message) => typeof message?.role !== 'string' || typeof message?.content !== 'string' || message.content.length > 20000)) throw new Error('Invalid Ollama message.');
    const sessionId = crypto.randomUUID();
    const controller = new AbortController();
    ollamaSessions.set(sessionId, { owner: event.sender.id, controller });
    const send = (payload: Record<string, unknown>) => { if (!event.sender.isDestroyed()) event.sender.send(IPC.AiOllamaEvent, { sessionId, ...payload }); };
    void (async () => {
      try {
        send({ type: 'started', model: args.model });
        await ollama.stream(args.baseUrl, { model: args.model!, messages: args.messages! }, controller.signal, (item) => {
          const text = (item.message as { content?: string } | undefined)?.content;
          if (text) send({ type: 'delta', text });
          if (item.done) send({ type: 'completed', usage: item });
        });
        if (controller.signal.aborted) send({ type: 'cancelled' });
      } catch (error) { if (controller.signal.aborted) send({ type: 'cancelled' }); else send({ type: 'error', message: error instanceof Error ? error.message : 'Ollama request failed.' }); }
      finally { ollamaSessions.delete(sessionId); }
    })();
    return { ok: true, sessionId };
  }));
  ipcMain.handle(IPC.AiOllamaStop, wrap(IPC.AiOllamaStop, (event, args: { sessionId?: string }) => {
    const session = args?.sessionId ? ollamaSessions.get(args.sessionId) : undefined;
    if (!session || session.owner !== event.sender.id) return { ok: false, code: 'NOT_FOUND' };
    session.controller.abort(); return { ok: true };
  }));

  ipcMain.handle(IPC.AuthLogin, wrap(IPC.AuthLogin, (_event, args: { email?: string; password?: string }) => {
    if (typeof args?.email !== 'string' || typeof args.password !== 'string' || args.email.length > 254 || args.password.length > 128) throw new Error('Invalid authentication request.');
    return desktopAuth.login(apiOrigin, args.email.trim().toLowerCase(), args.password);
  }));
  ipcMain.handle(IPC.AuthRegister, wrap(IPC.AuthRegister, (_event, args: { email?: string; password?: string }) => {
    if (typeof args?.email !== 'string' || typeof args.password !== 'string' || args.email.length > 254 || args.password.length > 128) throw new Error('Invalid authentication request.');
    return desktopAuth.register(apiOrigin, args.email.trim().toLowerCase(), args.password);
  }));
  ipcMain.handle(IPC.AuthRestore, wrap(IPC.AuthRestore, () => desktopAuth.restore(apiOrigin)));
  ipcMain.handle(IPC.AuthLogout, wrap(IPC.AuthLogout, () => desktopAuth.logout(apiOrigin)));
  ipcMain.handle(IPC.AuthUpdateProfile, wrap(IPC.AuthUpdateProfile, (_event, args: { displayName?: string; theme?: string }) => desktopAuth.updateProfile(apiOrigin, args || {})));
  ipcMain.handle(IPC.AuthRequest, wrap(IPC.AuthRequest, (_event, args: { path?: string; method?: string; body?: unknown }) => {
    if (typeof args?.path !== 'string' || args.path.length > 300 || (args.method && typeof args.method !== 'string')) throw new Error('Invalid desktop account request.');
    return desktopAuth.requestJson(apiOrigin, args.path, String(args.method || 'GET').toUpperCase(), args.body);
  }));
  ipcMain.handle(IPC.AuthAiStart, wrap(IPC.AuthAiStart, async (event, args: { provider?: string; model?: string; messages?: Array<{ role: string; content: string }>; context?: unknown }) => {
    if (typeof args?.provider !== 'string' || !Array.isArray(args.messages) || args.messages.length > 30 || args.messages.some((message) => typeof message?.role !== 'string' || typeof message?.content !== 'string' || message.content.length > 50000)) throw new Error('Invalid authenticated AI request.');
    if (args.provider === 'ollama') throw new Error('Use the local Ollama bridge for Ollama requests.');
    const sessionId = crypto.randomUUID(); const controller = new AbortController(); aiSessions.set(sessionId, { owner: event.sender.id, controller });
    const send = (payload: Record<string, unknown>) => { if (!event.sender.isDestroyed()) event.sender.send(IPC.AuthAiEvent, { sessionId, ...payload }); };
    void (async () => {
      try {
        let buffer = '';
        send({ type: 'started', provider: args.provider, model: args.model || null });
        await desktopAuth.streamAi(apiOrigin, { provider: args.provider, model: args.model, messages: args.messages, context: args.context }, controller.signal, (chunk: string) => {
          buffer += chunk; const blocks = buffer.split(/\n\n/); buffer = blocks.pop() || '';
          for (const block of blocks) {
            const eventName = block.match(/^event:\s*(.+)$/m)?.[1];
            const raw = block.match(/^data:\s*(.+)$/m)?.[1];
            if (!raw) continue;
            let data;
            try { data = JSON.parse(raw); } catch { continue; }
            if (eventName === 'delta') send({ type: 'delta', text: data.text });
            else if (eventName === 'completed') send({ type: 'completed', usage: data.usage || null });
            else if (eventName === 'error') send({ type: 'error', message: data.message || 'AI provider error.' });
            else if (eventName === 'cancelled') send({ type: 'cancelled' });
          }
        });
        if (controller.signal.aborted) send({ type: 'cancelled' });
      } catch (error) { if (controller.signal.aborted) send({ type: 'cancelled' }); else send({ type: 'error', message: error instanceof Error ? error.message : 'Authenticated AI request failed.' }); }
      finally { aiSessions.delete(sessionId); }
    })();
    return { ok: true, sessionId };
  }));
  ipcMain.handle(IPC.AuthAiStop, wrap(IPC.AuthAiStop, (event, args: { sessionId?: string }) => { const session = args?.sessionId ? aiSessions.get(args.sessionId) : undefined; if (!session || session.owner !== event.sender.id) return { ok: false, code: 'NOT_FOUND' }; session.controller.abort(); return { ok: true }; }));

  ipcMain.handle(IPC.DebugCapability, wrap(IPC.DebugCapability, () => pythonDebug.pythonDebugCapability()));
  ipcMain.handle(IPC.DebugStart, wrap(IPC.DebugStart, (event, args: { sourceCode?: string; sourceFile?: string; executionId?: string }) => {
    if (typeof args?.sourceCode !== 'string' || typeof args.executionId !== 'string') throw new Error('Invalid debug request.');
    return pythonDebug.startPythonDebug(event.sender.id, { sourceCode: args.sourceCode, sourceFile: args.sourceFile, executionId: args.executionId }, (payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.DebugEvent, payload);
    });
  }));
  ipcMain.handle(IPC.DebugRequest, wrap(IPC.DebugRequest, (event, args: { debugSessionId?: string; command?: string; arguments?: Record<string, unknown> }) => {
    if (typeof args?.debugSessionId !== 'string' || typeof args.command !== 'string') throw new Error('Invalid debug operation.');
    return pythonDebug.requestPythonDebug(event.sender.id, args.debugSessionId, args.command, args.arguments || {});
  }));
  ipcMain.handle(IPC.DebugStop, wrap(IPC.DebugStop, (event, args: { debugSessionId?: string }) => {
    if (typeof args?.debugSessionId !== 'string') throw new Error('Invalid debug session.');
    return pythonDebug.stopPythonDebug(event.sender.id, args.debugSessionId);
  }));

  // ---- Workspace / dialogs ----
  ipcMain.handle(
    IPC.WorkspaceOpen,
    wrap(IPC.WorkspaceOpen, async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window.' };
      const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
      if (res.canceled || !res.filePaths[0]) return { ok: false, code: 'CANCELED', message: 'Canceled.' };
      const root = fsSvc.addAuthorizedRoot(res.filePaths[0]);
      return { ok: true, root };
    }),
  );

  // Open a folder and load it in a NEW managed window, leaving the calling
  // window's own workspace untouched. Canceling the picker creates nothing.
  ipcMain.handle(
    IPC.WindowNewWorkspace,
    wrap(IPC.WindowNewWorkspace, async (event) => {
      if (!host) return { ok: false, code: 'UNSUPPORTED', message: 'New windows are unavailable here.' };
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window.' };
      const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
      if (res.canceled || !res.filePaths[0]) return { ok: false, code: 'CANCELED', message: 'Canceled.' };
      const root = fsSvc.addAuthorizedRoot(res.filePaths[0]);
      const { existed } = host.openWithWorkspace(root);
      return { ok: true, root, existed };
    }),
  );

  // A freshly created window asks which workspace it was opened for. The answer
  // is handed over once — a later reload sees no pending workspace and shows
  // the Welcome screen rather than re-applying a stale root.
  ipcMain.handle(
    IPC.WindowGetInitialWorkspace,
    wrap(IPC.WindowGetInitialWorkspace, (event) => {
      if (!host) return { ok: true, root: null };
      return { ok: true, root: host.takePendingWorkspace(event.sender.id) };
    }),
  );

  ipcMain.handle(
    IPC.DialogSaveAs,
    wrap(IPC.DialogSaveAs, async (event, args: { defaultPath?: string; content?: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window.' };
      const res = await dialog.showSaveDialog(win, {
        defaultPath: typeof args?.defaultPath === 'string' ? args.defaultPath : undefined,
      });
      if (res.canceled || !res.filePath) return { ok: false, code: 'CANCELED', message: 'Canceled.' };
      // Saving here is an explicit user-chosen location — authorize it.
      fsSvc.addAuthorizedRoot(path.dirname(res.filePath));
      if (typeof args?.content === 'string') return fsSvc.writeFile(res.filePath, args.content);
      return { ok: true, path: res.filePath };
    }),
  );

  // ---- Filesystem ----
  ipcMain.handle(IPC.FsReadDir, wrap(IPC.FsReadDir, (_e, args: { path: string }) => fsSvc.readDirectory(args?.path)));
  ipcMain.handle(IPC.FsReadFile, wrap(IPC.FsReadFile, (_e, args: { path: string }) => fsSvc.readFile(args?.path)));
  ipcMain.handle(
    IPC.FsWriteFile,
    wrap(IPC.FsWriteFile, (_e, args: { path: string; content: string }) => fsSvc.writeFile(args?.path, args?.content)),
  );
  ipcMain.handle(
    IPC.FsCreateFile,
    wrap(IPC.FsCreateFile, (_e, args: { parentPath: string; name: string }) => fsSvc.createFile(args?.parentPath, args?.name)),
  );
  ipcMain.handle(
    IPC.FsCreateDir,
    wrap(IPC.FsCreateDir, (_e, args: { parentPath: string; name: string }) => fsSvc.createDirectory(args?.parentPath, args?.name)),
  );
  ipcMain.handle(
    IPC.FsRename,
    wrap(IPC.FsRename, (_e, args: { path: string; newName: string }) => fsSvc.renamePath(args?.path, args?.newName)),
  );
  ipcMain.handle(
    IPC.FsDelete,
    wrap(IPC.FsDelete, (_e, args: { path: string; recursive?: boolean }) => fsSvc.deletePath(args?.path, Boolean(args?.recursive))),
  );

  // ---- Live preview & dev servers ----
  ipcMain.handle(
    IPC.PreviewStart,
    wrap(IPC.PreviewStart, (_e, args: { root?: string; port?: number }) => preview.startStatic(args || {})),
  );
  ipcMain.handle(IPC.PreviewStop, wrap(IPC.PreviewStop, (_e, args: { root?: string }) => preview.stopStatic(args || {})));
  ipcMain.handle(IPC.PreviewStatus, wrap(IPC.PreviewStatus, (_e, args: { root?: string }) => preview.staticStatus(args || {})));
  ipcMain.handle(
    IPC.PreviewProbe,
    wrap(IPC.PreviewProbe, (_e, args: { url?: string }) =>
      typeof args?.url === 'string' ? preview.probeUrl(args.url) : { ok: false, code: 'BAD_URL', message: 'Missing URL.' },
    ),
  );
  ipcMain.handle(IPC.DevScripts, wrap(IPC.DevScripts, (_e, args: { root?: string }) => preview.listDevScripts(args || {})));
  ipcMain.handle(
    IPC.DevStart,
    wrap(IPC.DevStart, (_e, args: { root?: string; script?: string }) => preview.startDev(args || {})),
  );
  ipcMain.handle(IPC.DevStop, wrap(IPC.DevStop, (_e, args: { root?: string }) => preview.stopDev(args || {})));
  ipcMain.handle(IPC.DevStatus, wrap(IPC.DevStatus, (_e, args: { root?: string }) => preview.devStatus(args || {})));

  // External browser: only URLs of servers this app itself is currently serving.
  ipcMain.handle(
    IPC.ShellOpenExternal,
    wrap(IPC.ShellOpenExternal, async (_e, args: { url?: string }) => {
      if (typeof args?.url !== 'string' || !preview.isAllowedServerUrl(args.url)) {
        return { ok: false, code: 'FORBIDDEN', message: 'Only active local preview addresses can be opened externally.' };
      }
      await shell.openExternal(args.url);
      return { ok: true };
    }),
  );

  // ---- Local (offline) execution ----
  // Which runtimes are installed, with the exact path and version discovered.
  // `jdkPath` / `compilerPath` are the configured tool locations, so a runtime's
  // availability here matches what a run of that language can actually use.
  ipcMain.handle(
    IPC.RunDetect,
    wrap(IPC.RunDetect, async (_e, args: { force?: boolean; jdkPath?: string | null; compilerPath?: string | null; tsCompilerPath?: string | null; workspaceRoot?: string | null }) => {
      const force = Boolean(args?.force);
      if (force) {
        // Re-checking is also how a user recovers from an environment snapshot
        // that predates a toolchain install: the registry PATH is re-read and
        // merged into this process, so the integrated terminal and every later
        // child see the tool this detection is about to report.
        await refreshProcessPath(true).catch(() => {});
      }
      // A configured TypeScript path and the opened workspace let the badge run
      // the *same* compiler discovery a real Run would, so it can never claim
      // "unavailable" for a project that ships its own `tsc`. The workspace root
      // is honoured only inside an authorized folder, exactly like a run path.
      const workspaceRoot =
        typeof args?.workspaceRoot === 'string' && args.workspaceRoot ? fsSvc.resolveWithinRoots(args.workspaceRoot) : null;
      return {
        ok: true,
        runtimes: await detectLocalRuntimes(
          force,
          typeof args?.jdkPath === 'string' ? args.jdkPath : null,
          typeof args?.compilerPath === 'string' ? args.compilerPath : null,
          {
            tsCompilerPath: typeof args?.tsCompilerPath === 'string' ? args.tsCompilerPath : null,
            workspaceRoot,
          },
        ),
        plans: Object.keys(localRun.LOCAL_PLANS),
      };
    }),
  );

  // Start a local run. The language must be one of the allow-listed plans, the
  // source is capped, and a saved file may only be executed when it lives
  // inside a workspace root the user actually opened.
  ipcMain.handle(
    IPC.RunStart,
    wrap(
      IPC.RunStart,
      async (
        event,
        args: {
          language?: string;
          sourceCode?: string;
          filePath?: string | null;
          jdkPath?: string | null;
          compilerPath?: string | null;
          projectPath?: string | null;
          workspaceRoot?: string | null;
          classpath?: unknown;
        },
      ) => {
        const language = typeof args?.language === 'string' ? args.language : '';
        if (!localRun.LOCAL_PLANS[language]) {
          return { ok: false, code: 'UNSUPPORTED_LANGUAGE', message: `"${language}" has no local runner in this app.` };
        }
        const sourceCode = typeof args?.sourceCode === 'string' ? args.sourceCode.slice(0, MAX_RUN_SOURCE_CHARS) : '';
        let filePath: string | null = null;
        if (typeof args?.filePath === 'string' && args.filePath) {
          filePath = fsSvc.resolveWithinRoots(args.filePath);
          if (!filePath) {
            return { ok: false, code: 'FORBIDDEN', message: 'That file is outside the folders you have opened.' };
          }
        }
        // Project context for a multi-file build (C++). Both are *hints* the
        // same way `filePath` is not: each is only honoured when it stays
        // inside a folder the user opened, and a run without them still works —
        // it just cannot see files the renderer never showed the main process.
        const projectPath =
          typeof args?.projectPath === 'string' && args.projectPath ? fsSvc.resolveWithinRoots(args.projectPath) : null;
        const workspaceRoot =
          typeof args?.workspaceRoot === 'string' && args.workspaceRoot ? fsSvc.resolveWithinRoots(args.workspaceRoot) : null;

        // Events are produced before the renderer knows the session id, and IPC
        // messages can overtake the invoke reply — so everything emitted up to
        // `start()` is returned *inside* the reply and replayed by the renderer
        // before it subscribes. Nothing streamed early can be lost.
        const wc = event.sender;
        let sessionId: string | null = null;
        const replay: localRun.RunEvent[] = [];
        const sink = (e: localRun.RunEvent) => {
          if (!sessionId) {
            replay.push(e);
            return;
          }
          if (!wc.isDestroyed()) wc.send(IPC.RunEvent, { sessionId, ...e });
        };

        const res = await localRun.start(
          {
            language,
            sourceCode,
            filePath,
            tempRoot: app.getPath('temp'),
            // A configured JDK / compiler path is handed to the finder, which
            // locates and runs the tool before anything is built from it.
            jdkPath: typeof args?.jdkPath === 'string' && args.jdkPath ? args.jdkPath : null,
            compilerPath: typeof args?.compilerPath === 'string' && args.compilerPath ? args.compilerPath : null,
            projectPath,
            workspaceRoot,
            // Only JARs that live inside the managed repository survive; the
            // renderer names dependencies, it cannot plant an arbitrary path.
            classpath: javaDeps.sanitizeClasspath(args?.classpath),
          },
          sink,
        );
        if (!res.ok) return res;
        sessionId = res.sessionId;
        // A window that goes away must not leave a child process running.
        wc.once('destroyed', () => localRun.stop(res.sessionId));
        return { ok: true, sessionId: res.sessionId, replay };
      },
    ),
  );

  ipcMain.handle(
    IPC.RunStdin,
    wrap(IPC.RunStdin, (_e, args: { sessionId?: string; data?: string }) => {
      if (typeof args?.sessionId !== 'string' || typeof args?.data !== 'string') {
        return { ok: false, code: 'BAD_ARGS', message: 'sessionId and data are required.' };
      }
      return { ok: localRun.writeStdin(args.sessionId, args.data) };
    }),
  );

  ipcMain.handle(
    IPC.RunStop,
    wrap(IPC.RunStop, (_e, args: { sessionId?: string }) => {
      if (typeof args?.sessionId !== 'string') {
        return { ok: false, code: 'BAD_ARGS', message: 'sessionId is required.' };
      }
      return { ok: localRun.stop(args.sessionId) };
    }),
  );

  // Build (but do not spawn) the exact command line a managed run would use, so
  // the renderer can type it into a real integrated terminal. Reuses the same
  // planners as RunStart — there is no second build system to drift from.
  ipcMain.handle(
    IPC.RunTerminalCommand,
    wrap(
      IPC.RunTerminalCommand,
      async (
        event,
        args: {
          language?: string;
          filePath?: string | null;
          jdkPath?: string | null;
          compilerPath?: string | null;
          projectPath?: string | null;
          workspaceRoot?: string | null;
          classpath?: unknown;
        },
      ) => {
        const language = typeof args?.language === 'string' ? args.language : '';
        if (!localRun.LOCAL_PLANS[language]) {
          return { ok: false, code: 'UNSUPPORTED_LANGUAGE', message: `"${language}" has no local runner in this app.` };
        }
        let filePath: string | null = null;
        if (typeof args?.filePath === 'string' && args.filePath) {
          filePath = fsSvc.resolveWithinRoots(args.filePath);
          if (!filePath) return { ok: false, code: 'FORBIDDEN', message: 'That file is outside the folders you have opened.' };
        }
        const projectPath =
          typeof args?.projectPath === 'string' && args.projectPath ? fsSvc.resolveWithinRoots(args.projectPath) : null;
        const workspaceRoot =
          typeof args?.workspaceRoot === 'string' && args.workspaceRoot ? fsSvc.resolveWithinRoots(args.workspaceRoot) : null;
        const res = await localRun.buildTerminalCommand({
          language,
          filePath,
          jdkPath: typeof args?.jdkPath === 'string' && args.jdkPath ? args.jdkPath : null,
          compilerPath: typeof args?.compilerPath === 'string' && args.compilerPath ? args.compilerPath : null,
          projectPath,
          workspaceRoot,
          classpath: javaDeps.sanitizeClasspath(args?.classpath),
        });
        // A compiled plan built into a scratch folder the typed command writes
        // its output into. It must stay available while the terminal can use it,
        // so it is released only when this window — and therefore its terminal
        // session and any running process — is destroyed, never mid-run. The
        // folder path is a main-process temp detail, so it is not sent back to
        // the renderer.
        if (res.ok && res.scratch.length) {
          const { scratch, ...publicResult } = res;
          event.sender.once('destroyed', () => void localRun.cleanupScratch(scratch));
          return publicResult;
        }
        return res;
      },
    ),
  );

  // ---- Java dependency resolution (Desktop Mode) ----
  // The renderer supplies Maven coordinates it explicitly added; the main
  // process resolves them (with transitive deps) into ~/.m2 and returns
  // absolute JAR paths. Invalid coordinates never reach the network or disk.
  const MAX_DEP_COORDINATES = 60;
  ipcMain.handle(
    IPC.JavaDepsResolve,
    wrap(
      IPC.JavaDepsResolve,
      async (
        event,
        args: { requestId?: string; coordinates?: unknown; offline?: boolean },
      ): Promise<import('./shared/ipc.js').JavaDepsResolveResult> => {
        const send = (payload: import('./shared/ipc.js').JavaDepsProgressPayload) => {
          const wc = event.sender;
          if (!wc.isDestroyed()) wc.send(IPC.JavaDepsProgress, payload);
        };
        const requestId = typeof args?.requestId === 'string' ? args.requestId : '';
        const rawCoords = Array.isArray(args?.coordinates) ? args.coordinates : [];
        if (rawCoords.length > MAX_DEP_COORDINATES) {
          return {
            ok: false,
            classpath: [],
            resolved: [],
            missing: [],
            conflicts: [],
            errors: [{ coordinate: '', message: `Too many coordinates in one resolve (max ${MAX_DEP_COORDINATES}).` }],
            fromCacheOnly: false,
          };
        }
        const coordinates = rawCoords.filter((c): c is string => typeof c === 'string' && c.trim() !== '');
        send({ requestId, phase: 'start', message: `Resolving ${coordinates.length} dependency…`, total: coordinates.length, completed: 0 });
        const outcome = await javaDeps.resolveJavaDependencies({
          coordinates,
          offline: Boolean(args?.offline),
          log: (m) => send({ requestId, phase: 'fetch', message: m }),
        });
        // Do not echo absolute cache paths beyond what the run needs; the JAR
        // paths are required for the classpath, but they stay inside ~/.m2.
        send({ requestId, phase: outcome.ok ? 'done' : 'error', message: outcome.ok ? 'Dependencies resolved.' : 'Some dependencies could not be resolved.', completed: outcome.resolved.length, total: coordinates.length });
        return {
          ok: outcome.ok,
          classpath: outcome.classpath,
          resolved: outcome.resolved.map((r) => ({
            coordinate: r.coordinate,
            version: r.version,
            packaging: r.packaging,
            depth: r.depth,
            requestedBy: r.requestedBy,
            ...(r.jarPath ? { jarPath: r.jarPath } : {}),
          })),
          missing: outcome.missing,
          conflicts: outcome.conflicts,
          errors: outcome.errors,
          fromCacheOnly: outcome.fromCacheOnly,
        };
      },
    ),
  );

  ipcMain.handle(
    IPC.JavaDepsStatus,
    wrap(IPC.JavaDepsStatus, () => ({ ok: true, ...javaDeps.cacheStatus() })),
  );

  ipcMain.handle(
    IPC.JavaDepsClearCache,
    wrap(IPC.JavaDepsClearCache, async (_e, args: { coordinates?: unknown }) => {
      const raw = Array.isArray(args?.coordinates) ? args.coordinates : [];
      const coordinates = raw.filter((c): c is string => typeof c === 'string');
      // With no coordinates, this is a no-op report — the shared ~/.m2 is never
      // wiped wholesale (the user's own Maven builds may depend on it).
      if (!coordinates.length) return { ok: true, removed: [] };
      const removed = await javaDeps.removeCachedCoordinates(coordinates);
      return { ok: true, removed: removed.removed };
    }),
  );

  // ---- Language servers (IntelliSense bridges) ----
  // The renderer names a language plus the workspace root; the main process
  // owns every spawn decision and returns only a loopback ws URL. Missing or
  // broken tools come back as MISSING_TOOL / INCOMPATIBLE, never a crash.
  const lspCleanupsDone = new WeakSet();
  ipcMain.handle(
    IPC.LspStart,
    wrap(
      IPC.LspStart,
      (
        event,
        args: { language?: string; root?: string | null; toolPath?: string | null; jdkPath?: string | null; reprobe?: boolean },
      ) => {
        // A window that goes away must not leave bridges/children running
        // (registered once per webContents, not once per start call).
        if (!lspCleanupsDone.has(event.sender)) {
          lspCleanupsDone.add(event.sender);
          event.sender.once('destroyed', () => void lsp.disposeAll());
        }
        // Where a server may keep its own workspace index (JDT.LS). Main picks
        // the folder; the renderer never gets to choose a write location.
        return lsp.start({ ...(args || {}), storageRoot: app.getPath('userData') });
      },
    ),
  );
  ipcMain.handle(
    IPC.LspStop,
    wrap(IPC.LspStop, (_e, args: { language?: string; root?: string | null }) => lsp.stop(args || {})),
  );
  ipcMain.handle(
    IPC.LspStatus,
    wrap(IPC.LspStatus, (_e, args: { language?: string; root?: string | null }) => lsp.status(args || {})),
  );

  // ---- Terminal (streaming) ----
  ipcMain.handle(
    IPC.TerminalCreate,
    wrap(IPC.TerminalCreate, (event, args: { cwd?: string; shell?: string; cols?: number; rows?: number; extraPathDirs?: string[] }) => {
      const wc = event.sender;
      return term.create(args || {}, (sessionId, data) => {
        if (!wc.isDestroyed()) wc.send(IPC.TerminalData, { sessionId, data });
      }, (sessionId, code) => {
        if (!wc.isDestroyed()) wc.send(IPC.TerminalExit, { sessionId, code });
      });
    }),
  );

  // Fire-and-forget channels for terminal throughput.
  ipcMain.on(IPC.TerminalWrite, (event, args: { sessionId: string; data: string }) => {
    if (!isTrusted(event)) return;
    term.write(args?.sessionId, args?.data);
  });
  ipcMain.on(IPC.TerminalResize, (event, args: { sessionId: string; cols: number; rows: number }) => {
    if (!isTrusted(event)) return;
    term.resize(args?.sessionId, args?.cols, args?.rows);
  });
  ipcMain.on(IPC.TerminalClose, (event, args: { sessionId: string; data?: string }) => {
    if (!isTrusted(event)) return;
    term.dispose(args?.sessionId);
  });

  // ---- Clipboard (main-process Electron clipboard module) ----
  // The sandboxed renderer has no clipboard access; copy/paste in the terminal
  // and Output goes through these two validated channels. nodeIntegration stays
  // off — this is the supported, narrow bridge, not raw Node in the page.
  ipcMain.handle(
    IPC.ClipboardReadText,
    wrap(IPC.ClipboardReadText, () => ({ ok: true, text: clipboard.readText() })),
  );
  ipcMain.handle(
    IPC.ClipboardWriteText,
    wrap(IPC.ClipboardWriteText, (_e, args: { text?: string }) => {
      if (typeof args?.text !== 'string') return { ok: false, code: 'BAD_ARGS', message: 'text is required.' };
      clipboard.writeText(args.text);
      return { ok: true };
    }),
  );
}

export function cleanupIpc(): void {
  term.disposeAll();
  preview.disposeAll();
  localRun.disposeAll();
  lsp.disposeAll();
}
