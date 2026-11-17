// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { runBrowserJavaScript, RUNNER_HTML } from '../browserRun.js';

/**
 * The interactive input bridge + async completion contract for Web Mode's
 * in-page JavaScript runner, exercised against the REAL `runBrowserJavaScript`
 * outer harness. jsdom cannot execute the sandboxed iframe's module script, so
 * these tests drive the postMessage protocol directly: the harness creates its
 * own `sandbox="allow-scripts"` frame synchronously, we locate that frame, then
 * dispatch the messages the live harness would emit using ITS contentWindow as
 * the event source (so the origin guard accepts them) and record the messages
 * the outer posts back in. This proves the decision logic the task targets — a
 * run that awaits `prompt()` and a module that "finishes" while input is still
 * owed — without a browser, and complements the mocked UI wiring in
 * useIdeActions/BottomPanel.
 */

const TOKEN = 'rtest-token';

/** requestInput bridge: records prompts and lets the test answer them. */
function inputBridge() {
  const pending = {};
  const seen = [];
  const requestInput = ({ token, promptId, kind, message }) =>
    new Promise((resolve) => {
      seen.push({ token, promptId, kind, message });
      pending[promptId] = resolve;
    });
  const answer = (promptId, value) => {
    const resolve = pending[promptId];
    delete pending[promptId];
    if (resolve) resolve(value);
  };
  return { requestInput, answer, seen, pending };
}

/**
 * Start a real runBrowserJavaScript, then bind to the frame it created so the
 * test can synthesize sandbox→outer messages and observe outer→sandbox ones.
 */
function start(extra = {}) {
  const ib = inputBridge();
  const toSandbox = []; // messages the outer posts INTO the frame (start/reply)
  const promise = runBrowserJavaScript({
    source: 'async function main(){}\nmain();',
    token: TOKEN,
    requestInput: ib.requestInput,
    timeoutMs: 5000,
    ...extra,
  });
  // The harness appends its sandbox frame synchronously before returning.
  const frames = document.querySelectorAll('iframe[sandbox]');
  const frame = frames[frames.length - 1];
  if (!frame) throw new Error('runBrowserJavaScript did not create a sandbox frame');
  frame.contentWindow.postMessage = (msg) => {
    toSandbox.push(msg);
  };
  const emit = (data) =>
    window.dispatchEvent(
      new MessageEvent('message', { data: { __stackamitRun: 1, ...data }, source: frame.contentWindow }),
    );
  return { ib, frame, toSandbox, emit, promise };
}

// A tiny macrotask flush so the runner's "after the last input drains, settle on
// the next tick" logic runs; deterministic (no polling, no arbitrary length).
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  // Drop any frame a test left open (a completed run already removed its own) so
  // the next `start` binds to its own frame.
  document.querySelectorAll('iframe[sandbox]').forEach((f) => f.remove());
  vi.restoreAllMocks();
});

