import { useEffect, useRef, useState } from 'react';
import { TerminalSquare, Plus, Trash2 } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { workspace } from '../../services/workspace.js';
import { copyText, pasteText } from '../../services/clipboard.js';
import { useIdeStore } from '../../store/ideStore.js';

/**
 * Integrated terminal.
 *  - Desktop: attaches real xterm.js sessions to the Electron node-pty bridge.
 *  - Web: shows a clearly labelled unavailable state (browsers can't spawn a
 *    local shell) rather than pretending to run commands.
 *
 * Clipboard: Ctrl+Shift+C/V and a plain Ctrl+C (copy only when text is selected,
 * otherwise the keystroke reaches the shell as SIGINT) and Ctrl+V paste, plus a
 * right-click copy/paste. The sandboxed renderer has no clipboard of its own, so
 * everything routes through the narrow main-process bridge (see services/clipboard).
 */
export default function TerminalPanel({ isDark }) {
  const root = useIdeStore((s) => s.root);
  const terminalLaunch = useIdeStore((s) => s.terminalLaunch);
  const clearTerminalLaunch = useIdeStore((s) => s.clearTerminalLaunch);
  const [sessions, setSessions] = useState([]); // [{ id }]
  const [activeId, setActiveId] = useState(null);
  const [notice, setNotice] = useState('');

  const containersRef = useRef({}); // id -> div element
  const termRef = useRef({}); // id -> { term, fit, sessionId, cleanup }
  const seqRef = useRef(0);
  const isDesktop = workspace.mode === 'desktop' && workspace.terminal;

  const createSession = (id, opts = {}) => {
    const container = containersRef.current[id];
    if (!container || termRef.current[id]) return;
    const bridge = workspace.terminal;

    const term = new XTerm({
      fontFamily: '"JetBrains Mono", ui-monospace, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: isDark ? { background: '#12151c', foreground: '#d4d4d4' } : { background: '#ffffff', foreground: '#1f2937' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    try { fit.fit(); } catch { /* not laid out yet */ }

    const entry = { term, fit, sessionId: null, cleanup: [] };
    termRef.current[id] = entry;

    // ---- clipboard (through the main-process bridge; no nodeIntegration) ----
    const copySelection = () => {
      if (term.hasSelection()) void copyText(term.getSelection());
    };
    const pasteInto = () => {
      void pasteText().then((res) => {
        if (res?.ok && res.text) term.paste(res.text);
      });
    };
    // Ctrl/Cmd+Shift+C/V are explicit; a plain Ctrl+C copies a selection when
    // there is one and otherwise returns true so xterm forwards SIGINT to the
    // shell (never breaking Ctrl+C interrupt). Ctrl+V pastes.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = e.ctrlKey || e.metaKey;
      const key = (e.key || '').toLowerCase();
      if (!mod) return true;
      if (e.shiftKey && key === 'c') { copySelection(); return false; }
      if (e.shiftKey && key === 'v') { pasteInto(); return false; }
      if (!e.shiftKey && key === 'c') { if (term.hasSelection()) { copySelection(); return false; } return true; }
      if (!e.shiftKey && key === 'v') { pasteInto(); return false; }
      return true;
    });
    const onContextMenu = (ev) => {
      ev.preventDefault();
      if (term.hasSelection()) copySelection();
      else pasteInto();
    };
    container.addEventListener('contextmenu', onContextMenu);

    const offData = bridge.onData((p) => {
      if (termRef.current[id] && p.sessionId === termRef.current[id].sessionId) term.write(p.data);
    });
    const offExit = bridge.onExit((p) => {
      const s = termRef.current[id];
      if (s && p.sessionId === s.sessionId) {
        term.write(`\r\n\x1b[90m[process exited with code ${p.code}]\x1b[0m\r\n`);
        s.sessionId = null;
      }
    });
    const dataSub = term.onData((d) => {
      const s = termRef.current[id];
      if (s && s.sessionId) bridge.write(s.sessionId, d);
    });

    const onWinResize = () => {
      const s = termRef.current[id];
      if (!s) return;
      try { fit.fit(); if (s.sessionId) bridge.resize(s.sessionId, term.cols, term.rows); } catch { /* ignore */ }
    };
    window.addEventListener('resize', onWinResize);

    entry.cleanup = () => {
      window.removeEventListener('resize', onWinResize);
      container.removeEventListener('contextmenu', onContextMenu);
      dataSub.dispose();
      offData();
      offExit();
      if (entry.sessionId) bridge.close(entry.sessionId);
      term.dispose();
    };

    bridge
      .create({
        cwd: opts.cwd || root || undefined,
        // A "Run in Terminal" session may need a toolchain folder the plain PATH
        // lacks (a compiler's own bin for its runtime DLLs).
        extraPathDirs: Array.isArray(opts.extraPathDirs) ? opts.extraPathDirs : [],
        cols: term.cols || 80,
        rows: term.rows || 24,
      })
      .then((res) => {
        if (!termRef.current[id]) return;
        if (res.ok) {
          termRef.current[id].sessionId = res.sessionId;
          if (res.shell) term.write(`\x1b[90m${res.shell}\x1b[0m\r\n`);
          // A launch command is typed only once the shell is actually running.
          if (opts.command) bridge.write(res.sessionId, `${opts.command}\r`);
        } else {
          setNotice(res.message || 'Terminal unavailable.');
          term.write(`\r\n\x1b[31m${res.message || 'Terminal unavailable.'}\x1b[0m\r\n`);
        }
      });
  };

  const addSession = (opts) => {
    seqRef.current += 1;
    const id = `term-${seqRef.current}`;
    setSessions((list) => [...list, { id }]);
    setActiveId(id);
    setTimeout(() => createSession(id, opts), 0);
  };

  const closeSession = (id) => {
    termRef.current[id]?.cleanup?.();
    delete termRef.current[id];
    setSessions((list) => {
      const next = list.filter((x) => x.id !== id);
      if (id === activeId) setActiveId(next.length ? next[next.length - 1].id : null);
      return next;
    });
  };

  // On entering desktop mode, open one session; tear all down on exit/unmount.
  // A pending "Run in Terminal" launch is left to the effect below so the run
  // does not also spawn a second, idle shell on the same mount.
  useEffect(() => {
    if (!isDesktop) return undefined;
    if (sessions.length === 0 && !useIdeStore.getState().terminalLaunch) addSession();
    return () => {
      Object.values(termRef.current).forEach((s) => s.cleanup?.());
      termRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop]);

  // A "Run in Terminal" request opens a dedicated session in the run's working
  // directory (with any toolchain folders prepended to PATH) and types the
  // identical command the managed run would use. Consumed once: clearing the
  // request means a later tab switch/remount never re-runs it and duplicates a
  // process.
  const launchSeen = useRef(0);
  useEffect(() => {
    if (!isDesktop || !terminalLaunch) return;
    if (terminalLaunch.nonce === launchSeen.current) return;
    launchSeen.current = terminalLaunch.nonce;
    addSession({
      cwd: terminalLaunch.cwd || root || undefined,
      extraPathDirs: terminalLaunch.extraPathDirs || [],
      command: terminalLaunch.command || undefined,
    });
    clearTerminalLaunch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalLaunch, isDesktop]);

  // Re-fit the active session when switching to it.
  useEffect(() => {
    const s = termRef.current[activeId];
    if (s) { try { s.fit.fit(); } catch { /* ignore */ } }
  }, [activeId]);

  if (!isDesktop) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center border-b border-white/10 px-2 py-1">
          <span className="text-[11px] font-medium text-slate-400">Terminal</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <TerminalSquare size={26} className="text-slate-500" />
          <p className="text-sm text-slate-300">Local terminal is available in the desktop app.</p>
          <p className="max-w-md text-xs text-slate-500">
            Browsers cannot spawn a local shell. Build &amp; run programs with the <b>Run</b> action (remote provider), or
            install the Electron desktop build for a real integrated terminal.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => setActiveId(s.id)}
            role="button"
            tabIndex={0}
            className={`inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] ${
              s.id === activeId ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {s.id}
            <button type="button" aria-label={`Close ${s.id}`} onClick={(e) => { e.stopPropagation(); closeSession(s.id); }} className="text-slate-500 hover:text-rose-300">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
        <button type="button" title="New terminal" onClick={addSession} className="ml-1 rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100">
          <Plus size={14} />
        </button>
      </div>
      {notice ? <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-300">{notice}</div> : null}
      <div className="relative min-h-0 flex-1">
        {sessions.map((s) => (
          <div
            key={s.id}
            ref={(el) => { containersRef.current[s.id] = el; }}
            className={`absolute inset-0 select-text px-2 py-1 ${s.id === activeId ? 'block' : 'hidden'}`}
          />
        ))}
      </div>
    </div>
  );
}
