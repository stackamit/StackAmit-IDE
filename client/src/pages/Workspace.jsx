import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../services/api.js';
import { DEFAULT_LANGUAGES, DEFAULT_LANGUAGE_KEY, languageByKey } from '../utils/languageDefaults.js';
import { useLocalStorage } from '../hooks/useLocalStorage.js';
import { useTheme } from '../hooks/useTheme.js';
import { useEditorPrefs } from '../hooks/useEditorPrefs.js';
import { useNotifications } from '../components/ui/Notification.jsx';

import Navbar from '../components/layout/Navbar.jsx';
import Footer from '../components/layout/Footer.jsx';
import CodeEditor from '../components/editor/CodeEditor.jsx';
import EditorSettings from '../components/editor/EditorSettings.jsx';
import Terminal from '../components/console/Terminal.jsx';
import RuntimeInstallModal from '../components/ui/RuntimeInstallModal.jsx';
import Splitter from '../components/layout/Splitter.jsx';

// Languages Monaco can format in-browser without an external service.
const FORMATTABLE = new Set(['javascript', 'typescript', 'json', 'html', 'css']);

// Languages whose errors we fetch from the local toolchain as the user types
// (Monaco validates JavaScript/TypeScript natively, so they're not listed).
const LINTABLE = new Set(['python', 'c', 'cpp', 'java']);

