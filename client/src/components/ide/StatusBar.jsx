import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, AlertTriangle, XCircle, Braces, Palette, Zap, ZapOff, Radio, Server, Cloud, CloudOff, Loader2, Circle, Save } from 'lucide-react';
import { useIdeStore, totalProblemCount, saveStateFor } from '../../store/ideStore.js';
import { workspace } from '../../services/workspace.js';
import { useEditorPrefs } from '../../hooks/useEditorPrefs.js';
import { capabilityForMonacoLanguage, describeIntellisense } from '../../languages/languageCapabilities.js';
import { isBrowserRunnable } from '../../utils/browserRun.js';
import * as previewSvc from '../../services/preview.js';
import { api, remoteRunAvailability } from '../../services/api.js';

const RECHECK_MS = 60000;

/**
 * API-server chip.
 *
 * Remote execution is the one Web Mode feature that depends on something the
 * browser does not own, so its state must be visible instead of surfacing only
 * when a Run fails. Nothing here claims a provider works: the label comes from
 * the server's own /api/health answer (booleans and short labels only).
 */
function ApiChip() {
  const [state, setState] = useState('idle'); // idle | checking | ok | degraded | down | unconfigured
  const [detail, setDetail] = useState('');
  // Primitive deps on purpose: remoteRunAvailability() returns a fresh object
  // each call, and depending on the object would re-create `check` on every
  // render — which would restart the polling timer endlessly.
  const { ok: apiReachable, target: apiTarget, message: apiMessage } = remoteRunAvailability();

  const check = useCallback(async () => {
    if (!apiReachable) {
      setState('unconfigured');
      setDetail(apiMessage || 'No API server configured for this build.');
      return;
    }
    setState((s) => (s === 'idle' ? 'checking' : s));
    try {
      const h = await api.health();
      const exec = h?.execution || {};
      setDetail(
        `${apiTarget} · provider ${exec.provider || 'none'} · ` +
          `${exec.configured ? (exec.available ? 'available' : 'not answering') : 'not configured'}` +
          `${h?.database?.connected ? '' : ' · database offline (auth & snippets disabled)'}`,
      );
      setState(exec.configured && exec.available ? 'ok' : 'degraded');
    } catch (err) {
      setState('down');
      setDetail(`${apiTarget} — ${err?.message || 'the server did not answer'}`);
    }
  }, [apiReachable, apiTarget, apiMessage]);

  useEffect(() => {
    check();
    const t = setInterval(check, RECHECK_MS);
    return () => clearInterval(t);
  }, [check]);

  const view = {
    idle: ['API…', 'opacity-60', CloudOff],
    checking: ['API…', 'opacity-60', Loader2],
    ok: ['API online', 'text-emerald-300', Cloud],
    degraded: ['API limited', 'text-amber-300', Cloud],
    down: ['API offline', 'text-red-300', CloudOff],
    unconfigured: ['no API', 'text-slate-300', CloudOff],
  }[state];
  const [label, tone, Icon] = view;
  return (
    <button
      type="button"
      onClick={check}
      title={`Execution API — click to re-check\n${detail || 'Checking…'}`}
      className={`focus-ring inline-flex items-center gap-1 rounded px-1 hover:bg-white/15 ${tone}`}
    >
      <Icon size={12} className={state === 'checking' ? 'animate-spin' : ''} />
      {label}
    </button>
  );
}

function GoLiveChip() {
  const pv = useIdeStore((s) => s.preview);
  const desktop = previewSvc.isDesktopPreview();
  const running = desktop && (pv.mode === 'dev' ? pv.devState === 'running' : pv.state === 'running');
  return (
    <button
      type="button"
      onClick={() => previewSvc.toggleGoLive()}
      title={
        desktop
          ? `Go Live / Stop (Ctrl+Alt+L)${running ? `\n${pv.mode === 'dev' ? pv.devUrl : pv.url}` : ' — starts a 127.0.0.1 preview server for this workspace'}`
          : 'Open the in-browser preview (Ctrl+Alt+L) — a web page cannot start a local server, so this renders the saved workspace files in a sandboxed frame'
      }
      className={`focus-ring inline-flex items-center gap-1 rounded px-1 hover:bg-white/15 ${running ? 'text-emerald-200' : ''}`}
    >
      <Radio size={12} className={running ? 'animate-pulse text-emerald-300' : ''} />
      {desktop ? (running ? 'Live' : 'Go Live') : 'Preview'}
    </button>
  );
}

/**
 * Save-status chip for the active document, plus the Auto Save on/off reading.
 * The label reflects the *confirmed* persistence state of this one document:
 * 'Saving…' only while a write is in flight, 'Saved' only after the workspace
 * pipeline reports success, 'Save failed' with a Retry path otherwise. A newer
 * edit during a save keeps showing 'Modified' until it too is persisted.
 */
