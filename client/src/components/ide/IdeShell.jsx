import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, FilePlus2, Command as CommandIcon, Search as SearchIcon, Sparkles, PanelLeftOpen, Play, Eraser } from 'lucide-react';

import { useIdeStore } from '../../store/ideStore.js';
import { useEditorPrefs } from '../../hooks/useEditorPrefs.js';
import { useIdeTheme } from '../../hooks/useIdeTheme.js';
import { useIdeActions } from '../../hooks/useIdeActions.js';
import { useProjectModel } from '../../hooks/useProjectModel.js';
import { workspace } from '../../services/workspace.js';
import { detectJavaProjectMode } from '../../services/javaProject.js';
import { createExtensionRuntime } from '../../extensions/runtime.js';
import { activeExtensionIds, EXTENSIONS } from '../../extensions/registry.js';
import { registerSnippetProviders } from '../../languages/snippets.js';
import { lspDescriptorForMonacoLanguage } from '../../languages/languageCapabilities.js';
import { attachLspSession, pathToUri, sameUri } from '../../monaco/lspClient.js';
import { lspStatus, lspStop as lspStopBridge } from '../../services/lsp.js';
import * as previewSvc from '../../services/preview.js';
import LivePreviewPanel from './LivePreviewPanel.jsx';

import ActivityBar from './ActivityBar.jsx';
import SidebarView from './SidebarView.jsx';
import TopMenu from './TopMenu.jsx';
import EditorTabs from './EditorTabs.jsx';
import MonacoHost from './MonacoHost.jsx';
import BottomPanel from './BottomPanel.jsx';
import StatusBar from './StatusBar.jsx';
import AiChatPanel from './AiChatPanel.jsx';
import Resizer from './Resizer.jsx';
import CommandOverlay from './CommandOverlay.jsx';
import PromptModal from '../ui/PromptModal.jsx';
import { useUserAuth } from '../../context/UserAuthContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

async function listAll(dir, cap = 3000) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < cap) {
    const d = stack.pop();
    const res = await workspace.readDirectory(d);
    if (!res.ok) continue;
    for (const e of res.entries) {
      if (e.isDirectory) stack.push(e.path);
      else if (out.length < cap) out.push(e.path);
    }
  }
  return out;
}

/**
 * 'standalone' vs 'project' for a Java file (see services/javaProject.js):
 * it decides whether the language server imports a build descriptor.
 */

