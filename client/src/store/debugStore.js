import { create } from 'zustand';
import { applyDebugEvent, createDebugSession, transitionDebugSession } from '../debug/debugSession.js';

/** Separate debugger state; normal Run output never writes to this store. */
export const useDebugStore = create((set, get) => ({
  sessions: {},
  activeDebugSessionId: null,
  breakpointDrafts: {},

  startSession: (config) => {
    const session = createDebugSession(config);
    session.breakpoints = Array.isArray(config.breakpoints) ? config.breakpoints : [];
    set((state) => ({
      sessions: { ...state.sessions, [session.debugSessionId]: session },
      activeDebugSessionId: session.debugSessionId,
    }));
    return session;
  },

  adoptSession: (localId, remote) => set((state) => {
    const current = state.sessions[localId];
    if (!current || !remote?.debugSessionId || !remote?.executionId) return state;
    const session = { ...current, debugSessionId: remote.debugSessionId, executionId: remote.executionId, sourceFile: remote.sourceFile || current.sourceFile, state: 'running' };
    const sessions = { ...state.sessions, [remote.debugSessionId]: session };
    delete sessions[localId];
    return { sessions, activeDebugSessionId: remote.debugSessionId };
  }),

  toggleBreakpoint: (sourceFile, line) => set((state) => {
    if (!Number.isInteger(line) || line < 1) return state;
    const current = state.breakpointDrafts[sourceFile] || [];
    const next = current.some((item) => item.line === line)
      ? current.filter((item) => item.line !== line)
      : [...current, { line, verified: false }].sort((a, b) => a.line - b.line);
    return { breakpointDrafts: { ...state.breakpointDrafts, [sourceFile]: next } };
  }),

  setSessionData: (debugSessionId, patch) => set((state) => {
    const session = state.sessions[debugSessionId];
    if (!session) return state;
    return { sessions: { ...state.sessions, [debugSessionId]: { ...session, ...patch } } };
  }),

  applyEvent: (event) => {
    const session = get().sessions[event?.debugSessionId];
    const result = applyDebugEvent(session, event);
    if (!result.ok) return result;
    set((state) => ({ sessions: { ...state.sessions, [session.debugSessionId]: result.session } }));
    return result;
  },

  stopSession: (debugSessionId) => {
    const session = get().sessions[debugSessionId];
    const result = transitionDebugSession(session, 'stopped');
    if (!result.ok) return result;
    set((state) => ({ sessions: { ...state.sessions, [debugSessionId]: result.session } }));
    return result;
  },

  clearSession: (debugSessionId) => set((state) => {
    const sessions = { ...state.sessions };
    delete sessions[debugSessionId];
    return {
      sessions,
      activeDebugSessionId: state.activeDebugSessionId === debugSessionId ? null : state.activeDebugSessionId,
    };
  }),
}));