function SaveChip() {
  const activePath = useIdeStore((s) => s.activePath);
  const doc = useIdeStore((s) => (s.activePath ? s.docs[s.activePath] : null));
  const saveFile = useIdeStore((s) => s.saveFile);
  const { prefs } = useEditorPrefs();
  if (!doc || doc.untitled) {
    // Untitled buffers have no persistence target; only show the mode setting.
    return (
      <span className="inline-flex items-center gap-1 opacity-70" title="Auto Save applies to saved files once they have a location.">
        <Save size={12} />
        {prefs.autoSave ? 'Auto Save On' : 'Auto Save Off'}
      </span>
    );
  }
  const state = saveStateFor(doc);
  const view = {
    saved: ['Saved', 'text-emerald-200', Check],
    modified: ['Modified', 'opacity-80', Circle],
    saving: ['Saving…', 'opacity-80', Loader2],
    failed: ['Save failed', 'text-red-300', AlertTriangle],
  }[state];
  const [label, tone, Icon] = view;
  const title =
    state === 'failed'
      ? `${doc.saveError || 'Could not save the file.'}\nClick to retry.`
      : `${label} · ${prefs.autoSave ? `Auto Save On (every ${Math.round(prefs.autoSaveDelay / 100) / 10}s)` : 'Auto Save Off'}\nCtrl+S to save now.`;
  const retryable = state === 'failed' || state === 'modified';
  const iconClass = `${state === 'saving' ? 'animate-spin ' : ''}${tone}`.trim();
  const inner = (
    <>
      <Icon size={12} className={iconClass} />
      <span className={tone}>{label}</span>
    </>
  );
  if (!retryable) {
    return (
      <span title={title} className="inline-flex items-center gap-1 px-1">
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => activePath && saveFile(activePath)}
      title={title}
      className="focus-ring inline-flex items-center gap-1 rounded px-1 hover:bg-white/15"
    >
      {inner}
      {state === 'failed' ? <span className="underline">Retry</span> : null}
    </button>
  );
}

/**
 * The tool's own first version line is long (`g++.exe (MinGW.org GCC-6.3.0-1)
 * 6.3.0`, `openjdk version "21.0.4" 2024-07-16`). The status bar has room for
 * the number; the Languages view shows the line and the exact path it came from.
 */
function shortVersion(runtime) {
  const c = runtime?.compiler;
  if (c && c.major != null) return c.minor != null ? `${c.major}.${c.minor}` : String(c.major);
  const match = /(\d+(?:\.\d+)+)/.exec(String(runtime?.version || ''));
  return match ? match[1] : '';
}

