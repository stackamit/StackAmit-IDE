import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  detectDesktopRuntimes,
  isDesktopLocalRun,
  resetLocalRunHandlers,
  sendLocalRunStdin,
  startLocalRun,
  stopLocalRun,
} from '../localRun.js';

/**
 * Renderer bridge wrapper for desktop-local execution.
 *
 * The fake `window.stackamit.run` below mirrors the real preload contract
 * exactly: `start()` resolves with `{ ok, sessionId, replay }` and later events
 * arrive through the `onEvent` listener. The ordering rules that matter — no
 * lost early output, one handler per session, IPC failures never rejecting into
 * the UI — are asserted here, so the main process is free to change how it
 * streams without the editor silently breaking.
 */

let listeners = [];
let fakeRun;

beforeEach(() => {
  listeners = [];
  fakeRun = {
    detect: vi.fn(async () => ({ ok: true, runtimes: {}, plans: ['python'] })),
    start: vi.fn(async () => ({ ok: true, sessionId: 'sess-1', replay: [] })),
    stdin: vi.fn(async () => ({ ok: true })),
    stop: vi.fn(async () => ({ ok: true })),
    onEvent: vi.fn((cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    }),
  };
  window.stackamit = { isDesktop: true, run: fakeRun };
  resetLocalRunHandlers();
});

afterEach(() => {
  delete window.stackamit;
});

const emit = (payload) => listeners.forEach((l) => l(payload));

describe('desktop bridge detection', () => {
  it('reports local execution as available when the preload bridge is present', () => {
    expect(isDesktopLocalRun()).toBe(true);
  });

  it('reports it unavailable in the browser build instead of pretending', async () => {
    delete window.stackamit;
    expect(isDesktopLocalRun()).toBe(false);
    const res = await startLocalRun({ language: 'python', sourceCode: 'print(1)' }, () => {});
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NO_DESKTOP_BRIDGE');
    expect(res.message).toMatch(/only available in the desktop app/);
    expect(await detectDesktopRuntimes()).toMatchObject({ ok: false, code: 'NO_DESKTOP_BRIDGE' });
    expect(await stopLocalRun('x')).toMatchObject({ ok: false, code: 'NO_DESKTOP_BRIDGE' });
  });

  it('passes the discovered runtime paths and versions straight through', async () => {
    fakeRun.detect.mockResolvedValueOnce({
      ok: true,
      plans: ['python', 'javascript', 'powershell', 'java'],
      runtimes: {
        python: { available: true, path: 'C:\\Python314\\python.exe', version: 'Python 3.14.7' },
        // Java's entry carries the validated JDK home, which is what makes the
        // "available" claim in the UI mean something.
        java: { available: true, path: 'C:\\jdk\\bin\\java.exe', version: '21.0.2', jdk: { home: 'C:\\jdk', major: 21 } },
      },
    });
    const res = await detectDesktopRuntimes(true);
    expect(fakeRun.detect).toHaveBeenCalledWith(true, null, null, null, null);
    expect(res.runtimes.python.path).toBe('C:\\Python314\\python.exe');
    expect(res.plans).toEqual(['python', 'javascript', 'powershell', 'java']);
  });

  it('sends the configured JDK folder with the detection query', async () => {
    fakeRun.detect.mockResolvedValueOnce({ ok: true, plans: [], runtimes: {} });
    await detectDesktopRuntimes(true, 'C:\\Program Files\\Java\\jdk-21');
    expect(fakeRun.detect).toHaveBeenCalledWith(true, 'C:\\Program Files\\Java\\jdk-21', null, null, null);
  });

  it('sends the configured compiler folder too, because Java and C++ are different tools', async () => {
    fakeRun.detect.mockResolvedValueOnce({ ok: true, plans: [], runtimes: {} });
    await detectDesktopRuntimes(true, 'C:\\jdk', 'C:\\Tools\\g++.exe');
    expect(fakeRun.detect).toHaveBeenCalledWith(true, 'C:\\jdk', 'C:\\Tools\\g++.exe', null, null);
  });

  it('threads the configured TypeScript path and the opened workspace so the badge matches the run', async () => {
    fakeRun.detect.mockResolvedValueOnce({ ok: true, plans: [], runtimes: {} });
    await detectDesktopRuntimes(true, null, null, 'C:\\WS\\proj\\node_modules\\typescript', 'C:\\WS\\proj');
    // The TS discovery needs BOTH the configured compiler and the workspace root,
    // otherwise a project-local tsc would show unavailable while the Run uses it.
    expect(fakeRun.detect).toHaveBeenCalledWith(true, null, null, 'C:\\WS\\proj\\node_modules\\typescript', 'C:\\WS\\proj');
  });
});

