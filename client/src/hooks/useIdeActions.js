import { useCallback, useEffect, useRef } from 'react';
import { workspace } from '../services/workspace.js';
import { api, remoteRunAvailability } from '../services/api.js';
import * as localRun from '../services/localRun.js';
import { startInteractiveSession } from '../services/interactiveRun.js';
import { createInteractiveOutputBuffer } from '../services/interactiveOutput.js';
import { useIdeStore } from '../store/ideStore.js';
import { useDependencyStore } from '../store/dependencyStore.js';
import { analyzeJavaImports } from '../utils/javaImports.js';
import { useNotifications } from '../components/ui/Notification.jsx';
import { runKeyFor, monacoLanguageFor, isUntitled } from '../utils/langForFile.js';
import { capabilityForMonacoLanguage, localRunKeyFor, localRunLanguages } from '../languages/languageCapabilities.js';
import { findModelByPath, disposeModelForPath } from '../utils/monacoModels.js';
import {
  isBrowserRunnable,
  runBrowserJavaScript,
  nodeApiUsage,
  bareImportSpecifiers,
  unawaitedDialogUsage,
  newRunToken,
} from '../utils/browserRun.js';

const LINTABLE = new Set(['python', 'c', 'cpp', 'java']);

/**
 * All the "verbs" of the IDE, shared by the shell, explorer, tabs, top menu and
 * command palette so a single implementation backs every surface.
 */
