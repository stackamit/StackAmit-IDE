import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { copyText, pasteText } from '../clipboard.js';

/**
 * Clipboard service contract (TASK 5).
 *
 * The renderer must never reach for Node APIs or throw: it prefers the narrow
 * `window.stackamit.clipboard` bridge in the desktop app and only falls back to
 * the browser's async clipboard when there is no bridge. Every failure — a
 * rejected IPC call, a missing/insecure `navigator.clipboard`, a non-ok read —
 * collapses to an honest { ok:false } envelope rather than an exception, so the
 * terminal and Output panel can offer copy/paste without nodeIntegration.
 */

let fakeClipboard;

beforeEach(() => {
  fakeClipboard = {
    writeText: vi.fn(async (t) => ({ ok: true, length: t.length })),
    readText: vi.fn(async () => ({ ok: true, text: 'from-bridge' })),
  };
  window.stackamit = { isDesktop: true, clipboard: fakeClipboard };
});

afterEach(() => {
  delete window.stackamit;
  // Remove any navigator.clipboard stub installed by a single test.
  try {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  } catch {
    /* jsdom may not allow redefining; harmless */
  }
});

function stubNavigatorClipboard(mock) {
  Object.defineProperty(navigator, 'clipboard', { value: mock, configurable: true });
}

describe('clipboard.copyText', () => {
  it('routes a copy through the desktop bridge and returns its envelope', async () => {
    const res = await copyText('hello');
    expect(fakeClipboard.writeText).toHaveBeenCalledWith('hello');
    expect(res).toMatchObject({ ok: true });
  });

  it('never throws on a rejected bridge call — returns IPC_FAILED', async () => {
    fakeClipboard.writeText.mockRejectedValueOnce(new Error('boom'));
    const res = await copyText('x');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('IPC_FAILED');
  });

  it('falls back to the browser clipboard when there is no bridge', async () => {
    delete window.stackamit;
    const writeText = vi.fn(async () => undefined);
    stubNavigatorClipboard({ writeText });
    const res = await copyText('web');
    expect(writeText).toHaveBeenCalledWith('web');
    expect(res).toEqual({ ok: true });
  });

  it('reports CLIPBOARD_UNAVAILABLE when neither bridge nor browser clipboard exists', async () => {
    delete window.stackamit;
    stubNavigatorClipboard(undefined);
    const res = await copyText('x');
    expect(res).toMatchObject({ ok: false, code: 'CLIPBOARD_UNAVAILABLE' });
  });
});

describe('clipboard.pasteText', () => {
  it('reads through the bridge and returns the text', async () => {
    const res = await pasteText();
    expect(res).toEqual({ ok: true, text: 'from-bridge' });
  });

  it('surfaces a non-ok bridge read as an honest failure', async () => {
    fakeClipboard.readText.mockResolvedValueOnce({ ok: false, code: 'DENIED', message: 'nope' });
    const res = await pasteText();
    expect(res).toMatchObject({ ok: false, code: 'DENIED', message: 'nope' });
  });

  it('never throws on a rejected bridge read — returns IPC_FAILED', async () => {
    fakeClipboard.readText.mockRejectedValueOnce(new Error('boom'));
    const res = await pasteText();
    expect(res.ok).toBe(false);
    expect(res.code).toBe('IPC_FAILED');
  });

  it('falls back to the browser clipboard read when there is no bridge', async () => {
    delete window.stackamit;
    stubNavigatorClipboard({ readText: async () => 'web-text' });
    const res = await pasteText();
    expect(res).toEqual({ ok: true, text: 'web-text' });
  });
});
