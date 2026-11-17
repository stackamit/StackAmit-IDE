import { describe, expect, it } from 'vitest';
import {
  applyDebugEvent,
  createDebugSession,
  transitionDebugSession,
  validateDebugEvent,
} from '../debugSession.js';

const event = (session, type, extra = {}) => ({
  debugSessionId: session.debugSessionId,
  executionId: session.executionId,
  type,
  ...extra,
});

describe('debug session foundation', () => {
  it('creates an independent starting session with identity and lifecycle fields', () => {
    const session = createDebugSession({ executionId: 'exec-1', language: 'python', sourceFile: '/main.py' });
    expect(session).toMatchObject({ executionId: 'exec-1', language: 'python', sourceFile: '/main.py', state: 'starting' });
    expect(session.debugSessionId).toMatch(/^debug-/);
    expect(session.debugOutput).toEqual([]);
  });

  it('accepts only valid state transitions', () => {
    const session = createDebugSession({ executionId: 'exec-1', language: 'python' });
    expect(transitionDebugSession(session, 'running').ok).toBe(true);
    expect(transitionDebugSession({ ...session, state: 'terminated' }, 'running').ok).toBe(false);
  });

  it('rejects malformed, stale, and unrelated events', () => {
    const session = createDebugSession({ executionId: 'exec-1', language: 'python' });
    expect(validateDebugEvent({ type: 'debugStarted' }).ok).toBe(false);
    expect(applyDebugEvent(session, event({ ...session, executionId: 'other' }, 'debugStarted')).ok).toBe(false);
    expect(applyDebugEvent(session, event(session, 'not-real')).ok).toBe(false);
  });

  it('keeps debugger output separate and transitions real event states', () => {
    const session = createDebugSession({ executionId: 'exec-1', language: 'python' });
    const started = applyDebugEvent(session, event(session, 'debugStarted')).session;
    const output = applyDebugEvent(started, event(started, 'debugOutput', { data: 'real adapter output' })).session;
    expect(output.state).toBe('running');
    expect(output.debugOutput).toEqual(['real adapter output']);
    const paused = applyDebugEvent(output, event(output, 'debugPaused', { frame: { file: '/main.py', line: 2 } })).session;
    expect(paused.state).toBe('paused');
    expect(paused.currentFrame.line).toBe(2);
    const ended = applyDebugEvent(paused, event(paused, 'debugTerminated')).session;
    expect(ended.state).toBe('terminated');
    expect(applyDebugEvent(ended, event(ended, 'debugOutput', { data: 'late' })).ok).toBe(false);
  });
});
