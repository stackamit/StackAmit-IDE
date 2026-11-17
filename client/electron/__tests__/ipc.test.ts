import { vi, describe, it, expect, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Regression tests for the Electron main-process IPC boundary.
 *
 * `registerIpc` wires every channel through a `wrap()` that (a) rejects senders
 * whose frame is not the trusted app origin and (b) converts thrown errors into
 * a structured { ok:false } envelope so nothing raw ever reaches the renderer.
 * The run handlers additionally validate the payload BEFORE touching any
 * service, so these tests assert those rejections without ever spawning a
 * process or reading a real file.
 */

// Capture the handlers preload-agnostic; a fake ipcMain records them by channel.
// `state.win` lets a test toggle whether a sender maps to a real window, which
// is what the new-window and save-as dialogs key on.
const { mockIpcMain, handlers, state } = vi.hoisted(() => {
  const handlers = new Map<string, (event: any, args: any) => Promise<any>>();
  const state = { win: { id: 1 } as any };
  const mockIpcMain = {
    handle: (channel: string, fn: (event: any, args: any) => Promise<any>) => {
      handlers.set(channel, fn);
    },
    on: () => {},
  };
  return { mockIpcMain, handlers, state };
});

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: Object.assign(
    function BrowserWindow() {},
    { fromWebContents: () => state.win, getAllWindows: () => [] },
  ),
  shell: { openExternal: vi.fn() },
  clipboard: { readText: vi.fn(() => 'clipboard-text'), writeText: vi.fn() },
  app: { getPath: () => process.env.TEMP || process.env.TMP || 'C:\\Temp' },
}));

import { registerIpc } from '../ipc';
import { IPC } from '../shared/ipc';
import { dialog, clipboard } from 'electron';

/** A minimal fake invoke event that satisfies isTrusted() and the sender use. */
function fakeEvent(url = 'file:///app/dist/index.html') {
  return {
    senderFrame: { url },
    sender: {
      // `id` is the sending webContents id; the initial-workspace handoff keys
      // on it, so tests can reassign it (e.g. `ev.sender.id = 42`).
      id: 1,
      getURL: () => url,
      isDestroyed: () => false,
      once: () => {},
      send: () => {},
    },
  };
}

beforeEach(() => {
  handlers.clear();
  state.win = { id: 1 };
  vi.clearAllMocks();
});

describe('Electron IPC — sender trust', () => {
  it('rejects a call from an untrusted sender frame on every channel', async () => {
    registerIpc(() => [], () => false); // nothing is trusted
    for (const channel of [IPC.FsReadFile, IPC.RunStart, IPC.RunStop, IPC.ShellOpenExternal, IPC.AuthLogin, IPC.AuthRestore, IPC.AuthLogout]) {
      const handler = handlers.get(channel);
      expect(handler, `no handler registered for ${channel}`).toBeTruthy();
      const res = await handler!(fakeEvent('https://evil.example/'), { path: 'x' });
      expect(res).toMatchObject({ ok: false, code: 'UNTRUSTED_SENDER' });
    }
  });

  it('registers the run channels under a trusted origin', () => {
    registerIpc(() => [], () => true);
    for (const channel of [IPC.RunDetect, IPC.RunStart, IPC.RunStdin, IPC.RunStop]) {
      expect(handlers.has(channel), `missing ${channel}`).toBe(true);
    }
  });

  it('registers only the narrow desktop authentication channels', () => {
    registerIpc(() => [], () => true, undefined, 'https://api.example.test');
    expect(handlers.has(IPC.AuthLogin)).toBe(true);
    expect(handlers.has(IPC.AuthRestore)).toBe(true);
    expect(handlers.has(IPC.AuthLogout)).toBe(true);
  });
});