describe('startLocalRun streaming', () => {
  it('subscribes before the reply is handled, so replayed events are delivered once', async () => {
    fakeRun.start.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-9',
      replay: [
        { type: 'info', data: '$ python -u main.py\n' },
        { type: 'stdout', data: 'early-output\n' },
      ],
    });
    const seen = [];
    const res = await startLocalRun({ language: 'python', sourceCode: 'print(1)', filePath: 'C:\\ws\\main.py' }, (e) => seen.push(e));
    expect(res).toMatchObject({ ok: true, sessionId: 'sess-9', finished: false });
    expect(seen.map((e) => e.data)).toEqual(['$ python -u main.py\n', 'early-output\n']);
    // Replayed events are tagged with the session so later ones route correctly.
    expect(seen.every((e) => e.sessionId === 'sess-9')).toBe(true);

    emit({ sessionId: 'sess-9', type: 'stdout', data: 'live-output\n' });
    expect(seen.at(-1).data).toBe('live-output\n');
  });

  it('never sends a missing filePath as undefined (the main process must run the buffer)', async () => {
    await startLocalRun({ language: 'python', sourceCode: 'print(1)' }, () => {});
    expect(fakeRun.start).toHaveBeenCalledWith({
      language: 'python',
      sourceCode: 'print(1)',
      filePath: null,
      jdkPath: null,
      compilerPath: null,
      projectPath: null,
      workspaceRoot: null,
    });
  });

  it('forwards an absolute JDK folder for a Java run, and null when there is none', async () => {
    await startLocalRun(
      { language: 'java', sourceCode: 'public class Main { }', filePath: 'C:\\ws\\Main.java', jdkPath: 'C:\\jdk-21' },
      () => {},
    );
    expect(fakeRun.start).toHaveBeenCalledWith({
      language: 'java',
      sourceCode: 'public class Main { }',
      filePath: 'C:\\ws\\Main.java',
      jdkPath: 'C:\\jdk-21',
      compilerPath: null,
      projectPath: null,
      workspaceRoot: null,
    });
    await startLocalRun({ language: 'java', sourceCode: 'public class Main { }', jdkPath: '' }, () => {});
    expect(fakeRun.start.mock.calls.at(-1)[0].jdkPath).toBeNull();
  });

  it('forwards the compiler and project context for a C++ run', async () => {
    await startLocalRun(
      {
        language: 'cpp',
        sourceCode: 'int main(){}',
        filePath: 'C:\\ws\\proj\\src\\main.cpp',
        compilerPath: 'C:\\Tools\\g++.exe',
        projectPath: 'C:\\ws\\proj\\src\\main.cpp',
        workspaceRoot: 'C:\\ws\\proj',
      },
      () => {},
    );
    const req = fakeRun.start.mock.calls.at(-1)[0];
    expect(req.compilerPath).toBe('C:\\Tools\\g++.exe');
    // The file's own location is what the main process walks upward from to
    // find the project (its CMakeLists.txt, headers and sibling sources).
    expect(req.projectPath).toBe('C:\\ws\\proj\\src\\main.cpp');
    expect(req.workspaceRoot).toBe('C:\\ws\\proj');
    expect(req.jdkPath).toBeNull();
  });

  it('stops routing a session after its exit event', async () => {
    const seen = [];
    await startLocalRun({ language: 'python', sourceCode: 'print(1)' }, (e) => seen.push(e.type));
    emit({ sessionId: 'sess-1', type: 'exit', code: 0 });
    emit({ sessionId: 'sess-1', type: 'stdout', data: 'too late\n' });
    expect(seen).toEqual(['exit']);
  });

  it('marks a run that already finished during replay so the UI does not keep a handle', async () => {
    fakeRun.start.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-2',
      replay: [{ type: 'stdout', data: 'done\n' }, { type: 'exit', code: 0 }],
    });
    const seen = [];
    const res = await startLocalRun({ language: 'python', sourceCode: 'print(1)' }, (e) => seen.push(e.type));
    expect(res.finished).toBe(true);
    expect(seen).toEqual(['stdout', 'exit']);
  });

  it('ignores events for sessions nobody is listening to', async () => {
    const seen = [];
    await startLocalRun({ language: 'python', sourceCode: 'print(1)' }, () => seen.push('mine'));
    expect(() => emit({ sessionId: 'other', type: 'stdout', data: 'x' })).not.toThrow();
    expect(seen).toEqual([]);
  });

  it('keeps streaming other events even if a sink throws', async () => {
    const boom = () => {
      throw new Error('render failed');
    };
    fakeRun.start.mockResolvedValueOnce({ ok: true, sessionId: 'sess-3', replay: [{ type: 'stdout', data: 'a\n' }] });
    await expect(startLocalRun({ language: 'python', sourceCode: 'x' }, boom)).resolves.toMatchObject({ ok: true });
    expect(() => emit({ sessionId: 'sess-3', type: 'stdout', data: 'b\n' })).not.toThrow();
  });

  it('normalizes an IPC rejection into a structured failure', async () => {
    fakeRun.start.mockRejectedValueOnce(new Error('spawn EPERM'));
    const res = await startLocalRun({ language: 'python', sourceCode: 'print(1)' }, () => {});
    expect(res).toMatchObject({ ok: false, code: 'IPC_FAILED' });
    expect(res.message).toContain('spawn EPERM');

    fakeRun.detect.mockRejectedValueOnce(new Error('ipc down'));
    expect(await detectDesktopRuntimes()).toMatchObject({ ok: false, code: 'IPC_FAILED' });
  });

  it('reports a structured failure from the main process unchanged', async () => {
    fakeRun.start.mockResolvedValueOnce({ ok: false, code: 'RUNTIME_MISSING', message: 'No local Python was found.' });
    const res = await startLocalRun({ language: 'python', sourceCode: 'print(1)' }, () => {});
    expect(res).toMatchObject({ ok: false, code: 'RUNTIME_MISSING' });
  });
});

describe('stdin and stop', () => {
  it('forwards both to the session the store is holding', async () => {
    await startLocalRun({ language: 'python', sourceCode: 'print(1)' }, () => {});
    expect(await sendLocalRunStdin('sess-1', 'hello\n')).toEqual({ ok: true });
    expect(fakeRun.stdin).toHaveBeenCalledWith('sess-1', 'hello\n');
    expect(await stopLocalRun('sess-1')).toEqual({ ok: true });
    expect(fakeRun.stop).toHaveBeenCalledWith('sess-1');
  });

  it('refuses to write to or stop a session that does not exist', async () => {
    expect(await sendLocalRunStdin('', 'x')).toMatchObject({ ok: false, code: 'NO_SESSION' });
    expect(await stopLocalRun(undefined)).toMatchObject({ ok: false, code: 'NO_SESSION' });
    expect(fakeRun.stop).not.toHaveBeenCalled();
  });

  it('normalizes a failing stop instead of throwing at the button handler', async () => {
    fakeRun.stop.mockRejectedValueOnce(new Error('epipe'));
    expect(await stopLocalRun('sess-1')).toMatchObject({ ok: false, code: 'IPC_FAILED' });
  });
});
