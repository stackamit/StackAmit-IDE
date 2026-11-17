import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Play, Eraser, RotateCcw, Ban, TerminalSquare, Radio } from 'lucide-react';
import { startInteractiveSession } from '../../services/interactiveRun.js';
import { createInteractiveOutputBuffer } from '../../services/interactiveOutput.js';

let uid = 0;
const nextId = () => ++uid;

// Colour per log-line kind (terminal aesthetic, adapts to theme).
const KIND_CLASS = {
  banner: 'text-slate-500',
  cmd: 'text-brand-400',
  out: 'text-slate-100',
  err: 'text-rose-400',
  compile: 'text-amber-400',
  input: 'text-sky-400',
  info: 'text-slate-400',
  ok: 'text-emerald-400',
  fail: 'text-rose-400',
  muted: 'text-slate-500',
};

/**
 * An interactive terminal console with two execution modes.
 *
 * - Batch (default): talks to the configured provider (Wandbox/Piston). Input
 *   lines typed at the prompt are queued and sent as stdin with each Run — the
 *   program runs to completion in one request, so it can't pause for input.
 * - Interactive (local): runs the program as a live process on the server and
 *   streams I/O over a WebSocket, so you type each answer when the program
 *   actually asks for it. Only offered when the server reports a usable runtime.
 *
 * The parent owns batch execution via `onExecute`; for interactive mode it
 * supplies `languageKey` + `getCode()` so the terminal can start a session.
 */