// Common ways a program reads stdin, across the supported languages. Used only
// to nudge the user to queue input before running — never to block /run.
const STDIN_PATTERNS = [
  /\binput\s*\(/, /\braw_input\s*\(/, /\bsys\.stdin\b/,        // Python
  /\bscanf\s*\(/, /\bgetchar\s*\(/, /\bfgets\s*\(/, /\bgets\s*\(/, // C
  /\bstd::cin\b/, /\bcin\s*<</,                                  // C++
  /\bScanner\b/, /\breadLine\s*\(/, /\bBufferedReader\b/, /\bSystem\.console\b/, // Java
  /\breadline\s*\(/, /\bprompt\s*\(/, /\bstdin\b/,              // JS / Node
];

export default function Workspace() {
  const notif = useNotifications();
  const { theme, isDark, toggleTheme } = useTheme();
  const { prefs, update: updatePrefs, reset: resetPrefs } = useEditorPrefs();

  const [languages, setLanguages] = useState(DEFAULT_LANGUAGES);
  const [provider, setProvider] = useState(null);
  const [snippetEnabled, setSnippetEnabled] = useState(false);
  const [banner, setBanner] = useState('');
  const [interactive, setInteractive] = useState({ enabled: false, runtimes: {} });
  const [installTarget, setInstallTarget] = useState(null); // languageKey while popup open

  const [activeLanguage, setActiveLanguage] = useLocalStorage('stackamit:active', DEFAULT_LANGUAGE_KEY);
  const [drafts, setDrafts] = useLocalStorage('stackamit:drafts', {});
  const [split, setSplit] = useLocalStorage('stackamit:split', 60); // editor height %
  const [settingsOpen, setSettingsOpen] = useState(false);

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const terminalRef = useRef(null);

  const lang = useMemo(() => languageByKey(languages, activeLanguage), [languages, activeLanguage]);

  // Ensure a draft exists for the active language (seed from starter).
  const code = drafts[activeLanguage] ?? lang.starter ?? '';

  // Does the current program appear to read stdin? (drives the terminal's hint)
  const readsStdin = useMemo(() => code.length > 0 && STDIN_PATTERNS.some((re) => re.test(code)), [code]);

  const setCode = useCallback(
    (next) => setDrafts((prev) => ({ ...prev, [activeLanguage]: next })),
    [activeLanguage, setDrafts],
  );

  // ---- Load language metadata + provider status + site settings on mount ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.languages();
        if (cancelled) return;
        if (Array.isArray(data.languages) && data.languages.length) {
          setLanguages((prev) =>
            prev.map((d) => {
              const server = data.languages.find((s) => s.key === d.key);
              return server ? { ...d, ...server, starter: server.starter || d.starter } : d;
            }),
          );
        }
        setProvider({ name: data.provider, configured: data.configured, available: data.available });
        setSnippetEnabled(Boolean(data.snippetEnabled));
      } catch {
        if (cancelled) return;
        try {
          const status = await api.executionStatus();
          setProvider(status);
        } catch (err) {
          setProvider({ name: 'unknown', configured: false, available: false });
          notif.error(err.message || 'Cannot reach the API server.');
        }
      }
      try {
        const s = await api.siteSettings();
        if (!cancelled && s?.announcementBanner) setBanner(s.announcementBanner);
      } catch {
        /* banner is optional */
      }
      try {
        const i = await api.interactiveStatus();
        if (!cancelled && i) setInteractive({ enabled: Boolean(i.enabled), runtimes: i.runtimes || {} });
      } catch {
        /* interactive is optional (older server / disabled) */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Execute (invoked by the Terminal; returns the result envelope) ----
  const execute = useCallback(
    async ({ stdin, signal }) => {
      if (!code.trim()) {
        const err = new Error('Source code is empty.');
        err.message = 'Source code is empty.';
        throw err;
      }
      const data = await api.run({ language: activeLanguage, sourceCode: code, stdin, signal });
      if (data.success) notif.success('Execution finished.');
      return data;
    },
    [code, activeLanguage, notif],
  );

  // ---- Format ----
  const format = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (!FORMATTABLE.has(lang.monaco)) {
      notif.info(`In-browser formatting isn't available for ${lang.label}; Monaco formats JS/TS/JSON/HTML/CSS.`);
      return;
    }
    try {
      editor.getAction('editor.action.formatDocument')?.run();
      notif.success('Code formatted.');
    } catch {
      notif.warning('Formatting did not run for this document.');
    }
  }, [lang, notif]);

  // ---- Reset ----
  const reset = useCallback(() => {
    const starter = lang.starter ?? '';
    if (code.trim() && code !== starter) {
      if (!window.confirm('Reset this code back to the starter template? Your current changes will be lost.')) return;
    }
    setCode(starter);
    notif.info(`Reset ${lang.label} to starter template.`);
  }, [code, lang, setCode, notif]);

  // ---- Save to computer (real file on disk) ----
  // Uses the File System Access API ("Save As") where available, otherwise
  // falls back to a normal browser download. Editing autosaves to localStorage
  // separately, so this is the explicit "put a file on my machine" action.
  const saveToDisk = useCallback(async () => {
    const filename = lang.fileName || `main.${activeLanguage}`;
    const text = code;
    if (!text.trim()) {
      notif.warning('Nothing to save — the editor is empty.');
      return;
    }
    const ext = '.' + (filename.split('.').pop() || 'txt');
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: lang.label || 'Source file', accept: { 'text/plain': [ext] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        notif.success(`Saved ${filename} to your computer.`);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return; // user cancelled the picker
        // Any other error falls through to the download fallback.
      }
    }
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notif.success(`Downloaded ${filename}.`);
    } catch (err) {
      notif.error(`Could not save the file: ${err.message || 'unknown error'}`);
    }
  }, [code, lang, activeLanguage, notif]);

  // ---- Share snippet ----
  const share = useCallback(async () => {
    try {
      const data = await api.saveSnippet({ language: activeLanguage, sourceCode: code, isPublic: true });
      const url = `${window.location.origin}/snippet/${data.id}`;
      try {
        await navigator.clipboard.writeText(url);
        notif.success('Share link copied to clipboard.');
      } catch {
        notif.info(`Snippet saved. Share URL: ${url}`);
      }
    } catch (err) {
      if (err.status === 503 || err.code === 'DATABASE_UNAVAILABLE') {
        notif.warning('Sharing needs MongoDB; your code is still saved locally in the browser.');
      } else {
        notif.error(err.message || 'Could not save snippet.');
      }
    }
  }, [activeLanguage, code, notif]);

  // ---- Language switch ----
  const changeLanguage = useCallback(
    (key) => setActiveLanguage(key),
    [setActiveLanguage],
  );

  const run = useCallback(() => terminalRef.current?.run(), []);

  // Offer interactive mode for every language whenever the server allows local
  // runs; per-language runtime detection only drives an inline readiness hint.
  const interactiveAvailable = Boolean(interactive.enabled);
  const interactiveRuntimeReady = Boolean(interactive.runtimes?.[activeLanguage]?.available);
  const getCode = useCallback(() => code, [code]);

  // Re-read which local runtimes exist (e.g. after an install completes).
  const refreshInteractive = useCallback(async () => {
    try {
      const i = await api.interactiveStatus();
      if (i) setInteractive({ enabled: Boolean(i.enabled), runtimes: i.runtimes || {} });
    } catch {
      /* interactive is optional */
    }
  }, []);

  // ---- Keyboard shortcuts (single global handler, no duplicates) ----
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        run();
      } else if (e.key.toLowerCase() === 's' && !e.shiftKey) {
        e.preventDefault();
        saveToDisk();
      } else if (e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        format();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, format, saveToDisk]);

  const onEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  }, []);

  // ---- Live error highlighting ----
  // Paint (or clear) diagnostics as Monaco markers on the current model.
  const applyMarkers = useCallback((markers) => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    const model = editor?.getModel?.();
    if (!monaco || !model) return;
    const maxLine = model.getLineCount();
    const mapped = (markers || []).map((m) => {
      const line = Math.min(Math.max(1, m.line || 1), maxLine);
      const startColumn = Math.max(1, m.column || 1);
      const lineLength = model.getLineContent(line).length;
      const endColumn = Math.min(Math.max(startColumn + 1, lineLength + 1), lineLength + 1);
      return {
        severity: m.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
        message: m.message || 'Error',
        startLineNumber: line,
        startColumn,
        endLineNumber: line,
        endColumn,
      };
    });
    monaco.editor.setModelMarkers(model, 'stackamit-lint', mapped);
  }, []);

  const clearMarkers = useCallback(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel?.();
    if (monaco && model) monaco.editor.setModelMarkers(model, 'stackamit-lint', []);
  }, []);

  // Debounced check while typing: after a short idle we ask the server to
  // syntax-check the current buffer and highlight the offending spots.
  const lintTokenRef = useRef(0);
  useEffect(() => {
    const token = ++lintTokenRef.current;
    if (!LINTABLE.has(activeLanguage)) return undefined; // Monaco handles the rest
    if (!code.trim()) {
      clearMarkers();
      return undefined;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.lint(activeLanguage, code);
        if (token !== lintTokenRef.current) return; // a newer edit superseded this
        applyMarkers(res?.markers || []);
      } catch {
        if (token === lintTokenRef.current) clearMarkers();
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [activeLanguage, code, applyMarkers, clearMarkers]);

  return (
    <div className="app-shell flex h-full flex-col">
      <Navbar
        languages={languages}
        activeLanguage={activeLanguage}
        onLanguageChange={changeLanguage}
        running={false}
        provider={provider}
        snippetEnabled={snippetEnabled}
        onRun={run}
        onFormat={format}
        onReset={reset}
        onSave={saveToDisk}
        onSaveSnippet={share}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        fontSize={prefs.fontSize}
        onFontSizeChange={(n) => updatePrefs({ fontSize: n })}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {banner ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-center text-xs font-medium text-amber-700 dark:text-amber-300">
          {banner}
        </div>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col">
        <div
          className="min-h-0 overflow-hidden border-b border-slate-200 dark:border-ink-800"
          style={{ flexBasis: `${split}%` }}
        >
          <CodeEditor
            value={code}
            language={lang.monaco}
            theme={isDark ? 'vs-dark' : 'light'}
            fontSize={prefs.fontSize}
            prefs={prefs}
            onChange={setCode}
            onMount={onEditorMount}
          />
        </div>

        <Splitter value={split} onChange={setSplit} />

        <div className="flex min-h-0 flex-1 flex-col">
          <Terminal
            ref={terminalRef}
            languageLabel={lang.label || activeLanguage}
            readsStdin={readsStdin}
            onExecute={execute}
            onNotify={(type, msg) => notif[type]?.(msg)}
            interactiveAvailable={interactiveAvailable}
            runtimeAvailable={interactiveRuntimeReady}
            languageKey={activeLanguage}
            getCode={getCode}
            onRequestInstall={(key) => setInstallTarget(key || activeLanguage)}
          />
        </div>
      </main>

      <Footer />

      <RuntimeInstallModal
        open={Boolean(installTarget)}
        languageKey={installTarget}
        languageLabel={languageByKey(languages, installTarget)?.label || installTarget}
        onClose={() => setInstallTarget(null)}
        onInstalled={refreshInteractive}
      />

      <EditorSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        prefs={prefs}
        update={updatePrefs}
        reset={resetPrefs}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />
    </div>
  );
}