/** Bottom status bar: mode, language, cursor, indentation, encoding, problems. */
export default function StatusBar({ cursor, language, tabSize, onCycleTheme }) {
  const problems = useIdeStore((s) => s.problems);
  const localRuntimes = useIdeStore((s) => s.localRuntimes);
  const lsp = useIdeStore((s) => s.lsp);
  const root = useIdeStore((s) => s.root);
  const activePath = useIdeStore((s) => s.activePath);
  const setBottomTab = useIdeStore((s) => s.setBottomTab);
  const setActivityView = useIdeStore((s) => s.setActivityView);
  const errors = (problems[activePath] || []).filter((m) => (m.severity || 'error') !== 'warning').length;
  const warnings = (problems[activePath] || []).filter((m) => m.severity === 'warning').length;
  const total = totalProblemCount(problems);

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-white/10 bg-brand-700 px-2 text-[11px] text-white/90 dark:bg-[#1a6fb0]">
      <button type="button" onClick={onCycleTheme} className="focus-ring inline-flex items-center gap-1 rounded px-1 hover:bg-white/15" title="Cycle theme">
        <Palette size={12} />
        <span>{workspace.mode === 'desktop' ? 'Desktop' : 'Web'} mode</span>
      </button>

      <button
        type="button"
        onClick={() => setBottomTab('problems')}
        className="focus-ring inline-flex items-center gap-2 rounded px-1 hover:bg-white/15"
        title={`${total} problem(s)`}
      >
        <span className={`inline-flex items-center gap-1 ${errors ? 'font-semibold text-red-300' : ''}`}>
          <XCircle size={12} className={errors ? 'text-red-400' : ''} />{errors}
        </span>
        <span className={`inline-flex items-center gap-1 ${warnings ? 'text-amber-200' : ''}`}>
          <AlertTriangle size={12} className={warnings ? 'text-amber-300' : ''} />{warnings}
        </span>
      </button>

      <SaveChip />

      <div className="ml-auto flex items-center gap-3">
        <ApiChip />
        <GoLiveChip />
        {language ? (() => {
          const cap = capabilityForMonacoLanguage(language);
          const lspState = cap?.lsp?.wired ? lsp[`${language}|${root || ''}`] : undefined;
          const full = cap?.intellisense === 'language-service';
          const desktop = workspace.mode === 'desktop';
          // Honest run mode: highlighting is not a compiler, and an online
          // runner is not something the desktop app does without a server.
          const runtime = localRuntimes?.[cap?.localRun];
          const inBrowser = !desktop && isBrowserRunnable(language);
          // Execution capability and language-server state are decided apart: a
          // missing clangd never makes a located compiler look unavailable, and
          // an available compiler never claims IntelliSense it does not have.
          const runTag = inBrowser
            ? 'in this browser'
            : cap?.localRun
              ? desktop
                ? runtime && runtime.available
                  ? `offline · ${runtime.cmd}${shortVersion(runtime) ? ` ${shortVersion(runtime)}` : ''}`
                  : `offline run needs ${cap.local?.cmd || 'a runtime'}`
                : 'offline run in desktop app'
              : cap?.run
                ? 'online runner'
                : cap?.local
                  ? `terminal · ${cap.local.cmd}`
                  : 'no runner';
          const runNote = inBrowser
            ? 'Run executes in this page\'s own JavaScript engine as an ES module — no server and no Node.js (require(), process, and installed packages are unavailable).'
            : cap?.localRun
              ? desktop
                ? runtime?.available
                  ? `Runs locally in this app with ${runtime.path || runtime.cmd}. No server, no network.\nThe language server (${cap.lsp?.server || 'n/a'}) is a separate tool and ${lspState === 'ready' ? 'is connected' : lspState ? 'is not connected right now' : 'has not been started'} — neither changes what Run does.`
                  : `This app can run it offline, but no working ${cap.local?.cmd || runtime?.label || 'runtime'} was found on this machine. Click for the Languages view: it shows what was searched and lets you set a custom path.`
                : 'Runs locally only in the desktop app; here it is editing only.'
              : cap?.run
                ? 'Runs through the online API server — needs the backend and an internet connection.'
                : cap?.local
                  ? `No runner in the app: use the desktop terminal with ${cap.local.cmd}.`
                  : 'No runner: this file type is edited, not executed.';
          return (
            <button
              type="button"
              onClick={() => setActivityView('languages')}
              className="focus-ring inline-flex items-center gap-1 rounded px-1 hover:bg-white/15"
              title={`${describeIntellisense(language, lspState)}\n${runNote}${cap?.runtimeNote ? `\n${cap.runtimeNote}` : ''}\nOpen Languages & Capabilities`}
            >
              {full || lspState === 'ready' ? <Zap size={12} className="text-emerald-300" /> : <ZapOff size={12} className="opacity-60" />}
              <Braces size={12} /> {cap?.label || language}
              <span className="opacity-60">· {full ? 'IntelliSense' : lspState === 'ready' ? 'LS IntelliSense' : 'highlighting'}</span>
              <span className="opacity-60">· {runTag}</span>
            </button>
          );
        })() : null}
        {language && lsp[`${language}|${root || ''}`] ? (() => {
          // One honest language-server chip: the bridge state as observed on
          // this machine right now — never a claim of IntelliSense that is not
          // actually connected.
          const state = lsp[`${language}|${root || ''}`];
          const views = {
            ready: ['LS Ready', 'text-emerald-300'],
            starting: ['LS Starting…', 'opacity-70'],
            'missing-tool': ['LS Missing Tool', 'text-amber-300'],
            error: ['LS Error', 'text-red-300'],
            idle: ['LS idle', 'opacity-60'],
          };
          const [label, tone] = views[state] || ['LS idle', 'opacity-60'];
          return (
            <button
              type="button"
              onClick={() => setActivityView('languages')}
              className="focus-ring inline-flex items-center gap-1 rounded px-1 hover:bg-white/15"
              title={`${label} — click for the Languages & Capabilities view`}
            >
              <Server size={12} className={tone} />
              <span className={tone}>{label}</span>
            </button>
          );
        })() : null}
        {cursor ? (
          <span title="Line / Column">
            Ln {cursor.lineNumber}, Col {cursor.column}
          </span>
        ) : null}
        {tabSize ? <span title="Indentation">Spaces: {tabSize}</span> : null}
        <span title="Encoding">UTF-8</span>
        <span className="inline-flex items-center gap-1"><Check size={12} /> Ready</span>
        <Bell size={12} className="opacity-80" />
      </div>
    </footer>
  );
}