describe('runBrowserJavaScript — async completion gate (Phase 4)', () => {
  it('does not report success while an input request is still pending', async () => {
    const { ib, emit, promise } = start();
    let settled = false;
    const p = promise.then((r) => {
      settled = true;
      return r;
    });

    emit({ type: 'ready' });
    emit({ type: 'input-request', token: TOKEN, promptId: 'p1', kind: 'prompt', text: 'Enter your name:' });
    // The module "evaluated" and reported done, but a prompt is still owed —
    // exactly the premature-completion bug. The run must stay open.
    emit({ type: 'done', extra: { ok: true } });
    await tick();
    expect(settled).toBe(false);

    // The continuation runs only after the answer; its trailing output is kept.
    ib.answer('p1', 'Alice');
    emit({ type: 'stdout', text: 'Hello, Alice!' });
    const r = await p;
    expect(r.success).toBe(true);
    expect(r.stdout).toContain('Hello, Alice!');
  });

  it('resolves an awaited prompt with the submitted text (single input)', async () => {
    const { ib, emit, toSandbox, promise } = start();
    emit({ type: 'ready' });
    emit({ type: 'input-request', token: TOKEN, promptId: 'p1', kind: 'prompt', text: 'name' });
    expect(ib.seen[0]).toMatchObject({ promptId: 'p1', kind: 'prompt', message: 'name', token: TOKEN });
    ib.answer('p1', 'Amit');
    await tick(); // the answer is posted into the sandbox on a microtask
    // The answer is routed back into the sandbox tagged with the run token.
    const reply = toSandbox.find((m) => m.__stackamitInput === TOKEN);
    expect(reply).toMatchObject({ promptId: 'p1', value: 'Amit' });
    emit({ type: 'stdout', text: 'Hello, Amit!' });
    emit({ type: 'done', extra: { ok: true } });
    const r = await promise;
    expect(r.stdout).toBe('Hello, Amit!');
    expect(r.status).toBe('completed');
  });

  it('supports multiple sequential inputs, one at a time', async () => {
    const { ib, emit, promise } = start();
    emit({ type: 'ready' });
    emit({ type: 'input-request', token: TOKEN, promptId: 'p1', kind: 'prompt', text: 'name' });
    expect(ib.pending.p2).toBeUndefined(); // second prompt not asked yet
    ib.answer('p1', 'Amit');
    emit({ type: 'input-request', token: TOKEN, promptId: 'p2', kind: 'prompt', text: 'age' });
    ib.answer('p2', '21');
    emit({ type: 'stdout', text: 'Hello, Amit!' });
    emit({ type: 'stdout', text: 'Next year, you will be 22.' });
    emit({ type: 'done', extra: { ok: true } });
    const r = await promise;
    expect(r.stdout).toContain('Hello, Amit!');
    expect(r.stdout).toContain('Next year, you will be 22.');
    expect(ib.seen.map((s) => s.promptId)).toEqual(['p1', 'p2']);
  });

  it('accepts an empty string as valid input', async () => {
    const { ib, emit, toSandbox, promise } = start();
    emit({ type: 'ready' });
    emit({ type: 'input-request', token: TOKEN, promptId: 'p1', kind: 'prompt', text: 'q' });
    ib.answer('p1', '');
    await tick(); // the answer is posted into the sandbox on a microtask
    const reply = toSandbox.find((m) => m.__stackamitInput === TOKEN);
    expect(reply.value).toBe('');
    emit({ type: 'done', extra: { ok: true } });
    await promise;
    expect(toSandbox.some((m) => m.__stackamitInput === TOKEN && m.value === '')).toBe(true);
  });

  it('carries a numeric answer through verbatim for Number() by the program', async () => {
    const { ib, emit, promise } = start();
    emit({ type: 'ready' });
    emit({ type: 'input-request', token: TOKEN, promptId: 'p1', kind: 'prompt', text: 'age' });
    ib.answer('p1', '21');
    emit({ type: 'stdout', text: String(Number('21') + 1) });
    emit({ type: 'done', extra: { ok: true } });
    const r = await promise;
    expect(r.stdout).toBe('22');
  });

  it('ignores an input request tagged with another run token (stale isolation)', async () => {
    const { ib, emit, promise } = start();
    emit({ type: 'ready' });
    emit({ type: 'input-request', token: 'NOT-my-token', promptId: 'p1', kind: 'prompt', text: 'stale' });
    expect(ib.seen).toHaveLength(0); // never surfaced to the input bridge
    emit({ type: 'input-request', token: TOKEN, promptId: 'p2', kind: 'prompt', text: 'real' });
    expect(ib.seen.map((s) => s.promptId)).toEqual(['p2']);
    ib.answer('p2', 'ok');
    emit({ type: 'done', extra: { ok: true } });
    await promise;
  });

  it('delivers null (EOF) when the prompt is answered with null (cancel contract)', async () => {
    const { ib, emit, toSandbox, promise } = start();
    emit({ type: 'ready' });
    emit({ type: 'input-request', token: TOKEN, promptId: 'p1', kind: 'prompt', text: 'q' });
    ib.answer('p1', null);
    await tick(); // the answer is posted into the sandbox on a microtask
    const reply = toSandbox.find((m) => m.__stackamitInput === TOKEN);
    expect(reply.value).toBe(null);
    emit({ type: 'done', extra: { ok: true } });
    await promise;
  });

  it('releases a pending input and settles canceled when the run is aborted', async () => {
    const ac = new AbortController();
    const { ib, emit, promise } = start({ signal: ac.signal });
    emit({ type: 'ready' });
    emit({ type: 'input-request', token: TOKEN, promptId: 'p1', kind: 'prompt', text: 'q' });
    expect(ib.pending.p1).toBeTruthy();
    ac.abort();
    const r = await promise;
    expect(r.status).toBe('canceled');
    expect(r.canceled).toBe(true);
  });

  it('runs a program that never reads input normally', async () => {
    const { ib, emit, promise } = start();
    emit({ type: 'ready' });
    emit({ type: 'stdout', text: '2 + 2 = 4' });
    emit({ type: 'done', extra: { ok: true } });
    const r = await promise;
    expect(r.success).toBe(true);
    expect(r.stdout).toBe('2 + 2 = 4');
    expect(ib.seen).toHaveLength(0);
  });

  it('surfaces a runtime failure distinctly (not a false success)', async () => {
    const { emit, promise } = start();
    emit({ type: 'ready' });
    emit({ type: 'stderr', text: 'Error: kaboom' });
    emit({ type: 'done', extra: { ok: false, kind: 'runtime' } });
    const r = await promise;
    expect(r.success).toBe(false);
    expect(r.status).toBe('runtime_error');
    expect(r.stderr).toContain('kaboom');
  });

  it('surfaces an unhandled rejection reported as a module failure', async () => {
    const { emit, promise } = start();
    emit({ type: 'ready' });
    emit({ type: 'done', extra: { ok: false, kind: 'runtime' } });
    const r = await promise;
    expect(r.success).toBe(false);
  });
});

describe('RUNNER_HTML — completion is gated on the input bridge (Phase 4 structure)', () => {
  it('defers the done signal until the module settled and no input is pending', () => {
    // The module-eval handlers must NOT finish outright; they record settlement and
    // route through the pending-input gate.
    expect(RUNNER_HTML).toContain('completeModule(true, null, null)');
    expect(RUNNER_HTML).not.toMatch(/import\(url\)\.then\(\s*function \(\) \{\s*finish\(/);
    expect(RUNNER_HTML).toContain('hasPendingInput()');
    expect(RUNNER_HTML).toContain('function maybeSendDone()');
    // A continuation is given a single drain tick before finishing (not a poll).
    expect(RUNNER_HTML).toMatch(/if \(done \|\| !moduleSettled \|\| hasPendingInput\(\)\) return;[\s\S]*?finish\(r\.ok/);
  });

  it('re-checks completion after every input is answered', () => {
    expect(RUNNER_HTML).toMatch(/pending\.resolve\(coerce\(pending\.kind, d\.value\)\);[\s\S]*?maybeSendDone\(\);/);
  });
});