const Terminal = forwardRef(function Terminal(
  {
    languageLabel,
    onExecute,
    disabled,
    readsStdin = false,
    onNotify,
    interactiveAvailable = false,
    runtimeAvailable = true,
    languageKey = '',
    getCode,
    onRequestInstall,
  },
  ref,
) {
  const [lines, setLines] = useState([]);
  const [stdinLines, setStdinLines] = useState([]);
  const [value, setValue] = useState('');
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState('batch');
  const [sessionActive, setSessionActive] = useState(false);

  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  // The live interactive session handle from the shared transport service
  // (services/interactiveRun.js) — the same one the IDE Output panel uses.
  const sessionRef = useRef(null);
  const outputBufferRef = useRef(null);
  const mounted = useRef(false);

  const push = useCallback((kind, text, options = {}) => {
    setLines((prev) => {
      if (options.replace && prev.length) {
        const index = [...prev].findLastIndex((line) => line.stream === options.stream);
        if (index >= 0) {
          const last = prev[index];
          return [...prev.slice(0, index), { ...last, text }, ...prev.slice(index + 1)];
        }
      }
      return [...prev, { id: nextId(), kind, text, stream: options.stream || kind }];
    });
  }, []);

  const currentStdin = useCallback(() => {
    return stdinLines.length ? stdinLines.join('\n') + '\n' : '';
  }, [stdinLines]);

  // ---- Batch execution (request/response via the provider) ----
  const runBatch = useCallback(
    async (force = false) => {
      if (running) return;
      const stdin = currentStdin();
      if (!force && !stdin && readsStdin) {
        push('info', 'This program reads input. Either switch to Interactive mode to answer prompts live, or type each value at the "stdin>" prompt and press Enter to queue them — in the exact order the program reads them (e.g. the choice, then the numbers) — then press Run. Use /run to execute with no input.');
        inputRef.current?.focus();
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      push('cmd', `$ run ${languageLabel}`);
      try {
        const r = await onExecute({ stdin, signal: controller.signal });
        if (r.compileMessage && r.status !== 'completed') push('compile', r.compileMessage.replace(/\n+$/, ''));
        if (r.stdout) push('out', String(r.stdout).replace(/\n+$/, ''));
        if (r.stderr && r.status !== 'compile_error') push('err', String(r.stderr).replace(/\n+$/, ''));
        if (!r.stdout && !r.stderr && r.status === 'completed') push('muted', '(no output)');

        const time = typeof r.executionTimeMs === 'number' ? ` · ${r.executionTimeMs}ms` : '';
        if (r.success) push('ok', `✓ Finished${time} · exit ${r.exitCode ?? 0}`);
        else if (r.status === 'compile_error') push('fail', `✗ Compilation failed`);
        else if (r.status === 'timeout') push('fail', `✗ Timed out`);
        else push('fail', `✗ Runtime error · exit ${r.exitCode ?? 'n/a'}`);
      } catch (err) {
        push('fail', `✗ ${err.message || 'Execution failed.'}`);
        onNotify?.('error', err.message || 'Execution failed.');
      } finally {
        setRunning(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [running, languageLabel, onExecute, currentStdin, push, onNotify, readsStdin],
  );

  // ---- Interactive execution (live process over the shared WS transport) ----
  const closeSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    session?.close();
    setSessionActive(false);
    setRunning(false);
  }, []);

  const handleServerMessage = useCallback(
    (msg) => {
      switch (msg.type) {
        case 'stdout': outputBufferRef.current?.feed('out', msg.data); break;
        case 'stderr': outputBufferRef.current?.feed('err', msg.data); break;
        case 'compile': outputBufferRef.current?.feed('compile', msg.data); break;
        case 'info': outputBufferRef.current?.feed('info', msg.data); break;
        case 'stdin':
          outputBufferRef.current?.flush();
          outputBufferRef.current?.feed('input', `> ${String(msg.data ?? '').replace(/\r?\n$/, '')}\n`);
          break;
        case 'error': push('fail', `✗ ${String(msg.data ?? '').trim()}`); break;
        case 'exit': {
          outputBufferRef.current?.flush();
          if (msg.stopped) push('muted', '■ Stopped.');
          else if (typeof msg.code === 'number') {
            push(msg.code === 0 ? 'ok' : 'fail', msg.code === 0 ? '✓ Finished · exit 0' : `✗ Exited · code ${msg.code}`);
          }
          closeSession();
          break;
        }
        default:
          break;
      }
    },
    [push, closeSession],
  );

  const startInteractive = useCallback(() => {
    if (running) return;
    // No local toolchain for this language → offer to install it (with consent)
    // instead of firing a run that would only error out.
    if (!runtimeAvailable) {
      push('info', `No local ${languageLabel} runtime detected. Opening the installer so you can add it…`);
      onRequestInstall?.(languageKey);
      return;
    }
    const code = (getCode?.() || '').trim();
    if (!code) {
      push('fail', '✗ Source code is empty.');
      return;
    }
    setRunning(true);
    setSessionActive(false);
    outputBufferRef.current = createInteractiveOutputBuffer(({ kind, text, replace, stream }) => {
      const displayKind = kind === 'out' ? 'out' : kind === 'err' ? 'err' : kind;
      push(displayKind, text, { replace, stream });
    });
    push('cmd', `$ run ${languageLabel} · interactive`);
    const session = startInteractiveSession({
      language: languageKey,
      sourceCode: getCode?.() || '',
      onOpen: () => {
        setSessionActive(true);
        inputRef.current?.focus();
      },
      onMessage: (msg) => {
        try { handleServerMessage(msg); } catch { /* ignore malformed */ }
      },
    });
    if (!session) {
      push('fail', '✗ Could not open the interactive session.');
      setRunning(false);
      return;
    }
    sessionRef.current = session;
    session.closed.then(() => {
      // Reset only if this exact session is still the current one — a Stop or a
      // new run may already have swapped it out. handleServerMessage rendered the
      // exit/stop line for any normal finish, so nothing is printed here.
      if (sessionRef.current === session) {
        sessionRef.current = null;
        setSessionActive(false);
        setRunning(false);
        inputRef.current?.focus();
      }
    });
  }, [running, getCode, languageKey, languageLabel, push, handleServerMessage, runtimeAvailable, onRequestInstall]);

  const stopInteractive = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    outputBufferRef.current?.flush();
    session?.stop();
    setSessionActive(false);
    setRunning(false);
  }, []);

  // Unified Run: dispatch to the active mode.
  const run = useCallback(
    (force = false) => {
      if (mode === 'interactive') startInteractive();
      else runBatch(force);
    },
    [mode, startInteractive, runBatch],
  );

  const switchMode = useCallback(
    (next) => {
      if (next === mode) return;
      if (sessionRef.current) stopInteractive();
      setMode(next);
      if (next === 'interactive') {
        if (!runtimeAvailable) {
          push('info', `No local ${languageLabel} runtime was detected on the server. Install its toolchain (e.g. gcc/g++/JDK) to run interactively, or keep using Batch mode.`);
        } else {
          push('info', 'Interactive mode: press Run to start the program, then type at the prompt when it asks for input.');
        }
      } else {
        push('info', 'Batch mode: type input lines to queue them, then press Run.');
      }
    },
    [mode, stopInteractive, push, runtimeAvailable, languageLabel],
  );

  const clear = useCallback(() => {
    setLines([]);
    push('banner', 'StackAmit-IDE Terminal — Batch queues input then runs; Interactive answers prompts live.');
  }, [push]);

  useImperativeHandle(ref, () => ({
    run,
    clear,
    interrupt: () => (mode === 'interactive' ? stopInteractive() : abortRef.current?.abort()),
  }), [run, clear, mode, stopInteractive]);

  // Banner once on mount.
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    push('banner', 'StackAmit-IDE Terminal — Batch queues input then runs; Interactive answers prompts live.');
    push('info', 'Commands: /run /stop /clear /stdin /reset-stdin /help');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to the newest line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, running]);

  // Close any live session when the terminal unmounts.
  useEffect(() => () => { try { sessionRef.current?.close(); } catch { /* ignore */ } }, []);

  const submitLine = useCallback(
    (raw) => {
      // Slash commands work in both modes.
      if (raw.startsWith('/')) {
        const [cmd] = raw.trim().split(/\s+/);
        push('cmd', raw);
        switch (cmd) {
          case '/run': run(true); break;
          case '/stop': if (mode === 'interactive') stopInteractive(); else abortRef.current?.abort(); break;
          case '/clear': clear(); break;
          case '/stdin': push('info', stdinLines.length ? stdinLines.join('\n') : '(no queued stdin)'); break;
          case '/reset-stdin': setStdinLines([]); push('info', 'Queued stdin cleared.'); break;
          case '/help': push('info', 'Batch: plain lines queue stdin. Interactive: plain lines go to the running program. Commands: /run /stop /clear /stdin /reset-stdin /help'); break;
          default: push('fail', `Unknown command: ${cmd}`);
        }
        return;
      }

      if (mode === 'interactive') {
        if (sessionActive && sessionRef.current) {
          sessionRef.current.sendStdin(`${raw}\n`);
        } else {
          push('info', 'Press Run to start the program, then type here when it asks for input.');
        }
        return;
      }

      // Batch: queue the line as stdin.
      setStdinLines((prev) => [...prev, raw]);
      push('input', `> ${raw}`);
    },
    [push, run, clear, stopInteractive, mode, sessionActive, stdinLines],
  );

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitLine(value);
      setValue('');
    }
  };

  const inputDisabled = mode === 'interactive' ? running && !sessionActive : running;
  const placeholder =
    mode === 'interactive'
      ? sessionActive
        ? 'Answer the program — Enter sends this line to the running process'
        : 'Press Run to start, then type here when it prompts'
      : 'Type an input line, press Enter to queue · / for commands';

  return (
    <section className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100 dark:bg-black" aria-label="Terminal">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <TerminalSquare size={15} className="text-brand-400" />
        <span className="text-xs font-semibold tracking-wide text-slate-300">Terminal</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{languageLabel}</span>

        {interactiveAvailable ? (
          <div className="ml-1 flex items-center rounded bg-white/5 p-0.5 text-[10px]" role="group" aria-label="Execution mode">
            <button
              type="button"
              onClick={() => switchMode('batch')}
              aria-pressed={mode === 'batch'}
              className={`rounded px-1.5 py-0.5 font-medium transition ${mode === 'batch' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Batch
            </button>
            <button
              type="button"
              onClick={() => switchMode('interactive')}
              aria-pressed={mode === 'interactive'}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition ${mode === 'interactive' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Interactive
            </button>
          </div>
        ) : null}

        {mode === 'interactive' && !runtimeAvailable ? (
          <button
            type="button"
            onClick={() => onRequestInstall?.(languageKey)}
            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400 hover:bg-amber-500/25"
            title="No local runtime detected — click to install it"
          >
            no local runtime · install
          </button>
        ) : null}

        {sessionActive ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400">
            <Radio size={11} className="animate-pulse" /> live
          </span>
        ) : null}

        <span className="ml-auto text-[10px] text-slate-500">
          {mode === 'interactive'
            ? (sessionActive ? 'session live' : running ? 'starting…' : 'idle')
            : `${stdinLines.length} queued stdin line${stdinLines.length === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          onClick={() => setStdinLines([])}
          className="focus-ring inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-slate-200"
          title="Clear queued stdin"
        >
          <RotateCcw size={12} /> Stdin
        </button>
        <button
          type="button"
          onClick={clear}
          className="focus-ring inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-white/10 hover:text-slate-200"
          title="Clear terminal"
        >
          <Eraser size={12} /> Clear
        </button>
        {running ? (
          <button
            type="button"
            onClick={() => (mode === 'interactive' ? stopInteractive() : abortRef.current?.abort())}
            className="focus-ring inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/30"
            title="Interrupt"
          >
            <Ban size={12} /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => run()}
            disabled={disabled}
            className="focus-ring inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-brand-500 disabled:opacity-60"
            title="Run code (Ctrl/⌘ + Enter)"
          >
            <Play size={12} /> Run
          </button>
        )}
      </div>

      {/* Log */}
      <div
        ref={scrollRef}
        className="scroll-slim min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[13px] leading-relaxed"
        onClick={() => inputRef.current?.focus()}
        role="log"
        aria-live="polite"
      >
        {lines.map((ln) => (
          <div key={ln.id} className={`whitespace-pre-wrap break-words ${KIND_CLASS[ln.kind] || 'text-slate-200'}`}>
            {ln.text || '\u00A0'}
          </div>
        ))}
        {running && mode === 'batch' ? <div className="text-slate-400">⋯ running…</div> : null}
      </div>

      {/* Prompt */}
      <div className="flex items-center gap-2 border-t border-white/10 px-3 py-1.5 font-mono text-[13px]">
        <span className="shrink-0 select-none text-emerald-400">
          <span className="text-slate-500">{mode === 'interactive' ? 'in' : 'stdin'}</span>&gt;
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={inputDisabled}
          spellCheck={false}
          autoComplete="off"
          aria-label="Terminal input"
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-slate-100 placeholder:text-slate-600 focus:outline-none"
        />
      </div>
    </section>
  );
});

export default Terminal;
