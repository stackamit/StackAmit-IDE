import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Tests for the LSP IPC boundary (ipc.ts -> services/languageServer.ts).
 *
 * The real bridge service runs here (no process is ever spawned by start()
 * alone), but tool discovery is faked so results are deterministic and no
 * real language server is located or launched. These tests pin the security
 * contract: untrusted senders, unknown languages and unauthorized roots are
 * rejected BEFORE the service does anything, and failures always arrive as
 * structured { ok:false } envelopes rather than thrown errors.
 */

const { mockIpcMain, handlers } = vi.hoisted(() => {
  const handlers = new Map<string, (event: any, args: any) => Promise<any>>();
  const mockIpcMain = {
    handle: (channel: string, fn: (event: any, args: any) => Promise<any>) => {
      handlers.set(channel, fn);
    },
    on: () => {},
  };
  return { mockIpcMain, handlers };
});

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: Object.assign(
    function BrowserWindow() {},
    { fromWebContents: () => null, getAllWindows: () => [] },
  ),
  shell: { openExternal: vi.fn() },
  app: { getPath: () => process.env.TEMP || process.env.TMP || 'C:\\Temp' },
}));

// Fake only the tool locator: pretend pyright-langserver exists somewhere.
// Everything else in runtimeProbe stays real for the rest of the import chain.
vi.mock('../services/runtimeProbe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../services/runtimeProbe')>();
  const discoverTool = async (cmd: string) =>
    cmd === 'pyright-langserver'
      ? { cmd, found: true, path: 'C:\\fake\\pyright-langserver.cmd', version: 'pyright 1.1.414', locatedButUnusable: false }
      : { cmd, found: false, path: null, version: null, locatedButUnusable: false };
  return { ...orig, discoverTool };
});

import { registerIpc } from '../ipc';
import { IPC } from '../shared/ipc';
import { addAuthorizedRoot, clearAuthorizedRoots, hasAuthorizedRoot } from '../services/workspaceFs';
import { disposeAll } from '../services/languageServer';

function fakeEvent(url = 'file:///app/dist/index.html') {
  return {
    senderFrame: { url },
    sender: {
      getURL: () => url,
      isDestroyed: () => false,
      once: () => {},
      send: () => {},
    },
  };
}

const tempDirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-ipc-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  handlers.clear();
});

afterEach(() => {
  disposeAll();
  clearAuthorizedRoots();
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('LSP IPC — sender trust', () => {
  it('rejects untrusted senders on every lsp channel before touching the service', async () => {
    registerIpc(() => [], () => false);
    for (const channel of [IPC.LspStart, IPC.LspStop, IPC.LspStatus]) {
      const handler = handlers.get(channel);
      expect(handler, `no handler registered for ${channel}`).toBeTruthy();
      const res = await handler!(fakeEvent('https://evil.example/'), { language: 'python' });
      expect(res).toMatchObject({ ok: false, code: 'UNTRUSTED_SENDER' });
    }
  });
});

describe('LSP IPC — payload validation (no spawn, no listen)', () => {
  it('reports unsupported languages honestly', async () => {
    registerIpc(() => [], () => true);
    expect(await handlers.get(IPC.LspStart)!(fakeEvent(), { language: 'ruby' })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_LANGUAGE',
    });
    // A missing/odd language must not throw through the envelope either.
    expect(await handlers.get(IPC.LspStart)!(fakeEvent(), {})).toMatchObject({ ok: false, code: 'UNSUPPORTED_LANGUAGE' });
    expect(await handlers.get(IPC.LspStart)!(fakeEvent(), { language: 42 })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_LANGUAGE',
    });
  });

  it('refuses a root that was never authorized (no workspace open)', async () => {
    registerIpc(() => [], () => true);
    expect(hasAuthorizedRoot()).toBe(false);
    const res = await handlers.get(IPC.LspStart)!(fakeEvent(), {
      language: 'python',
      root: 'C:\\Users\\someone\\Documents\\private',
    });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('refuses a relative configured tool path', async () => {
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.LspStart)!(fakeEvent(), {
      language: 'python',
      toolPath: 'relative/pyright-langserver',
    });
    expect(res).toMatchObject({ ok: false, code: 'BAD_TOOL_PATH' });
  });
});

describe('LSP IPC — happy path returns a loopback bridge url', () => {
  it('start -> status -> stop over the real service with a faked tool', async () => {
    registerIpc(() => [], () => true);
    const root = makeRoot();
    addAuthorizedRoot(root);

    const started = await handlers.get(IPC.LspStart)!(fakeEvent(), { language: 'python', root });
    expect(started.ok).toBe(true);
    expect(started.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/lsp$/);
    expect(started.tool).toBe('pyright-langserver');

    const stat = await handlers.get(IPC.LspStatus)!(fakeEvent(), { language: 'python', root });
    expect(stat).toMatchObject({ ok: true, state: 'running' });

    // Second start of the same pair is the SAME bridge (renderer may call twice).
    const again = await handlers.get(IPC.LspStart)!(fakeEvent(), { language: 'python', root });
    expect(again).toMatchObject({ ok: true, reused: true, wsUrl: started.wsUrl });

    const stopped = await handlers.get(IPC.LspStop)!(fakeEvent(), { language: 'python', root });
    expect(stopped).toMatchObject({ ok: true, stopped: true });
    const after = await handlers.get(IPC.LspStatus)!(fakeEvent(), { language: 'python', root });
    expect(after).toMatchObject({ ok: true, state: 'stopped' });
  });

  it('a language whose tool is missing yields MISSING_TOOL, not a crash', async () => {
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.LspStart)!(fakeEvent(), { language: 'cpp' });
    expect(res).toMatchObject({ ok: false, code: 'MISSING_TOOL' });
    expect(typeof res.message).toBe('string');
  });

  it('garbage payloads never throw through the wrap() envelope', async () => {
    registerIpc(() => [], () => true);
    expect(await handlers.get(IPC.LspStart)!(fakeEvent(), undefined)).toMatchObject({ ok: false });
    expect(await handlers.get(IPC.LspStatus)!(fakeEvent(), 'nonsense')).toMatchObject({ ok: false });
  });
});
