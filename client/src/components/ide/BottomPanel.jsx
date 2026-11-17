import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Eraser, AlertTriangle, XCircle, Info, TerminalSquare, Bug, ListChecks, ScrollText, Square, Copy } from 'lucide-react';
import { useIdeStore } from '../../store/ideStore.js';
import { useDependencyStore } from '../../store/dependencyStore.js';
import { copyText } from '../../services/clipboard.js';
import TerminalPanel from './TerminalPanel.jsx';
import { workspace } from '../../services/workspace.js';
import { capabilityForMonacoLanguage } from '../../languages/languageCapabilities.js';
import { BROWSER_RUNNABLE } from '../../utils/browserRun.js';
import DebugConsole from './DebugConsole.jsx';

const TABS = [
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { id: 'problems', label: 'Problems', icon: ListChecks },
  { id: 'output', label: 'Output', icon: ScrollText },
  { id: 'debug', label: 'Debug Console', icon: Bug },
];

// In the browser the terminal tab is a dead end, so its label has to carry that
// instead of letting the user think a shell is one click away.
function tabsForMode(isDesktop) {
  if (isDesktop) return TABS;
  return TABS.map((t) => (t.id === 'terminal' ? { ...t, label: 'Terminal (desktop only)' } : t));
}

const OUT_CLASS = {
  banner: 'text-slate-500', cmd: 'text-brand-400', out: 'text-slate-100', err: 'text-rose-400',
  compile: 'text-amber-400', input: 'text-sky-400', prompt: 'text-yellow-300',
  info: 'text-slate-400', ok: 'text-emerald-400', fail: 'text-rose-400', muted: 'text-slate-500',
};

function ProblemsView({ actions }) {
  const problems = useIdeStore((s) => s.problems);
  const setActive = useIdeStore((s) => s.setActive);
  const rows = useMemo(
    () => Object.entries(problems).flatMap(([path, list]) => (list || []).map((m) => ({ path, ...m }))),
    [problems],
  );
  if (!rows.length) return <div className="p-4 text-sm text-slate-500">No problems detected in open files.</div>;
  const SEV = {
    error: { Icon: XCircle, icon: 'text-red-500', text: 'text-red-400' },
    warning: { Icon: AlertTriangle, icon: 'text-amber-400', text: 'text-amber-300' },
    info: { Icon: Info, icon: 'text-sky-400', text: 'text-sky-300' },
  };
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...rows].sort((a, b) => {
    const sa = a.severity === 'warning' ? 'warning' : (a.severity === 'info' || a.severity === 'hint') ? 'info' : 'error';
    const sb = b.severity === 'warning' ? 'warning' : (b.severity === 'info' || b.severity === 'hint') ? 'info' : 'error';
    return order[sa] - order[sb];
  });
  return (
    <div className="scroll-slim h-full overflow-auto py-1 font-mono text-[12.5px]">
      {sorted.map((r, i) => {
        const sev = r.severity === 'warning' ? 'warning' : (r.severity === 'info' || r.severity === 'hint') ? 'info' : 'error';
        const { Icon, icon: iconCls, text: textCls } = SEV[sev];
        return (
          <button
            key={`${r.path}-${r.line}-${i}`}
            type="button"
            onClick={() => {
              // Jump to the diagnostic, not just to the file: the line is the
              // information a Problems list exists to give.
              if (actions?.openFileByPath) {
                void actions.openFileByPath(r.path).then(() => actions.revealInEditor?.(r.line || 1, r.column || 1));
              } else {
                setActive(r.path);
              }
            }}
            className="flex w-full items-start gap-2 px-3 py-0.5 text-left hover:bg-white/5"
          >
            <Icon size={13} className={`mt-0.5 shrink-0 ${iconCls}`} />
            <span className={textCls}>{r.message}</span>
            <span className="ml-auto shrink-0 text-slate-500">{String(r.path).split(/[\\/]/).pop()}:{r.line}:{r.column}</span>
          </button>
        );
      })}
    </div>
  );
}

