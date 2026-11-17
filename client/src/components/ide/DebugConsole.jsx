import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bug, CircleStop, Play, RotateCcw, StepForward, CornerDownLeft, Trash2, ChevronRight, RefreshCw } from 'lucide-react';
import { useDebugStore } from '../../store/debugStore.js';
import { useIdeStore } from '../../store/ideStore.js';
import { startWebDebug } from '../../debug/debugClient.js';
import { http } from '../../services/api.js';
import { workspace } from '../../services/workspace.js';
import { useUserAuth } from '../../context/UserAuthContext.jsx';

const randomId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function Button({ title, disabled, onClick, children }) {
  return <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35">{children}</button>;
}

export default function DebugConsole({ actions }) {
  const activeDoc = useIdeStore((s) => s.activePath ? s.docs[s.activePath] : null);
  const { user } = useUserAuth();
  const sessions = useDebugStore((s) => s.sessions);
  const activeId = useDebugStore((s) => s.activeDebugSessionId);
  const drafts = useDebugStore((s) => s.breakpointDrafts);
  const startSession = useDebugStore((s) => s.startSession);
  const adoptSession = useDebugStore((s) => s.adoptSession);
  const applyEvent = useDebugStore((s) => s.applyEvent);
  const setSessionData = useDebugStore((s) => s.setSessionData);
  const stopSession = useDebugStore((s) => s.stopSession);
  const clearSession = useDebugStore((s) => s.clearSession);
  const session = activeId ? sessions[activeId] : null;
  const clientRef = useRef(null);
  const [capability, setCapability] = useState(null);
  const [capabilityError, setCapabilityError] = useState('');
  const [expression, setExpression] = useState('');
  const [watch, setWatch] = useState('');
  const [watches, setWatches] = useState([]);
  const [checkingCapability, setCheckingCapability] = useState(false);

  const refreshCapability = useCallback(() => {
    setCheckingCapability(true);
    setCapabilityError('');
    const check = workspace.mode === 'desktop' && window.stackamit?.debug
      ? window.stackamit.debug.capability()
      : http.get('/api/debug/capabilities', { withCredentials: true }).then(({ data }) => data.python);
    return check.then((data) => setCapability(data)).catch((error) => setCapabilityError(error.response?.data?.message || error.message || 'Debugger capability check failed.')).finally(() => setCheckingCapability(false));
  }, []);

  useEffect(() => {
    refreshCapability()?.catch?.(() => {});
  }, [refreshCapability, user, workspace.mode]);

  const onMessage = useCallback((message) => {
    const current = useDebugStore.getState().sessions[useDebugStore.getState().activeDebugSessionId];
    if (message.type === 'debugStarted') {
      if (current) adoptSession(current.debugSessionId, message);
      useDebugStore.getState().applyEvent({ type: 'debugStarted', debugSessionId: message.debugSessionId, executionId: message.executionId });
    } else if (message.type === 'debugPaused') {
      useDebugStore.getState().applyEvent({ type: 'debugPaused', debugSessionId: message.debugSessionId, executionId: message.executionId, frame: { threadId: message.threadId, reason: message.reason } });
      clientRef.current?.request('stackTrace', { threadId: message.threadId, levels: 50 });
    } else if (message.type === 'debugContinued') {
      useDebugStore.getState().applyEvent({ type: 'debugContinued', debugSessionId: message.debugSessionId, executionId: message.executionId });
    } else if (message.type === 'breakpoint') {
      const currentSession = useDebugStore.getState().sessions[message.debugSessionId];
      const verified = message.breakpoint;
      if (currentSession && verified?.line) {
        setSessionData(message.debugSessionId, {
          breakpoints: currentSession.breakpoints.map((item) => item.line === verified.line
            ? { ...item, verified: verified.verified !== false, message: verified.message || null }
            : item),
        });
      }
    } else if (message.type === 'debugOutput') {
      useDebugStore.getState().applyEvent({ type: 'debugOutput', debugSessionId: message.debugSessionId, executionId: message.executionId, data: message.data, output: { category: message.category, text: message.data } });
    } else if (message.type === 'debugTerminated') {
      useDebugStore.getState().applyEvent({ type: 'debugTerminated', debugSessionId: message.debugSessionId, executionId: message.executionId });
    } else if (message.type === 'debugError') {
      const currentSession = useDebugStore.getState().sessions[message.debugSessionId || useDebugStore.getState().activeDebugSessionId];
      if (currentSession) useDebugStore.getState().applyEvent({ type: 'debugError', debugSessionId: currentSession.debugSessionId, executionId: currentSession.executionId, error: message.error });
    } else if (message.type === 'dapResponse') {
      const response = message.message;
      const currentSession = useDebugStore.getState().sessions[message.debugSessionId];
      if (!currentSession) return;
      if (response.command === 'stackTrace') setSessionData(message.debugSessionId, { callStack: response.body?.stackFrames || [], currentFrame: response.body?.stackFrames?.[0] || currentSession.currentFrame });
      if (response.command === 'scopes') setSessionData(message.debugSessionId, { scopes: response.body?.scopes || [] });
      if (response.command === 'variables') setSessionData(message.debugSessionId, { variables: response.body?.variables || [] });
      if (response.command === 'threads') setSessionData(message.debugSessionId, { threads: response.body?.threads || [] });
      if (response.command === 'evaluate') setSessionData(message.debugSessionId, { consoleResults: [...(currentSession.consoleResults || []), response.body || { result: 'No result' }].slice(-100) });
    } else if (message.type === 'debugInitialized') {
      const currentSession = useDebugStore.getState().sessions[message.debugSessionId];
      if (currentSession) {
        clientRef.current?.request('setBreakpoints', { source: { path: currentSession.sourceFile || activeDoc?.path }, breakpoints: currentSession.breakpoints.map((item) => ({ line: item.line })) });
        clientRef.current?.request('setExceptionBreakpoints', { filters: ['raised', 'uncaught'] });
        clientRef.current?.request('configurationDone');
      }
    }
  }, [activeDoc?.path, adoptSession, setSessionData]);

  const start = useCallback(() => {
    if (!activeDoc || activeDoc.language !== 'python' || !capability?.available || session?.state === 'running' || session?.state === 'paused') return;
    const local = startSession({ executionId: randomId('debug-exec'), language: 'python', sourceFile: activeDoc.path, breakpoints: drafts[activeDoc.path] || [] });
    const client = startWebDebug({ sourceCode: activeDoc.content, sourceFile: activeDoc.path, executionId: local.executionId, onMessage, onClose: () => useDebugStore.getState().stopSession(useDebugStore.getState().activeDebugSessionId) });
    clientRef.current = client;
    if (!client) stopSession(local.debugSessionId);
  }, [activeDoc, capability, session?.state, drafts, startSession, onMessage, stopSession]);

  const command = (name, args = {}) => clientRef.current?.request(name, args);
  const stop = () => { clientRef.current?.stop(); clientRef.current?.close(); if (session) stopSession(session.debugSessionId); };
  const restart = () => { stop(); setTimeout(start, 50); };
  const paused = session?.state === 'paused';
  const running = session?.state === 'running';
  const selectedFrame = session?.currentFrame || session?.callStack?.[0];
  const evaluate = (value) => { if (value.trim()) { command('evaluate', { expression: value, frameId: selectedFrame?.id, context: 'repl' }); setExpression(''); } };
  const addWatch = () => { if (!watch.trim()) return; setWatches((items) => [...items, watch.trim()]); setWatch(''); };
  const output = useMemo(() => session?.debugOutput || [], [session?.debugOutput]);

  return <div className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-100">
    <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-2 py-1">
      <Bug size={14} className="mr-1 text-brand-400" /><span className="mr-2 text-xs font-semibold">Python Debugger</span>
      <Button title="Start Debugging" disabled={!(capability?.debuggerAvailable ?? capability?.available) || !activeDoc || activeDoc.language !== 'python' || running || paused} onClick={start}><Play size={12} />Start</Button>
      <Button title="Continue" disabled={!paused} onClick={() => command('continue', { threadId: selectedFrame?.threadId || 1 })}><Play size={12} />Continue</Button>
      <Button title="Pause" disabled={!running} onClick={() => command('pause', { threadId: selectedFrame?.threadId || 1 })}><CircleStop size={12} />Pause</Button>
      <Button title="Step Over" disabled={!paused} onClick={() => command('next', { threadId: selectedFrame?.threadId || 1 })}><StepForward size={12} />Over</Button>
      <Button title="Step Into" disabled={!paused} onClick={() => command('stepIn', { threadId: selectedFrame?.threadId || 1 })}><StepForward size={12} />Into</Button>
      <Button title="Step Out" disabled={!paused} onClick={() => command('stepOut', { threadId: selectedFrame?.threadId || 1 })}><StepForward size={12} />Out</Button>
      <Button title="Restart" disabled={!session} onClick={restart}><RotateCcw size={12} />Restart</Button>
      <Button title="Stop" disabled={!session} onClick={stop}><CircleStop size={12} />Stop</Button>
      <button type="button" title="Refresh debugger capability" aria-label="Refresh debugger capability" onClick={refreshCapability} disabled={checkingCapability} className="ml-auto rounded p-1 text-slate-400 hover:bg-white/10 disabled:opacity-40"><RefreshCw size={12} className={checkingCapability ? 'animate-spin' : ''} /></button>
      <span className="ml-auto text-[10px] text-slate-500">{session?.state || (capability ? 'ready' : 'checking…')}</span>
    </div>
    {!user && capability?.debuggerAvailable ? <div className="border-b border-sky-500/20 bg-sky-500/10 p-3 text-xs text-sky-200">Guest debug mode uses the same rate-limited public execution policy as local runs. No account is required; never run secrets or private code here.</div> : null}
    {capabilityError ? <div className="border-b border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200">Debugger capability check failed: {capabilityError}</div> : null}
    {capability && !(capability.debuggerAvailable ?? capability.available) ? <div className="border-b border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200"><div>{capability.reason || 'Python debugging is unavailable.'}</div>{capability.setupInstructions ? <code className="mt-1 block whitespace-pre-wrap text-rose-100/90">{capability.setupInstructions}</code> : null}</div> : null}
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-hidden bg-white/10 md:grid-cols-3">
      <section className="min-h-0 overflow-auto bg-slate-950 p-2 md:col-span-1"><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Call Stack</h3>{session?.callStack?.length ? session.callStack.map((frame) => <button key={frame.id} type="button" className="flex w-full items-start gap-1 rounded px-1 py-1 text-left text-xs hover:bg-white/10" onClick={() => { setSessionData(session.debugSessionId, { currentFrame: frame }); const open = actions?.openFileByPath?.(activeDoc?.path); open?.then?.(() => actions?.revealInEditor?.(frame.line, frame.column || 1)); }}><ChevronRight size={12} className="mt-0.5 text-brand-400" /><span><span className="block text-slate-200">{frame.name}</span><span className="text-[10px] text-slate-500">{frame.source?.name || frame.source?.path || 'unknown'}:{frame.line}</span></span></button>) : <p className="text-xs text-slate-600">Pause execution to inspect frames.</p>}
        <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Variables</h3>{session?.variables?.length ? session.variables.map((item) => <div key={`${item.name}-${item.variablesReference}`} className="flex gap-2 px-1 py-0.5 font-mono text-xs"><span className="text-brand-300">{item.name}</span><span className="text-slate-300">{item.value}</span><span className="text-slate-600">{item.type}</span></div>) : <p className="text-xs text-slate-600">No paused variables.</p>}
        <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Watch</h3><div className="flex gap-1"><input value={watch} onChange={(e) => setWatch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addWatch()} className="min-w-0 flex-1 rounded bg-white/5 px-1.5 py-1 text-xs" placeholder="expression" /><button type="button" onClick={addWatch} className="rounded bg-white/10 px-2 text-xs">+</button></div>{watches.map((item) => <button type="button" key={item} className="mt-1 block w-full truncate text-left text-xs text-slate-300 hover:text-white" onClick={() => command('evaluate', { expression: item, frameId: selectedFrame?.id, context: 'watch' })}>{item}</button>)}</section>
      <section className="flex min-h-0 flex-col bg-slate-950 md:col-span-2"><div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-xs">{output.map((item, index) => <div key={index} className={item.category === 'stderr' ? 'text-rose-400' : item.category === 'stdout' ? 'text-slate-200' : 'text-sky-300'}>{item.text || item}</div>)}{session?.consoleResults?.map((item, index) => <div key={`result-${index}`} className="text-emerald-300">&gt; {item.result} <span className="text-slate-600">{item.type || ''}</span></div>)}{!output.length && !session?.consoleResults?.length ? <p className="text-slate-600">Start debugging to see real adapter output and expression results.</p> : null}</div><div className="flex items-center gap-2 border-t border-white/10 p-2"><CornerDownLeft size={13} className="text-brand-400" /><input value={expression} onChange={(e) => setExpression(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && evaluate(expression)} disabled={!paused} className="min-w-0 flex-1 bg-transparent text-xs outline-none" placeholder={paused ? 'Evaluate Python expression' : 'Expressions are available while paused'} /><button type="button" onClick={() => evaluate(expression)} disabled={!paused || !expression.trim()} className="rounded bg-brand-600 px-2 py-1 text-[11px] disabled:opacity-40">Evaluate</button><button type="button" title="Clear debug output" onClick={() => session && setSessionData(session.debugSessionId, { debugOutput: [], consoleResults: [] })} className="rounded p-1 text-slate-400 hover:bg-white/10"><Trash2 size={13} /></button></div></section>
    </div>
  </div>;
}