export function useIdeActions() {
  const notif = useNotifications();
  // Read the latest state inside callbacks via getState(); do not subscribe here
  // so this hook never triggers re-renders of the whole shell.
  const store = useIdeStore.getState;
  const depStore = useDependencyStore.getState;
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const lintToken = useRef(0);
  const runAbort = useRef(null);
  // The live Web-Mode interactive session (shared transport), so Stop and the
  // Output panel's stdin line talk to the same running process the Run started.
  const interactiveSession = useRef(null);
  const interactiveOutput = useRef(null);

  const setEditorHandles = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  }, []);

  // Release the Monaco model for a document path once the store no longer has
  // the doc — but never when another open document maps to the same model URI.
  // Models are keyed by Uri.parse(path), so raw-path lookups would miss them.
  const releaseModel = useCallback(
    (path) => {
      disposeModelForPath(monacoRef.current, path, Object.keys(store().docs));
    },
    [store],
  );

  // ---- workspace ----
  const openWorkspace = useCallback(async () => {
    // Desktop: "Open Workspace" loads the folder in a NEW managed window so the
    // current window keeps its own project. The web build has no windows, so it
    // keeps opening into the current virtual workspace.
    if (workspace.mode === 'desktop' && workspace.openWorkspaceInNewWindow) {
      const res = await workspace.openWorkspaceInNewWindow();
      if (!res?.ok) {
        if (res && res.code !== 'CANCELED') notif.error(res.message || 'Could not open a workspace.');
        return res ?? { ok: false, code: 'UNSUPPORTED', message: 'New windows are unavailable.' };
      }
      // Focus an already-open project is not a new one — say which happened.
      notif.success(res.existed ? 'That folder is already open in another window.' : 'Workspace opened in a new window.');
      return res;
    }
    const res = await workspace.openWorkspace();
    if (!res.ok) {
      if (res.code !== 'CANCELED') notif.error(res.message || 'Could not open a workspace.');
      return res;
    }
    store().setRoot(res.root);
    notif.success('Workspace opened.');
    return res;
  }, [notif, store]);

  const importFolder = useCallback(async () => {
    if (!workspace.importFromDirectory) {
      notif.info('Folder import is not available in this environment.');
      return { ok: false };
    }
    // In the browser an import throws away the current virtual workspace, and a
    // dirty tab would be lost with it. Ask once, then say what happened.
    const dirty = Object.keys(store().docs).filter((p) => store().isDirty(p));
    const warn = dirty.length
      ? `${dirty.length} open file(s) have unsaved changes that will be lost.`
      : 'This replaces the current browser workspace.';
    let res = await workspace.importFromDirectory();
    if (res.code === 'REPLACE_CONFIRM') {
      if (!window.confirm(`${res.message}\n\n${warn}\n\nOpen the folder anyway?`)) {
        return { ok: false, code: 'CANCELED', message: 'Canceled.' };
      }
      res = await workspace.importFromDirectory({ replace: true });
    }
    if (res.ok) {
      // Every document of the replaced tree is gone from the filesystem, so the
      // tabs must go too — otherwise they keep pointing at paths that no longer
      // exist and saving them writes into a workspace that is no longer open.
      for (const p of Object.keys(store().docs)) store().closeTab(p);
      store().setRoot(res.root);
      if (res.skipped?.length) {
        notif.warning(`${res.skipped.length} file(s) were too large for the browser workspace and were skipped.`);
      } else if (res.message) {
        notif.info(res.message);
      } else {
        notif.success('Folder loaded.');
      }
    } else if (res.code !== 'CANCELED' && res.code !== 'FORBIDDEN') {
      notif.error(res.message || 'Could not import the folder.');
    }
    return res;
  }, [notif, store]);

  // ---- open a real file on disk into a tab ----
  const openFileByPath = useCallback(
    async (path) => {
      const existing = store().docs[path];
      if (existing) {
        store().setActive(path);
        return;
      }
      const res = await workspace.readFile(path);
      if (!res.ok) {
        notif.error(res.message || 'Could not open the file.');
        return;
      }
      store().openDocument({ path, content: res.content, language: monacoLanguageFor(path) });
    },
    [notif, store],
  );

  /**
   * Re-read a file an external change (replace-in-files) wrote underneath an
   * open tab. A buffer the user has edited is never overwritten — that would
   * discard typing they have not saved yet, so the on-disk edit stands and the
   * tab keeps its own content until the user resolves the difference.
   */
  const refreshFileFromDisk = useCallback(
    async (path) => {
      const doc = store().docs[path];
      if (!doc) return { ok: true, skipped: 'not-open' };
      if (doc.content !== doc.savedContent) return { ok: true, skipped: 'dirty' };
      const res = await workspace.readFile(path);
      if (!res.ok) return res;
      store().updateContent(path, res.content);
      store().saveDocument(path, res.content);
      return { ok: true };
    },
    [store],
  );

  /**
   * Put the caret on a line/column once the editor has mounted the model, which
   * is what makes a search result land on the match instead of the top of file.
   */
  const revealInEditor = useCallback((line = 1, column = 1) => {
    const editor = editorRef.current;
    if (!editor) return;
    const apply = () => {
      try {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column });
        editor.focus();
      } catch {
        /* the model may still be swapping tabs; the file is open either way */
      }
    };
    // setPosition before the model is attached throws, so wait a frame.
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    else apply();
  }, []);

  // ---- save ----
  const saveActive = useCallback(async () => {
    const path = store().activePath;
    const doc = path && store().docs[path];
    if (!doc) {
      notif.info('No file to save.');
      return;
    }
    if (doc.untitled || isUntitled(doc.path)) {
      return saveAs();
    }
    // Manual Save supersedes any pending debounce; the shared pipeline owns the
    // write, the saved-content commit, the preview refresh and the LS notify.
    store().cancelAutoSave(path);
    const res = await store().saveFile(path);
    if (res && res.ok) notif.success('Saved.');
    else if (res && res.message) notif.error(res.message);
    else notif.error('Could not save the file.');
  }, [notif, store]);

  const saveAs = useCallback(async () => {
    const path = store().activePath;
    const doc = path && store().docs[path];
    if (!doc) {
      notif.info('No file to save.');
      return;
    }
    const res = await workspace.saveAs(doc.path.startsWith('untitled:') ? 'untitled.txt' : doc.path, doc.content);
    if (res.ok) {
      if (doc.untitled && res.path && !isUntitled(res.path)) {
        store().reassignPath(doc.path, res.path);
        store().saveDocument(res.path);
        store().touchPreviewOnSave(res.path);
        // The old untitled model is now orphaned (the wrapper keeps models with
        // keepCurrentModel), so dispose it explicitly.
        releaseModel(doc.path);
      } else {
        store().saveDocument(doc.path);
        store().touchPreviewOnSave(doc.path);
      }
      notif.success('Saved.');
    } else if (res.code !== 'CANCELED') {
      notif.error(res.message || 'Could not save the file.');
    }
  }, [notif, store, releaseModel]);

  // ---- close a tab, confirming unsaved changes ----
  const closeTab = useCallback(
    (path) => {
      const doc = store().docs[path];
      if (!doc) return;
      if (doc.content !== doc.savedContent) {
        const ok = window.confirm(`"${doc.name}" has unsaved changes. Close anyway and lose them?`);
        if (!ok) return;
      }
      // Drop the store doc first so releaseModel sees it as no longer needed,
      // then dispose the Monaco model behind the path.
      store().closeTab(path);
      releaseModel(path);
    },
    [store, releaseModel],
  );

  // ---- format (Monaco's real format provider; Prettier ext overrides it) ----
  const formatActive = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const lang = store().docs[store().activePath]?.language;
    const prettierOn = store().extensions['prettier']?.installed && store().extensions['prettier']?.enabled;
    const supported = prettierOn
      ? ['javascript', 'typescript', 'json', 'css', 'scss', 'less', 'html', 'markdown', 'yaml']
      : ['javascript', 'typescript', 'json', 'html', 'css'];
    if (!supported.includes(lang)) {
      notif.info(
        prettierOn
          ? `No formatter available for ${lang}.`
          : `In-browser formatting isn't available for ${lang}; install the Prettier extension for wider language support.`,
      );
      return;
    }
    editor.getAction('editor.action.formatDocument')?.run();
  }, [notif, store]);

  // ---- markers ----
  const applyMarkers = useCallback((path, markers) => {
    const monaco = monacoRef.current;
    const model = findModelByPath(monaco, path);
    if (!monaco || !model) return;
    const maxLine = model.getLineCount();
    const mapped = (markers || []).map((m) => {
      const line = Math.min(Math.max(1, m.line || 1), maxLine);
      const startColumn = Math.max(1, m.column || 1);
      const len = model.getLineContent(line).length;
      return {
        severity: m.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
        message: m.message || 'Error',
        startLineNumber: line,
        startColumn,
        endLineNumber: line,
        endColumn: Math.min(Math.max(startColumn + 1, len + 1), len + 1),
      };
    });
    monaco.editor.setModelMarkers(model, 'stackamit-lint', mapped);
    store().setProblems(path, (markers || []).map((m) => ({ ...m, path })));
  }, [store]);

  const lintActive = useCallback(
    async () => {
      const doc = store().docs[store().activePath];
      if (!doc) return;
      const lang = doc.language;
      // JS/TS are validated by Monaco itself.
      if (!LINTABLE.has(lang)) return;
      // An offline desktop build has no API to ask; the relative
      // `/api/code/lint` would resolve against file:// and only log a failure.
      // Syntax diagnostics there come from the language server.
      if (!remoteRunAvailability().ok) return;
      if (!doc.content.trim()) {
        applyMarkers(doc.path, []);
        return;
      }
      const token = ++lintToken.current;
      try {
        const res = await api.lint(runKeyFor(doc.path) || lang, doc.content);
        if (token === lintToken.current) applyMarkers(doc.path, res?.markers || []);
      } catch {
        if (token === lintToken.current) applyMarkers(doc.path, []);
      }
    },
    [store, applyMarkers],
  );

  // ---- file & folder mutations (explorer + palette) ----
  // `window.prompt` is unavailable in Electron (it throws), so text input goes
  // through the app's own modal; callers keep awaiting a string or null.
  const askText = useCallback(
    (title, defaultValue = '') => store().requestPrompt({ title, defaultValue }),
    [store],
  );

  const createFile = useCallback(
    async (parentDir, name) => {
      const dir = parentDir || store().root || '/';
      const finalName = name || (await askText('New file name:', 'untitled.txt'));
      if (!finalName) return { ok: false, code: 'CANCELED' };
      const res = await workspace.createFile(dir, finalName);
      if (res.ok) {
        store().bumpTree();
        await openFileByPath(res.path);
        notif.success('File created.');
      } else notif.error(res.message || 'Could not create the file.');
      return res;
    },
    [notif, store, openFileByPath, askText],
  );

  const createDirectory = useCallback(
    async (parentDir, name) => {
      const dir = parentDir || store().root || '/';
      const finalName = name || (await askText('New folder name:', 'new-folder'));
      if (!finalName) return { ok: false, code: 'CANCELED' };
      const res = await workspace.createDirectory(dir, finalName);
      if (res.ok) {
        store().bumpTree();
        notif.success('Folder created.');
      } else notif.error(res.message || 'Could not create the folder.');
      return res;
    },
    [notif, store, askText],
  );

  const rename = useCallback(
    async (path, newName) => {
      const cur = path.split(/[\\/]/).pop();
      const finalName = newName || (await askText('Rename to:', cur));
      if (!finalName || finalName === cur) return { ok: false, code: 'CANCELED' };
      const res = await workspace.rename(path, finalName);
      if (res.ok) {
        // Update any open document buffer that pointed at the old path.
        if (store().docs[path]) {
          store().reassignPath(path, res.path, finalName);
          // The path prop changed, so the wrapper now binds a model under the
          // new URI — release the orphaned old one.
          releaseModel(path);
        }
        store().bumpTree();
        notif.success('Renamed.');
      } else if (res.code !== 'CANCELED') notif.error(res.message || 'Could not rename.');
      return res;
    },
    [notif, store, releaseModel, askText],
  );

  const remove = useCallback(
    async (path, forceRecursive) => {
      const name = path.split(/[\\/]/).pop();
      if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return { ok: false, code: 'CANCELED' };
      let res = await workspace.remove(path, Boolean(forceRecursive));
      if (!res.ok && res.code === 'NOT_EMPTY') {
        if (window.confirm(`"${name}" is not empty. Delete the folder and everything inside it?`)) {
          res = await workspace.remove(path, true);
        }
      }
      if (res.ok) {
        if (store().docs[path]) {
          store().closeTab(path);
          releaseModel(path);
        }
        store().bumpTree();
        notif.success('Deleted.');
      } else if (res.code !== 'CANCELED') notif.error(res.message || 'Could not delete.');
      return res;
    },
    [notif, store, releaseModel],
  );

  const newUntitled = useCallback(() => store().newUntitled(), [store]);

  // ---- local runtime discovery (desktop only, offline, never a network call) ----
  const refreshLocalRuntimes = useCallback(async () => {
    if (workspace.mode !== 'desktop' || !localRun.isDesktopLocalRun()) return null;
    // Java availability is decided by a validated JDK and C++ by a compiler that
    // is found and run, so both configured tool paths have to travel with the
    // query — the same setting IntelliSense uses for the JDK, kept separate for
    // the compiler because `g++` and `clangd` are different programs.
    // TypeScript is a compiler run *through Node*, and a project can ship its
    // own `node_modules/typescript`, so its configured path AND the opened folder
    // travel too — otherwise the badge would only ever see a global install and
    // could contradict a Run that compiles with the project's own `tsc`.
    const jdkPath = store().lspJdkPaths?.java || null;
    const compilerPath = store().compilerPaths?.cpp || null;
    const tsCompilerPath = store().compilerPaths?.typescript || null;
    const workspaceRoot = store().root || null;
    const res = await localRun.detectDesktopRuntimes(true, jdkPath, compilerPath, tsCompilerPath, workspaceRoot);
    if (res?.ok) store().setLocalRuntimes(res.runtimes);
    return res;
  }, [store]);

  useEffect(() => {
    // Fire-and-forget: the editor must open whether or not discovery is slow.
    refreshLocalRuntimes().catch(() => {});
  }, [refreshLocalRuntimes]);

  // Web Mode: learn once whether the server offers live interactive runs and
  // which toolchains it has. Desktop never needs this (it runs locally), and an
  // older/offline server just leaves `interactiveStatus` null → batch-only.
  useEffect(() => {
    if (workspace.mode !== 'web') return;
    let cancelled = false;
    (async () => {
      try {
        const s = await api.interactiveStatus();
        if (!cancelled && s) store().setInteractiveStatus({ enabled: Boolean(s.enabled), runtimes: s.runtimes || {} });
      } catch {
        /* interactive is optional; stays null → batch */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store]);

  /**
   * Chunked stdout/stderr arrives split at arbitrary byte boundaries, so the
   * stream is reassembled into whole output lines before it hits the panel.
   */
  const makeLineFeeder = useCallback((executionId, sourcePath) => {
    const buffer = createInteractiveOutputBuffer(({ kind, text, replace, stream }) => {
      if (!store().isExecutionCurrent(executionId)) return;
      store().pushOutput({ kind, text, executionId, sourcePath, stream, replace });
    });
    const push = (kind, chunk) => buffer.feed(kind, chunk);
    push.flush = buffer.flush;
    return push;
  }, [store]);

  // ---- Java dependency helpers --------------------------------------------
  // Dependencies are a per-project decision: key by the opened folder, or by the
  // active file when no folder is open (an unsaved buffer has no project root).
  const javaProjectKey = (doc) => store().root || doc?.path || '__no-project__';

  /** Analyze external imports across the project's currently-open Java files. */
  const detectJavaImports = useCallback(
    (doc) => {
      const docs = store().docs || {};
      const files = [];
      for (const p of Object.keys(docs)) {
        const d = docs[p];
        if (!d || typeof d.content !== 'string') continue;
        if (/\.java$/i.test(p) || /\.java$/i.test(d.name || '')) files.push({ path: p, content: d.content });
      }
      if (doc && !files.some((f) => f.path === doc.path)) files.push({ path: doc.path, content: doc.content });
      return analyzeJavaImports(files);
    },
    [store],
  );

  /**
   * Explicit user-triggered resolve for a project (the panel's Resolve button).
   * With nothing added this clears status and returns an empty classpath, so
   * dependency-free Java keeps its exact prior behavior (no resolve call, no
   * classpath flag). Failures are surfaced line-by-line so a missing dependency
   * is an actionable message, not a silent fallback. The classpath returned by a
   * successful run is what `runLocal`/"Run in Terminal" feed to javac/java.
   */
  const resolvingProjectRef = useRef(null);
  const resolveJavaProject = useCallback(
    async (projectKey, { offline = false } = {}) => {
      const cur = depStore().selectProject(projectKey);
      const coords = (cur.added || []).map((a) => a.coordinate);
      if (!coords.length) {
        depStore().clearStatus(projectKey);
        return { ok: true, empty: true, classpath: [], resolved: [], missing: [], conflicts: [], errors: [] };
      }
      resolvingProjectRef.current = projectKey;
      depStore().startResolve(projectKey);
      store().pushOutput({ kind: 'info', text: `Resolving ${coords.length} Java dependenc${coords.length === 1 ? 'y' : 'ies'}…` });
      const res = await localRun.resolveJavaDeps({ coordinates: coords, offline, requestId: `proj-${Date.now()}` });
      depStore().finishResolve(projectKey, res, { offline: Boolean(res?.fromCacheOnly) });
      if (!res?.ok) {
        const problems = [
          ...(res?.errors || []).map((e) => `${e.coordinate ? `${e.coordinate}: ` : ''}${e.message || 'error'}`),
          ...(res?.missing || []).map((m) => `${m.coordinate}: ${m.reason}`),
        ];
        for (const p of problems) store().pushOutput({ kind: 'fail', text: `✗ dependency — ${p}` });
      } else {
        store().pushOutput({
          kind: 'ok',
          text: `✓ ${res?.resolved?.length || coords.length} dependency JAR(s) on the classpath${res?.fromCacheOnly ? ' (offline cache)' : ''}`,
        });
      }
      resolvingProjectRef.current = null;
      return res;
    },
    [store, depStore],
  );

  // Desktop resolve is run for a single project at a time; route progress pushes
  // to whichever project currently owns the resolving ref.
  useEffect(() => {
    if (!localRun.isDesktopJavaDeps()) return undefined;
    const off = localRun.onJavaDepsProgress((payload) => {
      const projectKey = resolvingProjectRef.current;
      if (!projectKey || !payload) return;
      depStore().setProgress(projectKey, {
        phase: payload.phase,
        message: payload.message,
        completed: payload.completed,
        total: payload.total,
      });
    });
    return () => {
      try {
        off?.();
      } catch {
        /* ignore */
      }
    };
  }, [depStore]);

  /**
   * The run path reuses the same resolve core. Only reached when the project has
   * explicitly-added coordinates; otherwise it is a no-op returning [] so an
   * unmodified dependency-free Java run behaves exactly as before.
   */
  const resolveJavaClasspathForRun = useCallback(
    async (doc) => {
      const res = await resolveJavaProject(javaProjectKey(doc));
      return res?.classpath || [];
    },
    [resolveJavaProject],
  );

  /** Re-scan the project's open Java files and refresh detection suggestions. */
  const detectJavaProjectImports = useCallback(
    (doc) => {
      const analysis = detectJavaImports(doc);
      const projectKey = javaProjectKey(doc || store().docs[store().activePath]);
      depStore().setDetection(projectKey, analysis);
      return analysis;
    },
    [store, depStore, detectJavaImports],
  );

  /** Drop cached JARs for the given coordinates (never wipes the whole repo). */
  const clearJavaProjectCache = useCallback(
    async (coordinates = []) => localRun.clearJavaDepsCache(coordinates),
    [],
  );

  /** Read the shared ~/.m2 cache state for the panel's offline indicator. */
  const javaDepsCacheStatus = useCallback(() => localRun.javaDepsStatus(), []);

  // ---- run locally inside the desktop app (no server, no network) ----
  const runLocal = useCallback(
    async (doc, key, executionId = store().activeExecution?.id) => {
      if (!executionId || !store().isExecutionCurrent(executionId)) return { ok: false, stale: true };
      store().setBottomTab('output');
      store().pushOutput({ kind: 'cmd', text: `$ local ${key} · ${doc.name}`, executionId, sourcePath: doc.path });
      store().setRunState('running');
      const feed = makeLineFeeder(executionId, doc.path);
      let finished = false;

      const onEvent = (event) => {
        if (!store().isExecutionCurrent(executionId)) return;
        if (event.type === 'stdout') feed('out', event.data);
        else if (event.type === 'stderr') feed('err', event.data);
        else if (event.type === 'info') store().pushOutput({ kind: 'info', text: String(event.data).replace(/\n+$/, ''), executionId, sourcePath: doc.path });
        else if (event.type === 'error') store().pushOutput({ kind: 'fail', text: `✗ ${String(event.data).replace(/\n+$/, '')}`, executionId, sourcePath: doc.path });
        else if (event.type === 'exit') {
          finished = true;
          feed.flush();
          if (event.timedOut) store().pushOutput({ kind: 'fail', text: '✗ Timed out — the local time limit stopped it', executionId, sourcePath: doc.path });
          else if (event.stopped) store().pushOutput({ kind: 'muted', text: '⏹ Stopped', executionId, sourcePath: doc.path });
          else if (event.code === 0) store().pushOutput({ kind: 'ok', text: '✓ Finished · exit 0', executionId, sourcePath: doc.path });
          else store().pushOutput({ kind: 'fail', text: `✗ Runtime error · exit ${event.code ?? 'unknown (killed)'}`, executionId, sourcePath: doc.path });
          store().finishExecution(executionId);
        }
      };

      // A saved, unmodified file runs in place (so its imports and sibling data
      // files resolve next to it). A buffer with unsaved edits must never run
      // stale disk contents, so it is executed as the current editor text via a
      // throwaway temp copy instead.
      const isDirtyBuffer = doc.content !== doc.savedContent;
      const savedFile = !isDirtyBuffer && doc.untitled !== true && !isUntitled(doc.path) ? doc.path : null;
      // Where the document lives on disk, even when the buffer is dirty: that is
      // how a multi-file C++ project is still found for an unsaved `main.cpp`
      // (the temp copy alone has no siblings to compile and link against).
      const projectPath = doc.untitled === true || isUntitled(doc.path) ? null : doc.path;
      // Java on desktop resolves its explicitly-added dependencies onto the
      // classpath here; every other language (and dependency-free Java) is
      // untouched because the helper no-ops when nothing was added, so the run
      // payload stays exactly as it was (no empty classpath key).
      const javaClasspath = key === 'java' ? await resolveJavaClasspathForRun(doc) : [];
      const runArgs = {
        language: key,
        sourceCode: doc.content,
        filePath: savedFile,
        jdkPath: store().lspJdkPaths?.[doc.language] || null,
        compilerPath: store().compilerPaths?.[doc.language] || null,
        projectPath,
        workspaceRoot: store().root || null,
      };
      if (javaClasspath.length) runArgs.classpath = javaClasspath;
      const res = await localRun.startLocalRun(runArgs, onEvent);
      if (!store().isExecutionCurrent(executionId)) return { ok: false, stale: true };
      if (!res.ok) {
        store().pushOutput({ kind: 'fail', text: `✗ ${res.message || 'Local run could not start.'}`, executionId, sourcePath: doc.path });
        store().finishExecution(executionId);
        // A missing toolchain (`RUNTIME_MISSING`, `CPP_COMPILER_MISSING`,
        // `JDK_MISSING`, …) is a different situation from a broken program:
        // the file is runnable, only this machine lacks the tool. Say so up to
        // the caller, which can offer the other provider — but never switch to
        // it by itself.
        return { ok: false, missingToolchain: Boolean(res.code && /_MISSING$/.test(res.code)) };
      }
      if (!res.finished) store().setRunHandle({ mode: 'local', sessionId: res.sessionId, executionId, language: key, name: doc.name });
      return { ok: true, missingToolchain: false };
    },
    [store, makeLineFeeder, resolveJavaClasspathForRun],
  );

  // ---- run locally in the integrated terminal ("Run in Terminal") ----
  /**
   * Ask the main process for the *same* command line the managed Output run
   * would execute and type it into a fresh integrated terminal session. Only a
   * saved, unmodified file can go this way (a shell runs the real file, not an
   * unsaved buffer). Returns `handled: false` — so the caller can fall back to
   * the managed Output run — when the file is not runnable in a terminal or the
   * path cannot be safely written into a shell command line.
   */
  const runLocalInTerminal = useCallback(
    async (doc, key, executionId = store().activeExecution?.id) => {
      const isDirtyBuffer = doc.content !== doc.savedContent;
      const savedFile = !isDirtyBuffer && doc.untitled !== true && !isUntitled(doc.path) ? doc.path : null;
      const projectPath = doc.untitled === true || isUntitled(doc.path) ? null : doc.path;
      if (!savedFile) {
        return { handled: false, note: 'An unsaved buffer runs in the Output panel (a terminal needs the real file on disk).' };
      }
      const termArgs = {
        language: key,
        filePath: savedFile,
        jdkPath: store().lspJdkPaths?.[doc.language] || null,
        compilerPath: store().compilerPaths?.[doc.language] || null,
        projectPath,
        workspaceRoot: store().root || null,
      };
      // Only a real, resolved classpath is attached, so a dependency-free or
      // non-Java terminal run sends the identical command request it always did.
      const javaClasspath = key === 'java' ? await resolveJavaClasspathForRun(doc) : [];
      if (javaClasspath.length) termArgs.classpath = javaClasspath;
      const res = await localRun.buildTerminalCommand(termArgs);
      if (!res?.ok) {
        // A path that cannot be safely written into a shell, or an unsaved file:
        // fall back to the managed run. A missing toolchain is surfaced instead.
        if (res?.code === 'TERMINAL_UNSAFE_PATH' || res?.code === 'NOT_SAVED') {
          return { handled: false, note: res.message };
        }
        return {
          handled: true,
          missingToolchain: Boolean(res?.code && /_MISSING$/.test(res.code)),
          failMessage: res?.message || 'Could not prepare the terminal command.',
        };
      }
      // Sequential steps (compile && run) mirror the managed plan exactly.
      const command = (res.commands || []).join(' && ');
      store().requestTerminalLaunch({
        cwd: res.cwd,
        extraPathDirs: res.extraPathDirs || [],
        command,
        executionId,
      });
      store().setBottomTab('terminal');
      return { handled: true };
    },
    [store, resolveJavaClasspathForRun],
  );

  // ---- run the active file through the backend provider ----
  const runRemote = useCallback(
    async (doc, executionId = store().activeExecution?.id) => {
      if (!executionId || !store().isExecutionCurrent(executionId)) return { ok: false, stale: true };
      const key = runKeyFor(doc.path);
      if (!key) {
        store().setBottomTab('output');
        // The list comes from the capability registry, so this message can never
        // claim fewer (or more) offline runners than the app actually has.
        const locals = localRunLanguages().map((l) => l.label).join(', ');
        store().pushOutput({
          kind: 'fail',
          text: `No runner configured for "${doc.language}". ${workspace.mode === 'desktop' ? `The desktop app runs ${locals} locally — use the terminal for anything else.` : 'Use the terminal (desktop) instead.'}`,
          executionId,
          sourcePath: doc.path,
        });
        store().finishExecution(executionId);
        return;
      }
      // Be explicit about the backend dependency instead of firing a request that
      // cannot resolve (the packaged app has no dev proxy).
      const remote = remoteRunAvailability();
      if (!remote.ok) {
        store().setBottomTab('output');
        store().pushOutput({ kind: 'fail', text: `✗ ${remote.message}`, executionId, sourcePath: doc.path });
        store().finishExecution(executionId);
        return;
      }

      store().setBottomTab('output');
      store().pushOutput({ kind: 'cmd', text: `$ run ${key} · ${doc.name} · via ${remote.target}`, executionId, sourcePath: doc.path });
      store().setRunState('running');
      // Track the in-flight request so Stop can abort it and the panel can say
      // honestly that this run is remote (its process is not ours to terminate).
      store().setRunHandle({ mode: 'remote', sessionId: null, executionId, language: key, name: doc.name });
      const abort = new AbortController();
      runAbort.current = abort;
      // Wandbox/Piston are batch providers: they take the whole stdin up front
      // in one request and run to completion. The Output panel stages a pre-run
      // stdin for exactly this — send it, ensuring a trailing newline so the last
      // line is a complete read rather than hanging on a missing EOF.
      const staged = String(store().runStdin ?? '');
      const stdin = staged && !staged.endsWith('\n') ? `${staged}\n` : staged;
      try {
        const r = await api.run({ language: key, sourceCode: doc.content, stdin, signal: abort.signal });
        if (r.compileMessage && r.status !== 'completed') store().pushOutput({ kind: 'compile', text: String(r.compileMessage).trim(), executionId, sourcePath: doc.path });
        if (r.stdout) store().pushOutput({ kind: 'out', text: String(r.stdout).replace(/\n+$/, ''), executionId, sourcePath: doc.path });
        // A program may report its failure on stdout only (verified: PHP parse
        // errors arrive as program_output), so keep it visible on a real failure.
        if (r.stderr && r.status !== 'compile_error') store().pushOutput({ kind: 'err', text: String(r.stderr).replace(/\n+$/, ''), executionId, sourcePath: doc.path });
        if (!r.stdout && !r.stderr && r.status === 'completed') store().pushOutput({ kind: 'muted', text: '(no output)', executionId, sourcePath: doc.path });
        const time = typeof r.executionTimeMs === 'number' ? ` · ${r.executionTimeMs}ms` : '';
        if (r.success) store().pushOutput({ kind: 'ok', text: `✓ Finished${time} · exit ${r.exitCode ?? 0}`, executionId, sourcePath: doc.path });
        else if (r.status === 'compile_error') store().pushOutput({ kind: 'fail', text: '✗ Compilation failed', executionId, sourcePath: doc.path });
        else if (r.inputRequired) store().pushOutput({ kind: 'info', text: 'Input was required but no value was provided. Enter one line per input read in the Standard input (pre-run) box, then run again. Live typing is unavailable because this server is using batch execution.', executionId, sourcePath: doc.path });
        else if (r.status === 'timeout') store().pushOutput({ kind: 'fail', text: '✗ Timed out', executionId, sourcePath: doc.path });
        else store().pushOutput({ kind: 'fail', text: `✗ Runtime error · exit ${r.exitCode ?? 'n/a'}`, executionId, sourcePath: doc.path });
      } catch (e) {
        if (!store().isExecutionCurrent(executionId)) return;
        store().pushOutput({ kind: 'fail', text: `✗ ${e.message || 'Execution failed.'}`, executionId, sourcePath: doc.path });
        if (e.code === 'NETWORK') {
          // The offline list is read from the capability registry, so this
          // sentence cannot drift from the runners the app really has.
          const locals = localRunLanguages().map((l) => l.label).join(', ');
          store().pushOutput({ kind: 'muted', text: `The API server at ${remote.target} did not answer. Online execution needs it running — in the desktop app these run without any server: ${locals}.`, executionId, sourcePath: doc.path });
        }
      } finally {
        if (runAbort.current === abort) runAbort.current = null;
        store().finishExecution(executionId);
      }
    },
    [store],
  );

  // ---- run a native file as a live server process (Web Mode, interactive) ----
  /**
   * Reuses the Editor Terminal's proven interactive transport for the IDE: the
   * program runs as a real child process on the API server and streams I/O over
   * the shared WebSocket, so `input()`/`cin`/`Scanner.nextLine()` block until the
   * user answers in the Output panel's stdin line. This is used only when the
   * server reported the language's runtime is available (never assumed) —
   * otherwise the caller falls back to the batch provider.
   */
  const runInteractiveWeb = useCallback(
    async (doc, key, executionId = store().activeExecution?.id) => {
      if (!executionId || !store().isExecutionCurrent(executionId)) return { ok: false, stale: true };
      store().setBottomTab('output');
      store().setRunState('running');
      store().setRunHandle({ mode: 'interactive', sessionId: null, executionId, language: key, name: doc.name });
      interactiveOutput.current = createInteractiveOutputBuffer(({ kind, text, replace, stream }) => {
        const map = { out: 'out', err: 'err', compile: 'compile', info: 'info', input: 'input' };
        store().pushOutput({ kind: map[kind] || kind, text, executionId, sourcePath: doc.path, replace, stream });
      });
      store().pushOutput({ kind: 'cmd', text: `$ run ${key} · ${doc.name} · interactive (live server process)`, executionId, sourcePath: doc.path });
      store().pushOutput({ kind: 'info', text: 'Answer prompts in the stdin line below — each Enter sends one line to the running process.', executionId, sourcePath: doc.path });
      const onMessage = (msg) => {
        if (!store().isExecutionCurrent(executionId)) return;
        switch (msg.type) {
          case 'stdout': interactiveOutput.current?.feed('out', msg.data); break;
          case 'stderr': interactiveOutput.current?.feed('err', msg.data); break;
          case 'compile': interactiveOutput.current?.feed('compile', msg.data); break;
          case 'info': interactiveOutput.current?.feed('info', msg.data); break;
          case 'stdin':
            interactiveOutput.current?.flush();
            interactiveOutput.current?.feed('input', `> ${String(msg.data ?? '').replace(/\r?\n$/, '')}\n`);
            break;
          case 'error': store().pushOutput({ kind: 'fail', text: `✗ ${String(msg.data ?? '').trim()}`, executionId, sourcePath: doc.path }); break;
          case 'exit': {
            interactiveOutput.current?.flush();
            if (msg.stopped) store().pushOutput({ kind: 'muted', text: '⏹ Stopped', executionId, sourcePath: doc.path });
            else if (typeof msg.code === 'number')
              store().pushOutput({ kind: msg.code === 0 ? 'ok' : 'fail', text: msg.code === 0 ? '✓ Finished · exit 0' : `✗ Runtime error · exit ${msg.code}`, executionId, sourcePath: doc.path });
            break;
          }
          default:
            break;
        }
      };
      const session = startInteractiveSession({
        language: key,
        sourceCode: doc.content,
        onMessage,
        onOpen: () => {
          if (store().isExecutionCurrent(executionId)) store().pushOutput({ kind: 'muted', text: '● live · type input when the program asks', executionId, sourcePath: doc.path });
        },
      });
      interactiveSession.current = session;
      await session.closed;
      interactiveOutput.current?.flush();
      if (interactiveSession.current === session) interactiveSession.current = null;
      store().finishExecution(executionId);
    },
    [store],
  );

  // ---- run JavaScript in this page's own engine (web mode, no server) ----
  /**
   * The browser has a real JavaScript engine, so a plain-JS program needs no
   * server and no desktop bridge. Anything Node-only is *not* quietly run in a
   * browser engine pretending to be Node: the user is told the difference and
   * the API server (which does run Node) is offered, never taken automatically.
   */
  const runBrowser = useCallback(
    async (doc, executionId = store().activeExecution?.id) => {
      if (!executionId || !store().isExecutionCurrent(executionId)) return { ok: false, stale: true };
      store().setBottomTab('output');
      const nodeApis = nodeApiUsage(doc.content);
      const bare = bareImportSpecifiers(doc.content);
      if (nodeApis.length || bare.length) {
        const why = [];
        if (nodeApis.length) why.push(`uses Node.js APIs (${nodeApis.join(', ')})`);
        if (bare.length) why.push(`imports npm package(s) ${bare.join(', ')} without an import map`);
        store().pushOutput({
          kind: 'cmd',
          text: `$ run browser-javascript · ${doc.name}`,
          executionId,
          sourcePath: doc.path,
        });
        store().pushOutput({
          kind: 'fail',
          text: `✗ Not runnable in the browser: this file ${why.join(' and ')}. A web page has no Node.js — no require(), no process, no installed packages.`,
          executionId,
          sourcePath: doc.path,
        });
        const remote = remoteRunAvailability();
        if (remote.ok && runKeyFor(doc.path)) {
          const useServer = window.confirm(
            `Run "${doc.name}" through the API server instead?\n\nThe server executes it as Node.js, which does have the APIs it uses. That needs the backend at ${remote.target} to be running and reachable.`,
          );
          if (useServer) await runRemote(doc, executionId);
          else store().pushOutput({ kind: 'muted', text: 'Stayed in the browser: nothing ran.', executionId, sourcePath: doc.path });
        } else {
          store().pushOutput({ kind: 'muted', text: `No API server is configured (${remote.message}). Desktop Mode runs these with the local Node.js.`, executionId, sourcePath: doc.path });
        }
        store().finishExecution(executionId);
        return;
      }

      store().pushOutput({ kind: 'cmd', text: `$ run browser-javascript · ${doc.name} · in-page sandbox (no server, not Node.js)`, executionId, sourcePath: doc.path });
      // Honest hint (no source rewriting): the browser has no synchronous input
      // dialog, so prompt()/confirm()/alert() resolve as Promises. A program
      // that reads one without `await` prints `[object Promise]`; tell the user
      // exactly how to fix it rather than letting a wrong value look like a bug.
      const unawaited = unawaitedDialogUsage(doc.content);
      if (unawaited.length) {
        store().pushOutput({
          kind: 'info',
          text: `Note: this program calls ${unawaited.map((d) => `${d}()`).join(', ')} without awaiting it. In the browser those return a Promise, so an un-awaited read yields [object Promise]. Write \`const x = await ${unawaited[0]}("…")\` to receive the typed answer.`,
          executionId,
          sourcePath: doc.path,
        });
      }
      store().setRunState('running');
      // A per-run token correlates every prompt with this execution: an answer
      // tagged for another run is rejected, and stopping the run strands no
      // prompt. The bridge resolves only once the user submits or cancels, so a
      // waiting program is never frozen behind a modal dialog.
      const runToken = newRunToken();
      store().setRunHandle({ mode: 'browser', sessionId: runToken, executionId, language: 'javascript', name: doc.name });
      const requestInput = ({ token, promptId, kind, message }) => {
        if (message && store().isExecutionCurrent(executionId)) store().pushOutput({ kind: 'prompt', text: String(message).replace(/\n+$/, ''), executionId, sourcePath: doc.path });
        return store().requestRunPrompt({ token, promptId, kind, message });
      };
      const abort = new AbortController();
      runAbort.current = abort;
      try {
        const r = await runBrowserJavaScript({
          source: doc.content,
          signal: abort.signal,
          name: doc.name,
          token: runToken,
          requestInput,
          timeoutMs: 30000,
        });
        if (r.code) {
          store().pushOutput({ kind: 'fail', text: `✗ ${r.message}`, executionId, sourcePath: doc.path });
          return;
        }
        if (r.compileMessage && r.status !== 'completed') store().pushOutput({ kind: 'compile', text: String(r.compileMessage).trim(), executionId, sourcePath: doc.path });
        if (r.stdout) store().pushOutput({ kind: 'out', text: String(r.stdout).replace(/\n+$/, ''), executionId, sourcePath: doc.path });
        if (r.stderr && r.status !== 'compile_error') store().pushOutput({ kind: 'err', text: String(r.stderr).replace(/\n+$/, ''), executionId, sourcePath: doc.path });
        if (!r.stdout && !r.stderr && r.status === 'completed') store().pushOutput({ kind: 'muted', text: '(no output)', executionId, sourcePath: doc.path });
        const time = typeof r.executionTimeMs === 'number' ? ` · ${r.executionTimeMs}ms` : '';
        if (r.success) store().pushOutput({ kind: 'ok', text: `✓ Finished in the browser${time}`, executionId, sourcePath: doc.path });
        else if (r.status === 'compile_error') store().pushOutput({ kind: 'fail', text: '✗ Could not load the module', executionId, sourcePath: doc.path });
        else if (r.status === 'timeout') store().pushOutput({ kind: 'fail', text: `✗ ${r.message || 'Timed out'}`, executionId, sourcePath: doc.path });
        else if (r.status === 'canceled') store().pushOutput({ kind: 'muted', text: 'Canceled.', executionId, sourcePath: doc.path });
        else store().pushOutput({ kind: 'fail', text: '✗ Runtime error', executionId, sourcePath: doc.path });
      } finally {
        if (runAbort.current === abort) runAbort.current = null;
        store().finishExecution(executionId);
      }
    },
    [store, runRemote],
  );

  // ---- run the active file: local (desktop) first, provider otherwise ----
  const runActive = useCallback(async () => {
    if (store().runState === 'running') return; // one execution at a time
    const doc = store().docs[store().activePath];
    if (!doc) {
      notif.info('Open a file to run.');
      return;
    }
    if (!doc.content.trim()) {
      store().setBottomTab('output');
      store().pushOutput({ kind: 'fail', text: 'Source code is empty.' });
      return;
    }
    const executionId = store().beginExecution({ sourcePath: doc.path, name: doc.name });

    // Desktop first: a language the main process can run locally never reaches
    // for the network, so "Run" keeps working with the cable unplugged.
    const localKey = workspace.mode === 'desktop' ? localRunKeyFor(doc.language) : null;
    if (localKey && localRun.isDesktopLocalRun()) {
      // Run Mode: a real integrated terminal running the identical command, when
      // the user chose it and the file can go that way; otherwise the managed
      // Output run. The choice never starts a second, divergent build system.
      if (store().runMode === 'terminal') {
        const inTerm = await runLocalInTerminal(doc, localKey);
        if (inTerm.handled) {
          if (inTerm.missingToolchain) {
            store().setBottomTab('output');
            store().pushOutput({ kind: 'fail', text: `✗ ${inTerm.failMessage}` });
          }
          store().finishExecution(executionId);
          return;
        }
        // Not runnable in a terminal (unsaved / unsafe path): say so, then run
        // through the managed panel so the user's Run still does something.
        if (inTerm.note) {
          store().setBottomTab('output');
          store().pushOutput({ kind: 'muted', text: `Run in Terminal: ${inTerm.note} Running in the Output panel instead.` });
        }
      }
      const outcome = await runLocal(doc, localKey, executionId);
      if (outcome.ok) return;
      // The offline tool is missing. The online runner is a *different
      // provider* with different requirements, so it is offered — never taken
      // behind the user's back.
      if (outcome.missingToolchain && runKeyFor(doc.path)) {
        const label = capabilityForMonacoLanguage(doc.language)?.label || doc.language;
        const useOnline = window.confirm(
          `${label} has no working toolchain on this machine, so it cannot run offline.\n\nRun it through the online runner instead? That needs the API server and an internet connection.`,
        );
        if (useOnline) {
          await runRemote(doc, executionId);
          return;
        }
        store().pushOutput({ kind: 'muted', text: 'Staying offline: install the toolchain (or set its path in the Languages view) and Run again.' });
      }
      return;
    }

    // No desktop bridge and no local toolchain: the browser's own engine is the
    // next thing that genuinely runs this, and only JavaScript can go that way.
    if (workspace.mode === 'web' && isBrowserRunnable(doc.language)) {
      await runBrowser(doc, executionId);
      return;
    }

    // A native language: run it as a live server process over the shared
    // interactive transport — the same proven behavior the Editor Terminal uses —
    // but only when the server has actually confirmed the toolchain is present.
    // Otherwise fall back to the batch provider. Never claim interactive the
    // backend has not offered.
    if (workspace.mode === 'web') {
      const key = runKeyFor(doc.path);
      // Honest capability report: Web Mode's execution provider cannot place
      // arbitrary Maven artifacts on the classpath. Detect real external Java
      // imports and say so plainly instead of pretending a run will resolve them.
      // Dependency-free Java has no external imports, so it is never nagged.
      if (key === 'java') {
        const analysis = detectJavaImports(doc);
        const external = (analysis.unresolved || []).filter((r) => r.kind === 'catalog' || r.kind === 'unknown');
        if (external.length) {
          store().setBottomTab('output');
          store().pushOutput({ kind: 'muted', text: `\u26a0 Java in Web Mode cannot add Maven dependencies \u2014 this program imports ${external.length} external package(s).` });
          store().pushOutput({ kind: 'muted', text: `  Unresolved: ${external.map((e) => e.fqn).join(', ')}` });
          store().pushOutput({ kind: 'muted', text: '  The configured Web execution provider does not download libraries. Open this project in Desktop Mode and use the Java Dependencies panel (Add \u2192 Resolve) to compile and run it.' });
        }
      }
      const inter = store().interactiveStatus;
      if (key && inter?.enabled && inter?.runtimes?.[key]?.available) {
        await runInteractiveWeb(doc, key, executionId);
        return;
      }
    }

    await runRemote(doc, executionId);
  }, [notif, store, runLocal, runLocalInTerminal, runRemote, runBrowser, runInteractiveWeb, detectJavaImports]);

  // ---- stop whatever is running (local child process or in-flight request) ----
  const stopActiveRun = useCallback(async () => {
    const handle = store().runHandle;
    if (handle?.mode === 'local') {
      store().pushOutput({ kind: 'muted', text: 'Stopping…', executionId: handle.executionId });
      const res = await localRun.stopLocalRun(handle.sessionId);
      if (!res?.ok && res?.code !== 'NO_SESSION') store().pushOutput({ kind: 'fail', text: `✗ ${res?.message || 'Could not stop the run.'}`, executionId: handle.executionId });
      store().finishExecution(handle.executionId);
      return res;
    }
    if (handle?.mode === 'interactive') {
      // A live server process: ask it to SIGKILL the child and drop the socket.
      store().pushOutput({ kind: 'muted', text: 'Stopping…', executionId: handle.executionId });
      const session = interactiveSession.current;
      interactiveSession.current = null;
      interactiveOutput.current?.flush();
      session?.stop();
      store().finishExecution(handle.executionId);
      return { ok: true };
    }
    if (runAbort.current) {
      runAbort.current.abort();
      // Invalidate the current execution immediately. This clears pending
      // prompts and prevents late remote events from reaching the next run;
      // the request's finally block remains idempotent.
      store().finishExecution(handle?.executionId || store().activeExecution?.id);
      store().pushOutput({ kind: 'muted', text: 'Cancel requested — the remote program keeps running until the provider stops it.', executionId: handle?.executionId });
      return { ok: true };
    }
    store().finishExecution(handle?.executionId || store().activeExecution?.id);
    return { ok: true };
  }, [store]);

  // ---- feed stdin to the running local program ----
  const sendRunInput = useCallback(
    async (line) => {
      const handle = store().runHandle;
      const text = String(line ?? '');
      // A live Web-Mode interactive session: pipe the line straight to the
      // running process, exactly like the Editor Terminal's interactive mode.
      if (handle?.mode === 'interactive' && interactiveSession.current) {
        interactiveSession.current.sendStdin(text.endsWith('\n') ? text : `${text}\n`);
        return { ok: true };
      }
      if (!handle || handle.mode !== 'local') {
        notif.info('stdin is only available for a running interactive or local desktop program.');
        return { ok: false };
      }
      store().pushOutput({ kind: 'input', text: `> ${text.replace(/\n+$/, '')}`, executionId: handle.executionId });
      return localRun.sendLocalRunStdin(handle.sessionId, text.endsWith('\n') ? text : `${text}\n`);
    },
    [notif, store],
  );

  // ---- answer the browser JS runner's pending prompt (in-panel input) ----
  // The value is echoed to the output first, then handed back to the awaiting
  // sandbox — and only if it matches the run/prompt still on screen (stale or
  // misrouted answers are rejected by the store).
  const answerPendingPrompt = useCallback(
    (value) => {
      const rp = store().runPrompt;
      if (!rp) return false;
      const executionId = store().activeExecution?.id;
      if (rp.kind === 'confirm') store().pushOutput({ kind: 'input', text: `> ${value ? 'OK' : 'Cancel'}`, executionId });
      else if (rp.kind === 'alert') store().pushOutput({ kind: 'input', text: '> (dismissed)', executionId });
      else store().pushOutput({ kind: 'input', text: `> ${value == null ? '' : String(value).replace(/\n+$/, '')}`, executionId });
      return store().answerRunPrompt(value, { token: rp.token, promptId: rp.promptId });
    },
    [store],
  );

  // EOF / cancel for the current prompt: resolve null so the program continues
  // (or exits) instead of hanging forever on an unanswered read.
  const cancelPendingPrompt = useCallback(() => {
    const rp = store().runPrompt;
    if (!rp) return false;
    store().pushOutput({ kind: 'input', text: '> (canceled — EOF)', executionId: store().activeExecution?.id });
    return store().answerRunPrompt(null, { token: rp.token, promptId: rp.promptId });
  }, [store]);

  // ---- stage pre-run stdin for a batch (remote) run ----
  const setRunStdin = useCallback((value) => store().setRunStdin(value), [store]);

  // ---- explicit "run this way once" actions (both workflows always reachable) ----
  // The default is the persisted Run Mode setting, but the palette / menu can
  // force either path without changing the user's saved preference.
  const runActiveInTerminal = useCallback(async () => {
    if (store().runState === 'running') return;
    const doc = store().docs[store().activePath];
    if (!doc) {
      notif.info('Open a file to run.');
      return;
    }
    const localKey = workspace.mode === 'desktop' ? localRunKeyFor(doc.language) : null;
    if (!localKey || !localRun.isDesktopLocalRun()) {
      store().setBottomTab('output');
      store().pushOutput({ kind: 'muted', text: 'Run in Terminal only applies to a language the desktop app runs locally. Using the normal Run path.' });
      await runActive();
      return;
    }
    const executionId = store().beginExecution({ sourcePath: doc.path, name: doc.name, mode: 'terminal' });
    const inTerm = await runLocalInTerminal(doc, localKey, executionId);
    if (inTerm.handled) {
      store().finishExecution(executionId);
      return;
    }
    if (!inTerm.handled) {
      store().setBottomTab('output');
      if (inTerm.note) store().pushOutput({ kind: 'muted', text: `Run in Terminal: ${inTerm.note} Running in the Output panel instead.` });
      await runLocal(doc, localKey, executionId);
    }
  }, [notif, store, runActive, runLocal, runLocalInTerminal]);

  const runActiveInOutput = useCallback(async () => {
    const doc = store().docs[store().activePath];
    const localKey = workspace.mode === 'desktop' ? localRunKeyFor(doc?.language) : null;
    // Managed Output path regardless of the persisted Run Mode setting.
    if (localKey && localRun.isDesktopLocalRun() && doc) {
      if (store().runState === 'running') return;
      if (!doc.content.trim()) {
        store().setBottomTab('output');
        store().pushOutput({ kind: 'fail', text: 'Source code is empty.' });
        return;
      }
      const executionId = store().beginExecution({ sourcePath: doc.path, name: doc.name });
      await runLocal(doc, localKey, executionId);
      return;
    }
    await runActive();
  }, [store, runActive, runLocal]);

  return {
    editorRef,
    monacoRef,
    setEditorHandles,
    openWorkspace,
    importFolder,
    openFileByPath,
    refreshFileFromDisk,
    revealInEditor,
    saveActive,
    saveAs,
    closeTab,
    formatActive,
    lintActive,
    applyMarkers,
    runActive,
    runActiveInTerminal,
    runActiveInOutput,
    stopActiveRun,
    sendRunInput,
    answerPendingPrompt,
    cancelPendingPrompt,
    setRunStdin,
    refreshLocalRuntimes,
    createFile,
    createDirectory,
    rename,
    remove,
    newUntitled,
    // Java dependency management (Desktop Mode resolves; Web Mode is honest).
    detectJavaProjectImports,
    resolveJavaProject,
    clearJavaProjectCache,
    javaDepsCacheStatus,
  };
}

export default useIdeActions;
