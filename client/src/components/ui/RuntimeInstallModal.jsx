import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Download, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../../services/api.js';

/** WebSocket endpoint for local interactive runs / installs. */
function wsUrl() {
  const base = import.meta.env.VITE_API_URL;
  if (base) {
    try {
      const u = new URL(base, window.location.origin);
      const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${u.host}/api/interactive`;
    } catch {
      /* fall through */
    }
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/interactive`;
}

/**
 * Consent popup for installing a missing local runtime.
 *
 * Shows the exact package-manager command, and only runs it after the user
 * clicks Install (the real privilege gate is the OS UAC prompt that follows).
 * Live installer output streams into the log; on success `onInstalled` lets the
 * parent refresh runtime availability.
 */
export default function RuntimeInstallModal({ open, languageKey, languageLabel, onClose, onInstalled }) {
  const [plan, setPlan] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | consent | installing | done | error
  const [log, setLog] = useState('');
  const [message, setMessage] = useState('');
  const wsRef = useRef(null);
  const logRef = useRef(null);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }, []);

  // (Re)load the install plan each time the popup opens for a language.
  useEffect(() => {
    if (!open || !languageKey) return;
    let cancelled = false;
    setPhase('loading');
    setLog('');
    setMessage('');
    setPlan(null);
    (async () => {
      try {
        const p = await api.interactiveInstallPlan(languageKey);
        if (cancelled) return;
        setPlan(p);
        setPhase('consent');
      } catch (err) {
        if (cancelled) return;
        setPhase('error');
        setMessage(err.message || 'Could not reach the installer service.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, languageKey]);

  // Auto-scroll the log.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  // Tear down the socket on unmount.
  useEffect(() => closeSocket, [closeSocket]);

  const startInstall = useCallback(() => {
    setPhase('installing');
    setLog('');
    let ws;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      setPhase('error');
      setMessage('Could not open a connection to the server.');
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'install', language: languageKey }));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'install-progress') {
        setLog((prev) => prev + String(m.data ?? ''));
      } else if (m.type === 'install-done') {
        if (m.success) {
          setPhase('done');
          setMessage(m.message || 'Installed successfully.');
          onInstalled?.(languageKey);
        } else {
          setPhase('error');
          setMessage(m.message || 'Installation failed.');
        }
        closeSocket();
      }
    };
    ws.onerror = () => {
      setPhase('error');
      setMessage('Connection to the installer failed.');
    };
    ws.onclose = () => {
      wsRef.current = null;
    };
  }, [languageKey, onInstalled, closeSocket]);

  if (!open) return null;

  const busy = phase === 'installing';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Install runtime">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={busy ? undefined : onClose} aria-hidden="true" />
      <div className="relative flex max-h-[85vh] w-[min(94vw,32rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-ink-800 dark:bg-ink-900">
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-ink-800">
          <Download size={18} className="text-brand-500" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Install {languageLabel || languageKey} runtime
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="focus-ring ml-auto rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-ink-800"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-4 py-3 text-sm">
          {phase === 'loading' ? (
            <p className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Loader2 size={16} className="animate-spin" /> Checking installer availability…
            </p>
          ) : null}

          {phase === 'consent' && plan && !plan.supported ? (
            <p className="text-slate-600 dark:text-slate-300">
              No automatic installer is defined for this language. Please install its toolchain manually.
            </p>
          ) : null}

          {phase === 'consent' && plan && plan.supported && plan.needsPackageManager ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>No package manager (winget / Chocolatey) was found on the server. Install one, or install the toolchain manually.</span>
            </div>
          ) : null}

          {phase === 'consent' && plan && plan.supported && !plan.needsPackageManager ? (
            <>
              <p className="text-slate-600 dark:text-slate-300">
                Interactive mode runs programs locally, so <strong>{plan.label}</strong> must be installed.
                With your permission, the server will run:
              </p>
              <pre className="overflow-auto rounded-lg bg-slate-100 px-3 py-2 font-mono text-[12px] text-slate-700 dark:bg-ink-800 dark:text-slate-200">
                {plan.command}
              </pre>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Windows will show a User Account Control (UAC) prompt — accept it to authorize the install.
                This can take a few minutes.
              </p>
            </>
          ) : null}

          {(busy || phase === 'done' || phase === 'error') && log ? (
            <div>
              <p className="mb-1 font-medium text-slate-500 dark:text-slate-400">Installer output</p>
              <pre
                ref={logRef}
                className="max-h-56 overflow-auto rounded-lg bg-slate-950 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-200"
              >
                {log}
              </pre>
            </div>
          ) : null}

          {phase === 'done' ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={16} className="shrink-0" />
              <span>{message} You can now run {languageLabel} interactively.</span>
            </div>
          ) : null}

          {phase === 'error' ? (
            <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 p-3 text-rose-700 dark:text-rose-300">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{message}</span>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-ink-800">
          {phase === 'consent' ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="focus-ring rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startInstall}
                disabled={!plan.supported || plan.needsPackageManager}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                <Download size={15} /> Install {plan.label}
              </button>
            </>
          ) : busy ? (
            <span className="inline-flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 size={16} className="animate-spin" /> Installing… keep this open to watch progress.
            </span>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="focus-ring rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
            >
              {phase === 'done' ? 'Done' : 'Close'}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