export default function IdeShell() {
  const store = useIdeStore();
  const { user } = useUserAuth();
  const { user: adminUser } = useAuth();
  const aiAccessMode = adminUser?.authenticated ? 'admin' : user ? 'user' : 'guest';
  const navigate = useNavigate();
  const { prefs } = useEditorPrefs();
  const { isDark, themeId, cycleTheme } = useIdeTheme();
  const actions = useIdeActions();

  // Web Mode reads the project the workspace declares (package.json, tsconfig)
  // and reports what it means as real diagnostics; Desktop Mode leaves it to
  // the actual toolchain and language server.
  useProjectModel({ applyMarkers: actions.applyMarkers });

  const [cursor, setCursor] = useState(null);
  const [overlay, setOverlay] = useState(null); // null | 'command' | 'file'
  const [paletteFiles, setPaletteFiles] = useState([]);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const lintTimer = useRef(0);
  const extRuntime = useRef(createExtensionRuntime());
  const lastEditor = useRef(null);

  // Web mode has a local virtual workspace — open it immediately so the tree shows.
  useEffect(() => {
    if (workspace.mode === 'web' && !store.root) store.setRoot('/');
  }, [store]);

  // Desktop: a window the main process opened *for a specific folder* reads that
  // folder once (consume-once) and loads it, which is how "Open Workspace" in a
  // new window shows the project the user picked. A normal window has no pending
  // handoff and stays on the Welcome screen.
  useEffect(() => {
    if (workspace.mode !== 'desktop' || !workspace.getInitialWorkspace) return undefined;
    if (useIdeStore.getState().root) return undefined;
    let cancelled = false;
    workspace
      .getInitialWorkspace()
      .then((res) => {
        if (cancelled || !res?.ok || !res.root) return;
        useIdeStore.getState().setRoot(res.root);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Switching workspaces must not leave servers bound to the old one.
  const lastRootRef = useRef(store.root);
  useEffect(() => {
    if (lastRootRef.current !== store.root) {
      if (lastRootRef.current && (store.preview.state === 'running' || store.preview.devState === 'running')) {
        previewSvc.stopEverything();
      }
      lastRootRef.current = store.root;
    }
  }, [store.root, store.preview.state, store.preview.devState]);

  // ---- active doc ----
  const activeDoc = store.activePath ? store.docs[store.activePath] : null;

  // Browser mode: the tab *is* the only copy of an unsaved buffer — a reload or
  // closed tab discards it and the virtual workspace never saw it. Desktop keeps
  // its own window-close handling untouched. The browser shows its standard
  // "changes you made may not be saved" dialog; nothing can be suppressed.
  const hasUnsaved = useIdeStore((s) => s.hasUnsavedChanges());
  useEffect(() => {
    // Best-effort graceful-shutdown flush: give any debounced auto-save the
    // chance to run. Async persistence cannot be *guaranteed* to finish before
    // teardown, so this supplements — never replaces — the dirty-state guard.
    const flush = () => {
      useIdeStore.getState().flushAllAutoSaves();
    };
    // Browser mode: the tab *is* the only copy of an unsaved buffer — a reload
    // or closed tab discards it and the virtual workspace never saw it. Desktop
    // keeps its own window-close handling untouched. The browser shows its
    // standard "changes you made may not be saved" dialog; nothing can suppress it.
    const onUnload = (e) => {
      flush();
      if (workspace.mode !== 'web' || !hasUnsaved) return undefined;
      e.preventDefault();
      e.returnValue = '';
      return undefined;
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [hasUnsaved]);

  const handleChange = useCallback(
    (next) => {
      if (store.activePath) {
        store.updateContent(store.activePath, next);
        // Every keystroke (and undo/redo, which also fires Monaco's onChange)
        // resets this document's debounce; scheduling reads the live setting so
        // toggling Auto Save applies without a restart.
        store.scheduleAutoSave(store.activePath);
      }
    },
    [store],
  );

  // Debounced syntax check for the active file (backend lint for non-JS/TS).
  useEffect(() => {
    if (!activeDoc) return undefined;
    const t = setTimeout(() => actions.lintActive(), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.path, activeDoc?.content]);

  // ---- quick-open file list ----
  const refreshFiles = useCallback(async () => {
    if (!store.root) { setPaletteFiles([]); return; }
    const paths = await listAll(store.root);
    setPaletteFiles(paths.map((p) => ({ id: p, label: p.split(/[\\/]/).pop(), detail: p })));
  }, [store.root]);

  const openQuickOpen = useCallback(async () => {
    await refreshFiles();
    setOverlay('file');
  }, [refreshFiles]);

  const requestAi = useCallback(() => {
    if (adminUser?.authenticated || user) {
      store.toggleRightPanel();
      return;
    }
    navigate('/account/login', { state: { from: '/ide', aiRequired: true } });
  }, [adminUser, navigate, store, user]);

  // ---- commands ----
  const commands = useMemo(() => {
    const c = [
      { id: 'file.new', label: 'File: New File', run: () => store.newUntitled() },
      { id: 'file.save', label: 'File: Save', shortcut: 'Ctrl+S', run: () => actions.saveActive() },
      { id: 'file.saveAs', label: 'File: Save As…', run: () => actions.saveAs() },
      { id: 'file.openWorkspace', label: workspace.mode === 'desktop' ? 'File: Open Workspace…' : 'File: Use Browser Workspace', run: () => actions.openWorkspace() },
      { id: 'file.import', label: 'File: Open Folder…', run: () => actions.importFolder() },
      { id: 'file.close', label: 'File: Close Editor', run: () => store.activePath && actions.closeTab(store.activePath) },
      { id: 'run.active', label: 'Run: Run Active File', shortcut: 'Ctrl+Enter', run: () => actions.runActive() },
      { id: 'run.terminal', label: 'Run: Run Active File in Terminal', run: () => actions.runActiveInTerminal() },
      { id: 'run.output', label: 'Run: Run Active File in Output Panel', run: () => actions.runActiveInOutput() },
      { id: 'preview.golive', label: 'Live Preview: Go Live / Stop (Ctrl+Alt+L)', run: () => previewSvc.toggleGoLive() },
      { id: 'preview.togglePanel', label: 'Live Preview: Toggle Panel', run: () => store.togglePreviewPanel() },
      { id: 'preview.stop', label: 'Live Preview: Stop All Servers', run: () => previewSvc.stopEverything() },
      { id: 'preview.restart', label: 'Live Preview: Restart Static Server', run: () => previewSvc.restartStatic() },
      { id: 'view.sidebar', label: 'View: Toggle Sidebar', run: () => store.toggleSidebar() },
      { id: 'view.panel', label: 'View: Toggle Panel', run: () => store.toggleBottomPanel() },
      { id: 'view.ai', label: aiAccessMode === 'guest' ? 'AI: Sign in to use AI Chat' : aiAccessMode === 'admin' ? 'View: Toggle Admin AI Chat' : 'View: Toggle AI Chat', run: requestAi },
      { id: 'view.extensions', label: 'View: Show Extensions', run: () => store.setActivityView('extensions') },
      // No terminal exists in a browser tab, so the palette must not offer to
      // "show" one; the Output panel is the panel this mode really has.
      ...(workspace.mode === 'desktop'
        ? [{ id: 'view.terminal', label: 'View: Show Terminal', run: () => store.setBottomTab('terminal') }]
        : []),
      { id: 'view.problems', label: 'View: Show Problems', run: () => store.setBottomTab('problems') },
      { id: 'view.output', label: 'View: Show Output', run: () => store.setBottomTab('output') },
      { id: 'search.find', label: 'Search: Find in Files', shortcut: 'Ctrl+Shift+F', run: () => store.setActivityView('search') },
      { id: 'terminal.clear', label: 'Terminal: Clear Output', run: () => store.clearOutput() },
      { id: 'quick.open', label: 'Go to: Quick Open…', shortcut: 'Ctrl+P', run: () => openQuickOpen() },
      { id: 'go.line', label: 'Go to: Line…', run: () => actions.editorRef.current?.getAction('editor.action.gotoLine')?.run() },
      { id: 'editor.format', label: 'Editor: Format Document', run: () => actions.formatActive() },
      { id: 'editor.find', label: 'Editor: Find', run: () => actions.editorRef.current?.getAction('actions.find')?.run() },
      { id: 'theme.cycle', label: 'Preferences: Cycle Color Theme', run: () => cycleTheme() },
      { id: 'explorer.newFile', label: 'Explorer: New File (in selected folder)', run: () => actions.createFile(store.selectedPath && !store.selectedPath.includes('.') ? store.selectedPath : store.root) },
      { id: 'explorer.newFolder', label: 'Explorer: New Folder', run: () => actions.createDirectory(store.selectedPath && !store.selectedPath.includes('.') ? store.selectedPath : store.root) },
      { id: 'explorer.rename', label: 'Explorer: Rename Selected', run: () => store.selectedPath && actions.rename(store.selectedPath) },
      { id: 'explorer.delete', label: 'Explorer: Delete Selected', run: () => store.selectedPath && actions.remove(store.selectedPath) },
    ];
    THEMES_SHORT.forEach((t) =>
      c.push({ id: `theme.${t.id}`, label: `Preferences: Theme — ${t.label}`, run: () => store.setThemeId(t.id) }),
    );
    EXTENSIONS.forEach((e) =>
      c.push({ id: `ext.${e.id}`, label: `Extensions: Toggle ${e.name}`, run: () => store.toggleExtension(e.id) }),
    );
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.activePath, store.selectedPath, store.root, actions, aiAccessMode, cycleTheme, openQuickOpen, requestAi]);

  const onOverlayPick = useCallback(
    (mode, item) => {
      if (mode === 'file') {
        actions.openFileByPath(item.id);
      } else if (item.run) {
        item.run();
      }
    },
    [actions],
  );

  // ---- keyboard shortcuts (single global handler) ----
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      // While the app's text prompt is open it owns the keyboard — otherwise
      // typing in the rename field would also save, run or close a tab.
      if (useIdeStore.getState().prompt) return;
      // Palette first (works without mod).
      if (key === 'F1' || (mod && e.shiftKey && key.toLowerCase() === 'p')) {
        e.preventDefault();
        setOverlay('command');
        return;
      }
      if (mod && e.altKey && key.toLowerCase() === 'l') {
        e.preventDefault();
        previewSvc.toggleGoLive();
        return;
      }
      if (e.shiftKey && e.altKey && key.toLowerCase() === 'f' && !mod) {
        e.preventDefault();
        actions.formatActive();
        return;
      }
      if (!mod && key === 'F2') {
        e.preventDefault();
        if (store.selectedPath) actions.rename(store.selectedPath);
        return;
      }
      if (!mod) return;
      const k = key.toLowerCase();
      if (k === 'p') { e.preventDefault(); openQuickOpen(); }
      else if (k === 's' && !e.shiftKey) { e.preventDefault(); actions.saveActive(); }
      else if (k === 's' && e.shiftKey) { e.preventDefault(); actions.saveAs(); }
      else if (k === 'o') {
        e.preventDefault();
        // Ctrl+O opens a folder in both modes; in the browser that is the File
        // System Access import, not the virtual-root no-op.
        if (workspace.mode === 'desktop') actions.openWorkspace();
        else actions.importFolder();
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault();
        store.setActivityView('search');
      } else if (k === 'n') { e.preventDefault(); store.newUntitled(); }
      else if (k === 'w') { e.preventDefault(); if (store.activePath) actions.closeTab(store.activePath); }
      else if (k === 'b') { e.preventDefault(); store.toggleSidebar(); }
      else if (k === 'j') { e.preventDefault(); store.toggleBottomPanel(); }
      else if (k === 'i') { e.preventDefault(); requestAi(); }
      else if (k === 'enter') { e.preventDefault(); actions.runActive(); }
      else if (key === '`') { e.preventDefault(); store.toggleBottomPanel(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, store, openQuickOpen]);

  const setEditor = useCallback(
    (editor, monaco) => {
      actions.setEditorHandles(editor, monaco);
      // Real snippet CompletionItemProviders for highlighting-only languages
      // (idempotent; the registry's `snippets: true` set).
      registerSnippetProviders(monaco);
      setEditorEpoch((n) => n + 1);
    },
    [actions],
  );

  // ---- apply installed & enabled extensions to the live editor ----
  const activeExtIds = useMemo(() => activeExtensionIds(store.extensions), [store.extensions]);
  useEffect(() => {
    const editor = actions.editorRef.current;
    const monaco = actions.monacoRef.current;
    if (!editor || !monaco) return undefined;
    // A fresh editor instance means the old one's decorations/options are gone.
    if (lastEditor.current !== editor) {
      extRuntime.current.disposeAll();
      lastEditor.current = editor;
    }
    extRuntime.current.sync(activeExtIds, { monaco, editor, store });
    return undefined;
  }, [activeExtIds, editorEpoch, actions, store]);
  useEffect(() => () => extRuntime.current.disposeAll(), []);

  // ---- language-server IntelliSense (desktop + wired languages only) ----
  // Attaches after every editor mount and whenever the active document,
  // language or workspace root changes; a failed/missing server leaves the
  // basic experience untouched and reports the state to the store.
  const lspSession = useRef(null);
  const lspProbeSeen = useRef(0);
  useEffect(() => {
    const editor = actions.editorRef.current;
    const monaco = actions.monacoRef.current;
    const doc = store.activePath ? store.docs[store.activePath] : null;
    if (!editor || !monaco || !doc) return undefined;
    if (workspace.mode !== 'desktop') return undefined;
    if (!lspDescriptorForMonacoLanguage(doc.language)) return undefined;
    // The wrapper creates each document's model as Uri.parse(path) — resolve
    // that exact model rather than trusting editor.getModel() mid-switch.
    const docUri = monaco.Uri.parse(doc.path);
    const model = monaco.editor.getModel(docUri) || (editor.getModel()?.uri.toString() === docUri.toString() ? editor.getModel() : null);
    if (!model) return undefined;

    let cancelled = false;
    const { root, lspToolPaths, lspJdkPaths, lspProbeRevision, setLspState, pushOutput } = useIdeStore.getState();
    // A changed tool/JDK path means the cached answer is stale: re-probe, and
    // let main tear down the bridge built with the previous one.
    const reprobe = lspProbeRevision !== lspProbeSeen.current;
    lspProbeSeen.current = lspProbeRevision;

    const onServerMessage = (m) => {
      if (cancelled) return;
      // The server's own words (import/dependency/JVM problems) belong in the
      // Output panel: the editor can only ever show squiggles, not the reason.
      pushOutput({ kind: m.outputKind || 'info', text: `[${m.language}${m.kind === 'status' ? ' status' : ''}] ${m.text}` });
    };
    const onState = (state) => {
      if (cancelled) return;
      setLspState(doc.language, root, state);
      if (state === 'error') {
        // Pull the bridge's captured (redacted) server output, so a crash that
        // produced no protocol data still says why instead of "exited".
        void lspStatus({ language: doc.language, root })
          .then((res) => {
            if (cancelled || !res?.ok) return;
            for (const line of res.logTail || []) pushOutput({ kind: 'err', text: `[${doc.language} server] ${line}` });
            if (res.error) pushOutput({ kind: 'fail', text: `[${doc.language} server] ${res.error}` });
          })
          .catch(() => {});
      }
    };

    const attach = async () => {
      const javaProjectMode = doc.language === 'java' ? await detectJavaProjectMode(doc.path, root) : undefined;
      return attachLspSession({
        monaco,
        editor,
        model,
        language: doc.language,
        docPath: doc.path,
        root,
        toolPath: lspToolPaths[doc.language] || null,
        jdkPath: lspJdkPaths[doc.language] || null,
        reprobe,
        javaProjectMode,
        onState,
        onServerMessage,
        // Locations pointing at files whose models exist (open tabs) map back to
        // them; anything else is dropped rather than shown broken.
        lookupModelUri: (uriString) => {
          const st = useIdeStore.getState();
          for (const p of Object.keys(st.docs)) {
            if (sameUri(pathToUri(p), uriString)) {
              const asUri = monaco.Uri.parse(p).toString();
              return monaco.editor.getModels().find((m) => m.uri.toString() === asUri) || null;
            }
          }
          return null;
        },
      });
    };

    attach()
      .then((session) => {
        if (cancelled) {
          void session.dispose?.();
          return;
        }
        lspSession.current = session;
      })
      .catch(() => {
        /* the editor must never break because of a language server */
      });

    return () => {
      cancelled = true;
      const s = lspSession.current;
      lspSession.current = null;
      if (s) void s.dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.path, activeDoc?.language, editorEpoch, store.root, store.lspProbeRevision]);

  // Switching workspaces must not leave bridges bound to the old root.
  const lastLspRoot = useRef(store.root);
  useEffect(() => {
    if (lastLspRoot.current === store.root) return;
    const old = lastLspRoot.current;
    const st = useIdeStore.getState();
    for (const [key, state] of Object.entries(st.lsp)) {
      if (key.endsWith(`|${old || ''}`) && (state === 'ready' || state === 'starting' || state === 'error')) {
        const language = key.slice(0, key.lastIndexOf('|'));
        void lspStopBridge({ language, root: old });
      }
    }
    lastLspRoot.current = store.root;
  }, [store.root]);

  const breadcrumb = useMemo(() => {
    if (!activeDoc) return null;
    const parts = String(activeDoc.path).split(/[\\/]/).filter(Boolean);
    return parts;
  }, [activeDoc]);

  const hasDocs = store.order.length > 0;

  return (
    <div className={`app-shell flex h-screen flex-col overflow-hidden ${workspace.mode === 'desktop' ? 'select-none' : ''}`}>
      <TopMenu actions={actions} editorRef={actions.editorRef} openPalette={() => setOverlay('command')} openQuickOpen={openQuickOpen} onRequestAI={requestAi} />
      {aiAccessMode === 'admin' ? <div className="flex shrink-0 items-center justify-between border-b border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-200"><span>Admin AI mode · using server-configured providers</span><button type="button" className="rounded px-2 py-0.5 hover:bg-amber-500/20" onClick={() => navigate('/admin')}>Return to Admin Dashboard</button></div> : null}

      <div className="flex min-h-0 flex-1">
        <ActivityBar />

        {store.sidebarVisible ? (
          <>
            <aside className="min-h-0 shrink-0" style={{ width: store.sidebarWidth }}>
              <SidebarView actions={actions} />
            </aside>
            <Resizer orientation="vertical" size={store.sidebarWidth} min={160} max={520} onResize={(px) => store.setPanelSize('sidebarWidth', px)} />
          </>
        ) : null}

        {/* Center */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EditorTabs actions={actions} />

          {breadcrumb ? (
            <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-3 py-1 text-[11px] text-slate-400">
              {breadcrumb.map((seg, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {i > 0 ? <span className="text-slate-600">/</span> : null}
                  <span className={i === breadcrumb.length - 1 ? 'text-slate-200' : ''}>{seg}</span>
                </span>
              ))}
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1">
            {hasDocs ? (
              <MonacoHost
                doc={activeDoc}
                themeId={themeId}
                prefs={prefs}
                onChange={handleChange}
                onMount={setEditor}
                onCursor={setCursor}
              />
            ) : (
              <WelcomePane actions={actions} store={store} isDesktop={workspace.mode === 'desktop'} />
            )}

            {/* Floating quick actions when the editor is empty */}
            {hasDocs ? (
              <div className="pointer-events-none absolute right-3 top-2 z-10 flex gap-1">
                <button type="button" onClick={actions.runActive} className="pointer-events-auto focus-ring inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white shadow hover:bg-brand-500" title="Run (Ctrl+Enter)">
                  <Play size={12} /> Run
                </button>
                <button type="button" onClick={actions.saveActive} className="pointer-events-auto focus-ring rounded bg-slate-800/90 px-2 py-1 text-xs text-slate-200 shadow hover:bg-slate-700" title="Save (Ctrl+S)">Save</button>
              </div>
            ) : null}
          </div>

          {store.bottomPanel.open ? (
            <>
              <Resizer orientation="horizontal" size={store.bottomHeight} min={120} max={460} onResize={(px) => store.setPanelSize('bottomHeight', px)} />
              <div className="shrink-0" style={{ height: store.bottomHeight }}>
                <BottomPanel isDark={isDark} actions={actions} />
              </div>
            </>
          ) : null}
        </main>

        {/* Live Preview split (resizable, independent of the AI panel) */}
        {store.preview.visible ? (
          <>
            <Resizer orientation="vertical" size={store.previewWidth} min={280} max={900} onResize={(px) => store.setPanelSize('previewWidth', px)} />
            <aside className="min-h-0 shrink-0" style={{ width: store.previewWidth }}>
              <LivePreviewPanel />
            </aside>
          </>
        ) : null}

        {/* Right AI panel */}
        {store.rightPanelVisible && aiAccessMode !== 'guest' ? (
          <>
            <Resizer orientation="vertical" size={store.rightPanelWidth} min={260} max={620} onResize={(px) => store.setPanelSize('rightPanelWidth', px)} />
            <aside className="min-h-0 shrink-0" style={{ width: store.rightPanelWidth }}>
              <AiChatPanel accessMode={aiAccessMode} onClose={() => store.toggleRightPanel()} applyEditorEdit={async (_before, nextContent) => {
                const editor = actions.editorRef?.current;
                const model = editor?.getModel?.();
                if (editor && model) {
                  editor.executeEdits('stackamit-ai', [{ range: model.getFullModelRange(), text: nextContent }]);
                  return actions.saveActive();
                }
                return { ok: false, message: 'The editor is not ready.' };
              }} getSelectedCode={() => {
                const editor = actions.editorRef?.current;
                const selection = editor?.getSelection?.();
                const model = editor?.getModel?.();
                return selection && model && !selection.isEmpty() ? model.getValueInRange(selection) : '';
              }} />
            </aside>
          </>
        ) : null}
      </div>

      <StatusBar
        cursor={cursor}
        language={activeDoc?.language}
        tabSize={prefs.tabSize}
        onCycleTheme={cycleTheme}
      />

      <CommandOverlay
        open={overlay === 'command'}
        mode="command"
        commands={commands}
        onClose={() => setOverlay(null)}
        onPick={onOverlayPick}
      />
      <CommandOverlay
        open={overlay === 'file'}
        mode="file"
        files={paletteFiles}
        onClose={() => setOverlay(null)}
        onPick={onOverlayPick}
      />
      {/* Rename / New File / New Folder input — Electron has no window.prompt. */}
      <PromptModal />
    </div>
  );
}

// Small theme list for the palette (ids + labels only).
const THEMES_SHORT = [
  { id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern' },
  { id: 'vs-dark', label: 'VS Code Dark' },
  { id: 'light', label: 'Light' },
];

function WelcomePane({ actions, store, isDesktop }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="text-2xl font-semibold tracking-tight text-slate-200">StackAmit-IDE</div>
      <div className="text-xs uppercase tracking-[0.3em] text-slate-500">Code. Compile. Create.</div>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        {/* Web: the primary action must be the one that really loads a folder
            (File System Access picker); `openWorkspace()` in the browser only
            points at the virtual root, so it is offered under its own honest
            name instead of a second "Open Folder…" label. */}
        <button
          type="button"
          onClick={isDesktop ? actions.openWorkspace : actions.importFolder}
          className="focus-ring inline-flex items-center gap-2 rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500"
        >
          <FolderOpen size={16} /> {isDesktop ? 'Open Workspace…' : 'Open Folder…'}
        </button>
        <button type="button" onClick={() => store.newUntitled()} className="focus-ring inline-flex items-center gap-2 rounded border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/5">
          <FilePlus2 size={16} /> New File
        </button>
        {isDesktop ? null : (
          <button type="button" onClick={() => actions.openWorkspace()} className="focus-ring inline-flex items-center gap-2 rounded border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/5">
            <SearchIcon size={16} /> Use Browser Workspace
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-slate-500">
        <div className="flex items-center gap-2"><CommandIcon size={12} /> Command Palette <kbd className="ml-auto rounded border border-white/15 px-1">F1</kbd></div>
        <div className="flex items-center gap-2"><SearchIcon size={12} /> Quick Open <kbd className="ml-auto rounded border border-white/15 px-1">Ctrl+P</kbd></div>
        <div className="flex items-center gap-2"><Play size={12} /> Run <kbd className="ml-auto rounded border border-white/15 px-1">Ctrl+Enter</kbd></div>
        <div className="flex items-center gap-2"><Sparkles size={12} /> AI Chat <kbd className="ml-auto rounded border border-white/15 px-1">Ctrl+I</kbd></div>
        <div className="flex items-center gap-2"><PanelLeftOpen size={12} /> Sidebar <kbd className="ml-auto rounded border border-white/15 px-1">Ctrl+B</kbd></div>
        <div className="flex items-center gap-2"><Eraser size={12} /> Clear Output <kbd className="ml-auto rounded border border-white/15 px-1">Palette</kbd></div>
      </div>

      {!isDesktop ? (
        <p className="mt-4 max-w-md text-[11px] text-slate-500">
          You’re in browser mode: files are stored locally in a virtual workspace, and Run uses the configured remote
          execution provider. The desktop app adds real filesystem access and a local terminal.
        </p>
      ) : null}
    </div>
  );
}