describe('Electron IPC — RunStart input validation (no spawn)', () => {
  it('refuses a language with no local runner before starting anything', async () => {
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.RunStart)!(fakeEvent(), {
      language: 'c',
      sourceCode: 'int main(){}',
    });
    expect(res).toMatchObject({ ok: false, code: 'UNSUPPORTED_LANGUAGE' });
  });

  it('refuses an absent / non-string language', async () => {
    registerIpc(() => [], () => true);
    expect(await handlers.get(IPC.RunStart)!(fakeEvent(), { sourceCode: 'x' })).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_LANGUAGE',
    });
    expect(
      await handlers.get(IPC.RunStart)!(fakeEvent(), { language: 42, sourceCode: 'x' }),
    ).toMatchObject({ ok: false, code: 'UNSUPPORTED_LANGUAGE' });
  });

  it('refuses a saved file that lives outside the opened workspace roots', async () => {
    registerIpc(() => [], () => true);
    // python is a real plan, so validation reaches the path check — but no root
    // was authorized in this test, so resolveWithinRoots() rejects it and the
    // child process is never spawned.
    const res = await handlers.get(IPC.RunStart)!(fakeEvent(), {
      language: 'python',
      sourceCode: 'print(1)',
      filePath: 'C:\\Windows\\System32\\config.sys',
    });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('refuses Java with a non-string JDK folder and an outside path before any toolchain runs', async () => {
    registerIpc(() => [], () => true);
    // The configured JDK folder is only ever forwarded as a string (the finder
    // validates it); and Java is subject to the same workspace-root rule as
    // every other language, so nothing is spawned or consulted here.
    const res = await handlers.get(IPC.RunStart)!(fakeEvent(), {
      language: 'java',
      sourceCode: 'public class Main { }',
      filePath: 'C:\\Windows\\Temp\\Main.java',
      jdkPath: 42,
    });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe('Electron IPC — RunDetect honesty about Java', () => {
  it('advertises only the plans the main process really owns, and pairs Java with a validated JDK', async () => {
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.RunDetect)!(fakeEvent(), { force: true });
    expect(res.ok).toBe(true);
    // `plans` is what the renderer may claim to run offline; Java belongs there
    // only because a JDK is discovered and validated before anything spawns.
    for (const key of ['python', 'javascript', 'powershell', 'java']) {
      expect(res.plans, `plan ${key}`).toContain(key);
    }
    const java = res.runtimes.java;
    expect(java, 'java runtime entry').toBeTruthy();
    // The invariant the UI relies on: "available" and "has a JDK home" agree.
    expect(java.available ? Boolean(java.jdk) : !java.jdk, JSON.stringify(java)).toBe(true);
    if (java.jdk) {
      expect(java.path).toBe(java.jdk.javaExe);
      expect(java.available).toBe(true);
    }
  }, 20000);

  it('forwards a string jdkPath and ignores a non-string one', async () => {
    registerIpc(() => [], () => true);
    // Both calls must succeed; the second simply uses the ambient discovery.
    expect((await handlers.get(IPC.RunDetect)!(fakeEvent(), { jdkPath: 42 })).ok).toBe(true);
    expect((await handlers.get(IPC.RunDetect)!(fakeEvent(), { jdkPath: null })).ok).toBe(true);
  }, 20000);
});

describe('Electron IPC — stdin / stop argument shape', () => {
  it('requires a string sessionId + data for stdin', async () => {
    registerIpc(() => [], () => true);
    expect(await handlers.get(IPC.RunStdin)!(fakeEvent(), { sessionId: 's' })).toMatchObject({
      ok: false,
      code: 'BAD_ARGS',
    });
    expect(await handlers.get(IPC.RunStdin)!(fakeEvent(), {})).toMatchObject({ ok: false, code: 'BAD_ARGS' });
  });

  it('requires a string sessionId to stop', async () => {
    registerIpc(() => [], () => true);
    expect(await handlers.get(IPC.RunStop)!(fakeEvent(), {})).toMatchObject({ ok: false, code: 'BAD_ARGS' });
    expect(await handlers.get(IPC.RunStop)!(fakeEvent(), { sessionId: 123 })).toMatchObject({
      ok: false,
      code: 'BAD_ARGS',
    });
  });
});

describe('Electron IPC — external browser allow-list', () => {
  it('only opens URLs of servers this app is actively serving', async () => {
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.ShellOpenExternal)!(fakeEvent(), { url: 'https://example.com' });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('rejects a missing / non-string url', async () => {
    registerIpc(() => [], () => true);
    expect(await handlers.get(IPC.ShellOpenExternal)!(fakeEvent(), {})).toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
});

describe('Electron IPC — failures never surface as thrown errors', () => {
  it('wraps a handler that throws into a structured INTERNAL envelope', async () => {
    // An untrusted fs read with a bad path must return { ok:false }, not throw.
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.FsReadFile)!(fakeEvent(), { path: 12345 });
    expect(res && typeof res).toBe('object');
    expect(res.ok).toBe(false);
  });
});

describe('Electron IPC — open workspace in a new window', () => {
  it('is unavailable when the app was launched without a window host', async () => {
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.WindowNewWorkspace)!(fakeEvent(), {});
    expect(res).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
  });

  it('reports no window when the sender does not belong to one', async () => {
    state.win = null;
    registerIpc(() => [], () => true, { openWithWorkspace: vi.fn(), takePendingWorkspace: vi.fn() });
    const res = await handlers.get(IPC.WindowNewWorkspace)!(fakeEvent(), {});
    expect(res).toMatchObject({ ok: false, code: 'NO_WINDOW' });
  });

  it('creates nothing when the folder picker is canceled', async () => {
    const openWithWorkspace = vi.fn();
    registerIpc(() => [], () => true, { openWithWorkspace, takePendingWorkspace: vi.fn() });
    (dialog.showOpenDialog as any).mockResolvedValueOnce({ canceled: true, filePaths: [] });
    const res = await handlers.get(IPC.WindowNewWorkspace)!(fakeEvent(), {});
    expect(res).toMatchObject({ ok: false, code: 'CANCELED' });
    expect(openWithWorkspace, 'a canceled pick must not open a window').not.toHaveBeenCalled();
  });

  it('authorizes the picked folder and hands it to a new window host', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-ipc-ws-'));
    const openWithWorkspace = vi.fn(() => ({ existed: false }));
    registerIpc(() => [], () => true, { openWithWorkspace, takePendingWorkspace: vi.fn() });
    (dialog.showOpenDialog as any).mockResolvedValueOnce({ canceled: false, filePaths: [folder] });
    const res = await handlers.get(IPC.WindowNewWorkspace)!(fakeEvent(), {});
    expect(res.ok).toBe(true);
    expect(res.root).toBe(path.resolve(folder));
    expect(openWithWorkspace).toHaveBeenCalledWith(path.resolve(folder));
    expect(res.existed).toBe(false);
  });
});

describe('Electron IPC — consume-once initial workspace handoff', () => {
  it('returns no root when there is no window host to hand one over', async () => {
    registerIpc(() => [], () => true);
    expect(await handlers.get(IPC.WindowGetInitialWorkspace)!(fakeEvent(), {})).toEqual({ ok: true, root: null });
  });

  it('asks the host for the pending workspace keyed by the sending webContents', async () => {
    const takePendingWorkspace = vi.fn(() => 'C:\\Pending');
    registerIpc(() => [], () => true, { openWithWorkspace: vi.fn(), takePendingWorkspace });
    const ev = fakeEvent();
    ev.sender.id = 42;
    const res = await handlers.get(IPC.WindowGetInitialWorkspace)!(ev, {});
    expect(res).toEqual({ ok: true, root: 'C:\\Pending' });
    expect(takePendingWorkspace).toHaveBeenCalledWith(42);
  });
});

describe('Electron IPC — Run in Terminal command rendering', () => {
  it('refuses a language with no local runner', async () => {
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.RunTerminalCommand)!(fakeEvent(), { language: 'c' });
    expect(res).toMatchObject({ ok: false, code: 'UNSUPPORTED_LANGUAGE' });
  });

  it('refuses a saved file outside the opened workspace roots before building anything', async () => {
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.RunTerminalCommand)!(fakeEvent(), {
      language: 'python',
      filePath: 'C:\\Windows\\System32\\config.sys',
    });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('requires a real saved file — an unsaved buffer never renders a command', async () => {
    registerIpc(() => [], () => true);
    const res = await handlers.get(IPC.RunTerminalCommand)!(fakeEvent(), { language: 'python' });
    expect(res).toMatchObject({ ok: false, code: 'NOT_SAVED' });
  });
});

describe('Electron IPC — clipboard bridge', () => {
  it('rejects a non-string write instead of touching the system clipboard', async () => {
    registerIpc(() => [], () => true);
    expect(await handlers.get(IPC.ClipboardWriteText)!(fakeEvent(), {})).toMatchObject({ ok: false, code: 'BAD_ARGS' });
    expect(clipboard.writeText, 'a rejected write must not reach the clipboard').not.toHaveBeenCalled();
  });

  it('writes a string through the trusted clipboard and reads it back', async () => {
    registerIpc(() => [], () => true);
    expect(await handlers.get(IPC.ClipboardWriteText)!(fakeEvent(), { text: 'hello' })).toMatchObject({ ok: true });
    expect(clipboard.writeText).toHaveBeenCalledWith('hello');
    const res = await handlers.get(IPC.ClipboardReadText)!(fakeEvent(), {});
    expect(res).toMatchObject({ ok: true, text: 'clipboard-text' });
  });
});
