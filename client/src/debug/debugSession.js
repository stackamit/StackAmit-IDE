/**
 * Debugger foundation contract.
 *
 * This module deliberately contains no runtime adapter and never invents
 * debugger data. It validates the identity and lifecycle of events that a real
 * adapter (DAP or otherwise) may provide in a later phase.
 */

export const DEBUG_SESSION_STATES = Object.freeze([
  'starting',
  'running',
  'paused',
  'stopped',
  'terminated',
  'failed',
]);

export const DEBUG_EVENT_TYPES = Object.freeze([
  'debugStarted',
  'debugOutput',
  'debugPaused',
  'debugContinued',
  'breakpointHit',
  'stackTrace',
  'variables',
  'debugTerminated',
  'debugError',
]);

const TRANSITIONS = Object.freeze({
  starting: new Set(['running', 'stopped', 'terminated', 'failed']),
  running: new Set(['paused', 'stopped', 'terminated', 'failed']),
  paused: new Set(['running', 'stopped', 'terminated', 'failed']),
  stopped: new Set(),
  terminated: new Set(),
  failed: new Set(),
});

function id(prefix) {
  try {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  } catch {
    /* Fall through for older WebViews. */
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value;
}

export function createDebugSession({ executionId, language, sourceFile = null } = {}) {
  nonEmpty(executionId, 'executionId');
  nonEmpty(language, 'language');
  if (sourceFile !== null && typeof sourceFile !== 'string') throw new TypeError('sourceFile must be a string or null.');
  return {
    debugSessionId: id('debug'),
    executionId,
    language,
    sourceFile,
    state: 'starting',
    startedAt: Date.now(),
    stoppedAt: null,
    breakpoints: [],
    scopes: [],
    threads: [],
    consoleResults: [],
    dapResponses: {},
    currentFrame: null,
    callStack: [],
    variables: [],
    watches: [],
    debugOutput: [],
    error: null,
  };
}

export function transitionDebugSession(session, nextState, patch = {}) {
  if (!session || typeof session !== 'object') return { ok: false, error: 'Debug session is required.' };
  if (!DEBUG_SESSION_STATES.includes(nextState)) return { ok: false, error: `Invalid debug state: ${nextState}.` };
  if (session.state !== nextState && !TRANSITIONS[session.state]?.has(nextState)) {
    return { ok: false, error: `Invalid debug transition: ${session.state} -> ${nextState}.` };
  }
  const next = { ...session, ...patch, state: nextState };
  if (['stopped', 'terminated', 'failed'].includes(nextState) && !next.stoppedAt) next.stoppedAt = Date.now();
  return { ok: true, session: next };
}

export function validateDebugEvent(event) {
  if (!event || typeof event !== 'object') return { ok: false, error: 'Debug event must be an object.' };
  if (!DEBUG_EVENT_TYPES.includes(event.type)) return { ok: false, error: `Unknown debug event type: ${event.type}.` };
  if (typeof event.debugSessionId !== 'string' || !event.debugSessionId) return { ok: false, error: 'debugSessionId is required.' };
  if (typeof event.executionId !== 'string' || !event.executionId) return { ok: false, error: 'executionId is required.' };
  return { ok: true };
}

export function applyDebugEvent(session, event) {
  const valid = validateDebugEvent(event);
  if (!valid.ok) return valid;
  if (!session || event.debugSessionId !== session.debugSessionId || event.executionId !== session.executionId) {
    return { ok: false, error: 'Debug event does not belong to this session.' };
  }
  if (['stopped', 'terminated', 'failed'].includes(session.state)) {
    return { ok: false, error: 'Debug event belongs to an ended session.' };
  }

  switch (event.type) {
    case 'debugStarted':
      return transitionDebugSession(session, 'running', { error: null });
    case 'debugPaused':
      return transitionDebugSession(session, 'paused', { currentFrame: event.frame ?? session.currentFrame });
    case 'debugContinued':
      return transitionDebugSession(session, 'running');
    case 'breakpointHit':
      return transitionDebugSession(session, 'paused', { currentFrame: event.frame ?? session.currentFrame });
    case 'stackTrace':
      return { ok: true, session: { ...session, callStack: Array.isArray(event.frames) ? event.frames : [] } };
    case 'variables':
      return { ok: true, session: { ...session, variables: Array.isArray(event.variables) ? event.variables : [] } };
    case 'debugOutput':
      return { ok: true, session: { ...session, debugOutput: [...session.debugOutput, event.output ?? event.data ?? ''].slice(-1000) } };
    case 'debugTerminated':
      return transitionDebugSession(session, 'terminated');
    case 'debugError':
      return transitionDebugSession(session, 'failed', { error: String(event.error || event.message || 'Debugger error.') });
    default:
      return { ok: false, error: `Unsupported debug event type: ${event.type}.` };
  }
}
