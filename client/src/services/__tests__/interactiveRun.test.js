// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startInteractiveSession, interactiveWsUrl } from '../interactiveRun.js';

/**
 * A controllable WebSocket double: it records every frame the client sends and
 * lets the test push server messages back. It mirrors the property-style
 * handlers (onopen/onmessage/onclose/onerror) and the OPEN constant the real
 * transport uses, so the service is exercised exactly as a browser would drive
 * it.
 */
class FakeWebSocket {
  static OPEN = 1;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = FakeWebSocket.OPEN;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    FakeWebSocket.instances.push(this);
    setTimeout(() => this.onopen && this.onopen(), 0);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose && this.onclose();
  }
  // Test helper: deliver one server frame.
  emit(msg) {
    this.onmessage && this.onmessage({ data: JSON.stringify(msg) });
  }
  get last() {
    return this.sent[this.sent.length - 1];
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('interactiveRun — shared interactive WebSocket transport', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    global.WebSocket = FakeWebSocket;
  });
  afterEach(() => {
    vi.unstubAllGlobals?.();
  });

  it('builds the /api/interactive endpoint from the document origin', () => {
    expect(interactiveWsUrl()).toMatch(/\/api\/interactive$/);
  });

  it('sends a start frame with the language + source once the socket opens', async () => {
    const onMessage = vi.fn();
    const session = startInteractiveSession({ language: 'python', sourceCode: 'print(1)', onMessage });
    await tick();
    const ws = FakeWebSocket.instances[0];
    expect(ws.sent[0]).toEqual({ type: 'start', language: 'python', sourceCode: 'print(1)' });
    ws.emit({ type: 'stdout', data: '1\n' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'stdout', data: '1\n' });
    session.close();
  });

  it('invokes onOpen when the session is live and forwards stdin frames', async () => {
    const onOpen = vi.fn();
    const session = startInteractiveSession({ language: 'python', sourceCode: 'x', onOpen });
    await tick();
    expect(onOpen).toHaveBeenCalledTimes(1);
    session.sendStdin('Alice\n');
    expect(FakeWebSocket.instances[0].last).toEqual({ type: 'stdin', data: 'Alice\n' });
    session.close();
  });

  it('resolves closed with the exit code and stops listening after an exit', async () => {
    const onMessage = vi.fn();
    const session = startInteractiveSession({ language: 'python', sourceCode: 'x', onMessage });
    await tick();
    const ws = FakeWebSocket.instances[0];
    ws.emit({ type: 'exit', code: 0 });
    await expect(session.closed).resolves.toMatchObject({ code: 0 });
    // A late duplicate is ignored: the run settled once.
    ws.emit({ type: 'exit', code: 7 });
    const result = await session.closed;
    expect(result.code).toBe(0);
  });

  it('stop() sends a stop request and settles the session as stopped', async () => {
    const session = startInteractiveSession({ language: 'python', sourceCode: 'x' });
    await tick();
    const ws = FakeWebSocket.instances[0];
    session.stop();
    expect(ws.sent.some((m) => m.type === 'stop')).toBe(true);
    await expect(session.closed).resolves.toMatchObject({ stopped: true });
  });

  it('a socket that drops without an exit still settles (no hung session)', async () => {
    const session = startInteractiveSession({ language: 'python', sourceCode: 'x' });
    await tick();
    const ws = FakeWebSocket.instances[0];
    ws.close(); // server vanished mid-run, no exit frame
    await expect(session.closed).resolves.toMatchObject({ closed: true });
  });

  it('ignores malformed frames rather than throwing', async () => {
    const onMessage = vi.fn();
    const session = startInteractiveSession({ language: 'python', sourceCode: 'x', onMessage });
    await tick();
    const ws = FakeWebSocket.instances[0];
    ws.onmessage({ data: 'not-json{' });
    expect(onMessage).not.toHaveBeenCalled();
    session.close();
  });
});