function OutputView({ actions }) {
  const output = useIdeStore((s) => s.output);
  const clearOutput = useIdeStore((s) => s.clearOutput);
  const runState = useIdeStore((s) => s.runState);
  const runHandle = useIdeStore((s) => s.runHandle);
  const running = runState === 'running';
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const outputRef = useRef(null);
  const autoScrollRef = useRef(true);
  // stdin makes sense for a program that is running with a live input channel:
  // a local desktop process or a Web Mode interactive server session. A remote
  // batch run is one request/response and its process is not ours to feed.
  const awaitingInput = runHandle?.mode === 'local' || runHandle?.mode === 'interactive';
  const interactiveRun = runHandle?.mode === 'interactive';
  // A live prompt from the in-page browser JS runner — answered right here, in
  // the Output panel, in reading order with the program's own output.
  const runPrompt = useIdeStore((s) => s.runPrompt);
  const [promptValue, setPromptValue] = useState('');
  const promptRef = useRef(null);
  useEffect(() => {
    if (runPrompt) {
      setPromptValue('');
      promptRef.current?.focus();
    }
    // Re-run only when a *different* prompt takes the stage, so typing is always
    // against the request currently on screen and never a stale one.
  }, [runPrompt?.token, runPrompt?.promptId]);
  // Pre-run batch stdin for a language a remote provider runs (not the in-page
  // JS engine, which uses the interactive bridge above), and only while idle.
  const runStdin = useIdeStore((s) => s.runStdin);
  const setRunStdin = useIdeStore((s) => s.setRunStdin);
  const interactiveStatus = useIdeStore((s) => s.interactiveStatus);
  const activeLang = useIdeStore((s) => s.docs[s.activePath]?.language);
  const cap = capabilityForMonacoLanguage(activeLang);
  // Java dependency status for the active project, surfaced in the existing
  // Output header (no new panel). Only Java shows it; dependency-free Java and
  // every other language are unaffected.
  const root = useIdeStore((s) => s.root);
  const activePath = useIdeStore((s) => s.activePath);
  const depProjectKey = root || activePath || '__no-project__';
  const depSlice = useDependencyStore((s) => s.byProject[depProjectKey]);
  const depStatus = depSlice?.status || 'idle';
  const depCount = depSlice?.added?.length || 0;
  const depProgress = depSlice?.progress;
  // Would this language run as a live interactive session if Run were pressed
  // now? Decided from the server's confirmed status (never assumed), so the
  // pre-run batch box steps aside for a language the Output panel types into.
  const interactiveForLang =
    workspace.mode === 'web' &&
    Boolean(interactiveStatus?.enabled) &&
    Boolean(cap?.run) &&
    !BROWSER_RUNNABLE.includes(cap?.monaco) &&
    Boolean(cap?.run && interactiveStatus?.runtimes?.[cap.run]?.available);
  const webBatchStdin =
    workspace.mode === 'web' && !running && !interactiveForLang && Boolean(cap?.run) && !BROWSER_RUNNABLE.includes(cap.monaco);
  const copyAll = () => {
    void copyText(output.map((l) => l.text).join('\n')).then((res) => {
      if (res?.ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }
    });
  };
  useEffect(() => {
    const node = outputRef.current;
    if (!node || !autoScrollRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [output.length, runState]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1">
        <button type="button" onClick={actions.runActive} disabled={running} className="focus-ring inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-brand-500 disabled:opacity-60">
          {running ? 'Running…' : 'Run'}
        </button>
        {running ? (
          <button type="button" onClick={actions.stopActiveRun} className="focus-ring inline-flex items-center gap-1 rounded bg-rose-600/80 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-rose-500" title="Terminate this run">
            <Square size={11} /> Stop
          </button>
        ) : null}
        <span className="text-[11px] text-slate-500">
          {runHandle?.mode === 'local' ? `local ${runHandle.language}` : runHandle?.mode === 'interactive' ? `interactive ${runHandle.language}` : runHandle?.mode === 'remote' ? 'online runner' : running ? 'starting…' : ''}
        </span>
        {cap?.monaco === 'java' && (depStatus !== 'idle' || depCount > 0) ? (
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${
              depStatus === 'error' ? 'bg-rose-500/15 text-rose-300' : depStatus === 'ready' ? 'bg-emerald-500/15 text-emerald-300' : depStatus === 'resolving' ? 'bg-amber-500/15 text-amber-300' : 'bg-white/10 text-slate-400'
            }`}
            title={depStatus === 'error' ? (depSlice?.error || 'Dependency error') : depStatus === 'ready' ? 'Dependencies resolved' : depStatus === 'resolving' ? (depProgress?.message || 'Resolving…') : `${depCount} dependenc${depCount === 1 ? 'y' : 'ies'} added`}
          >
            {depStatus === 'resolving' ? '⋯' : depStatus === 'ready' ? '✓' : depStatus === 'error' ? '✗' : '•'} deps
            {depCount ? ` · ${depCount}` : ''}
            {depStatus === 'resolving' && depProgress?.total ? ` ${depProgress.completed || 0}/${depProgress.total}` : ''}
          </span>
        ) : null}
        <button type="button" onClick={clearOutput} className="focus-ring inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-slate-200" title="Clear output">
          <Eraser size={12} /> Clear
        </button>
        <button type="button" onClick={copyAll} disabled={output.length === 0} className="focus-ring inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-slate-200 disabled:opacity-40" title="Copy all output to the clipboard">
          <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={actions.saveActive} className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-slate-200" title="Save (Ctrl+S)">Save</button>
        </div>
      </div>
      <div
        ref={outputRef}
        className="scroll-slim min-h-0 flex-1 select-text overflow-auto px-3 py-2 font-mono text-[13px] leading-relaxed"
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const node = e.currentTarget;
          autoScrollRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
        }}
        onContextMenu={(e) => { if (window.getSelection()?.toString()) return; e.preventDefault(); copyAll(); }}
      >
        {output.length === 0 ? (
          <div className="text-slate-500">Run output appears here. Use the Terminal tab (desktop) for a real shell.</div>
        ) : null}
        {output.map((ln) => (
          <div key={ln.id} className={`whitespace-pre-wrap break-words ${OUT_CLASS[ln.kind] || 'text-slate-200'}`}>
            {ln.text || '\u00A0'}
          </div>
        ))}
        {running ? <div className="text-slate-400">⋯ running…</div> : null}
      </div>
      {runPrompt ? (
        <form
          className="flex items-center gap-2 border-t border-white/10 px-3 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (runPrompt.kind === 'prompt') actions.answerPendingPrompt?.(promptValue);
          }}
        >
          <span id="stackamit-run-prompt" className="shrink-0 text-[11px] text-yellow-300" aria-live="assertive">
            {runPrompt.kind === 'confirm' ? 'Confirm' : runPrompt.kind === 'alert' ? 'Notice' : 'Input'}
            {runPrompt.message ? `: ${runPrompt.message}` : ''}
          </span>
          {runPrompt.kind === 'prompt' ? (
            <>
              <input
                ref={promptRef}
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                aria-labelledby="stackamit-run-prompt"
                placeholder="Type your answer, Enter to submit"
                className="min-w-0 flex-1 rounded bg-white/5 px-2 py-0.5 font-mono text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:bg-white/10"
              />
              <button type="submit" className="focus-ring rounded bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-brand-500">Send</button>
              <button
                type="button"
                onClick={() => actions.cancelPendingPrompt?.()}
                className="focus-ring rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-slate-200"
                title="Send end-of-input (EOF): the program continues without more input"
              >
                EOF
              </button>
            </>
          ) : runPrompt.kind === 'confirm' ? (
            <>
              <button type="button" onClick={() => actions.answerPendingPrompt?.(true)} className="focus-ring rounded bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-brand-500">OK</button>
              <button type="button" onClick={() => actions.answerPendingPrompt?.(false)} className="focus-ring rounded bg-white/10 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-white/20">Cancel</button>
            </>
          ) : (
            <button type="button" onClick={() => actions.answerPendingPrompt?.(undefined)} className="focus-ring ml-auto rounded bg-white/10 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-white/20">Dismiss</button>
          )}
        </form>
      ) : null}
      {webBatchStdin ? (
        <div className="border-t border-white/10 px-3 py-1.5">
          <label htmlFor="stackamit-prerun-stdin" className="mb-1 block text-[11px] text-slate-400">
            Standard input (pre-run) — one line per read, sent before the program runs.
            <span className="text-slate-500"> The online runner is batch (not live typing); prompts appear in the output.</span>
          </label>
          <textarea
            id="stackamit-prerun-stdin"
            value={runStdin}
            onChange={(e) => setRunStdin(e.target.value)}
            rows={2}
            placeholder="Alice"
            aria-label="Pre-run standard input"
            className="w-full resize-y rounded bg-white/5 px-2 py-1 font-mono text-[12px] text-slate-100 outline-none placeholder:text-slate-600 focus:bg-white/10"
          />
        </div>
      ) : null}
      {awaitingInput ? (
        <form
          className="flex items-center gap-2 border-t border-white/10 px-3 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!input) return;
            actions.sendRunInput(input);
            setInput('');
          }}
        >
          <span className="text-[11px] text-slate-500">{interactiveRun ? 'in' : 'stdin'}</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={interactiveRun ? 'Answer the running program — Enter sends this line to the live process' : 'Type input for the running program, Enter to send'}
            className="min-w-0 flex-1 rounded bg-white/5 px-2 py-0.5 font-mono text-[12px] text-slate-100 outline-none placeholder:text-slate-500 focus:bg-white/10"
            aria-label="Send stdin to the running program"
          />
          <button type="submit" className="focus-ring rounded bg-white/10 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-white/20">Send</button>
        </form>
      ) : null}
    </div>
  );
}

export default function BottomPanel({ isDark, actions }) {
  const bottom = useIdeStore((s) => s.bottomPanel);
  const setBottomTab = useIdeStore((s) => s.setBottomTab);
  const toggleBottomPanel = useIdeStore((s) => s.toggleBottomPanel);
  const problems = useIdeStore((s) => s.problems);
  const problemCount = Object.values(problems).reduce((n, l) => n + (l ? l.length : 0), 0);
  const tabs = tabsForMode(workspace.mode === 'desktop');

  return (
    <section className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100 dark:bg-[#12151c]" aria-label="Panel">
      <div className="flex items-center gap-1 border-b border-white/10 px-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = bottom.tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setBottomTab(t.id)}
              className={`relative inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition ${
                active ? 'text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Icon size={13} />
              {t.label}
              {t.id === 'problems' && problemCount ? (
                <span className="rounded-full bg-red-600 px-1.5 text-[10px] text-white">{problemCount}</span>
              ) : null}
              {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-400" /> : null}
            </button>
          );
        })}
        <button type="button" onClick={toggleBottomPanel} className="ml-auto rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100" title="Close panel" aria-label="Close panel">
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {bottom.tab === 'terminal' ? <TerminalPanel isDark={isDark} /> : null}
        {bottom.tab === 'problems' ? <ProblemsView actions={actions} /> : null}
        {bottom.tab === 'output' ? <OutputView actions={actions} /> : null}
        {bottom.tab === 'debug' ? (
          <DebugConsole actions={actions} />
        ) : null}
      </div>
    </section>
  );
}
