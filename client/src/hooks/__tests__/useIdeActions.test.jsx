import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { NotificationProvider } from '../../components/ui/Notification.jsx';
import { useIdeActions } from '../useIdeActions.js';
import { useIdeStore } from '../../store/ideStore.js';
import { createFakeMonaco } from '../../test/fakeMonaco.js';
import { findModelByPath } from '../../utils/monacoModels.js';

const P = 'C:\\WS\\files\\main.py';

const { mockWorkspace, mockApi, mockLocal, mockBrowser } = vi.hoisted(() => ({
  mockWorkspace: {
    mode: 'web',
    supportsTerminal: false,
    openWorkspace: vi.fn(),
    readDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createFile: vi.fn(),
    createDirectory: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    saveAs: vi.fn(),
    importFromDirectory: vi.fn(),
    terminal: null,
  },
  mockApi: { run: vi.fn(), lint: vi.fn(), remoteRunAvailability: vi.fn() },
  // In-page browser JavaScript runner (utils/browserRun.js). Only the iframe
  // execution is faked — jsdom cannot host a real blob: module graph. The
  // routing decision (isBrowserRunnable) and the Node-API/bare-import detectors
  // are kept real so the test exercises the genuine logic.
  mockBrowser: { runBrowserJavaScript: vi.fn() },
  // Renderer-side desktop execution bridge (services/localRun.js).
  mockLocal: {
    isDesktopLocalRun: vi.fn(),
    detectDesktopRuntimes: vi.fn(),
    startLocalRun: vi.fn(),
    stopLocalRun: vi.fn(),
    sendLocalRunStdin: vi.fn(),
    buildTerminalCommand: vi.fn(),
    // Java dependency bridge (only exercised by the Java-deps feature tests).
    isDesktopJavaDeps: vi.fn(),
    onJavaDepsProgress: vi.fn(),
    resolveJavaDeps: vi.fn(),
    clearJavaDepsCache: vi.fn(),
    javaDepsStatus: vi.fn(),
  },
}));

vi.mock('../../services/workspace.js', () => ({
  workspace: mockWorkspace,
  isDesktopMode: () => false,
}));
vi.mock('../../services/api.js', () => ({
  api: mockApi,
  remoteRunAvailability: (...args) => mockApi.remoteRunAvailability(...args),
}));
vi.mock('../../services/localRun.js', () => mockLocal);
vi.mock('../../utils/browserRun.js', async (importActual) => {
  const actual = await importActual();
  return { ...actual, runBrowserJavaScript: (...a) => mockBrowser.runBrowserJavaScript(...a) };
});
// The real themes module pulls in monaco-editor (workers + DOM), which cannot
// load under jsdom. The store only needs the theme lists for validation.
vi.mock('../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
}));

function setup() {
  const monaco = createFakeMonaco();
  const { result } = renderHook(() => useIdeActions(), {
    wrapper: ({ children }) => <NotificationProvider>{children}</NotificationProvider>,
  });
  act(() => result.current.setEditorHandles({}, monaco));
  return { actions: result.current, monaco };
}

/** Open a file through the action and simulate the wrapper binding a model. */
async function openFile(actions, monaco, path = P, content = 'v1') {
  mockWorkspace.readFile.mockResolvedValue({ ok: true, content, path });
  await act(async () => {
    await actions.openFileByPath(path);
  });
  return monaco.getOrCreateModel(path, content, 'python');
}

beforeEach(() => {
  vi.clearAllMocks();
  // Web mode by default; the desktop blocks below switch it explicitly.
  mockWorkspace.mode = 'web';
  mockApi.remoteRunAvailability.mockReturnValue({ ok: true, target: 'http://api.test' });
  mockLocal.isDesktopLocalRun.mockReturnValue(false);
  // No Java-deps bridge by default; the run path no-ops on dependency-free runs.
  mockLocal.isDesktopJavaDeps.mockReturnValue(false);
  mockLocal.onJavaDepsProgress.mockReturnValue(() => {});
  mockLocal.resolveJavaDeps.mockResolvedValue({ ok: true, classpath: [], resolved: [], missing: [], conflicts: [], errors: [] });
  mockLocal.clearJavaDepsCache.mockResolvedValue({ ok: true, removed: [] });
  mockLocal.javaDepsStatus.mockResolvedValue({ ok: true, exists: false });
  mockLocal.detectDesktopRuntimes.mockResolvedValue({ ok: true, runtimes: {}, plans: [] });
  mockLocal.stopLocalRun.mockResolvedValue({ ok: true });
  mockLocal.sendLocalRunStdin.mockResolvedValue({ ok: true });
  // Terminal-mode default: a two-step command that mirrors the managed plan.
  mockLocal.buildTerminalCommand.mockResolvedValue({
    ok: true,
    commands: ['g++ main.cpp -o main.exe', 'main.exe'],
    cwd: 'C:\\WS',
    extraPathDirs: [],
  });
  useIdeStore.setState({
    docs: {},
    order: [],
    activePath: null,
    root: null,
    selectedPath: null,
    output: [],
    runState: 'idle',
    runHandle: null,
    localRuntimes: null,
    compilerPaths: {},
    prompt: null,
    runStdin: '',
    runPrompt: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useIdeActions — open/close lifecycle', () => {
  it('opening a file reads it from disk into a store document', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'hello');
    expect(mockWorkspace.readFile).toHaveBeenCalledWith(P);
    const doc = useIdeStore.getState().docs[P];
    expect(doc.content).toBe('hello');
    expect(doc.savedContent).toBe('hello');
    expect(useIdeStore.getState().activePath).toBe(P);
  });

  it('closeTab disposes the model keyed by the parsed Uri, not the raw path', async () => {
    const { actions, monaco } = setup();
    const model = await openFile(actions, monaco);
    expect(findModelByPath(monaco, P)).toBe(model);
    // Sanity: the old buggy lookup shape (raw string key) finds nothing.
    expect(monaco.models.get(P)).toBeUndefined();

    await act(async () => {
      actions.closeTab(P);
    });
    expect(model.disposed).toBe(true);
    expect(findModelByPath(monaco, P)).toBeNull();
    expect(useIdeStore.getState().docs[P]).toBeUndefined();
  });

  it('a dirty tab is only closed (and its model disposed) after confirming', async () => {
    const { actions, monaco } = setup();
    const model = await openFile(actions, monaco);
    act(() => useIdeStore.getState().updateContent(P, 'edited'));

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      actions.closeTab(P);
    });
    expect(model.disposed).toBe(false);
    expect(useIdeStore.getState().docs[P]).toBeDefined();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      actions.closeTab(P);
    });
    expect(model.disposed).toBe(true);
    expect(useIdeStore.getState().docs[P]).toBeUndefined();
  });

  it('reopening a closed file loads fresh disk content into a new model', async () => {
    const { actions, monaco } = setup();
    const first = await openFile(actions, monaco, P, 'v1');
    await act(async () => {
      actions.closeTab(P);
    });
    expect(first.disposed).toBe(true);

    const reopened = await openFile(actions, monaco, P, 'v2-from-disk');
    expect(useIdeStore.getState().docs[P].content).toBe('v2-from-disk');
    expect(reopened.disposed).toBe(false);
    expect(reopened.value).toBe('v2-from-disk');
    // One read for the first open, one for the reopen.
    expect(mockWorkspace.readFile).toHaveBeenCalledTimes(2);
  });

  it('closing an inactive tab leaves other open documents’ models intact', async () => {
    const { actions, monaco } = setup();
    const A = 'C:\\WS\\a.txt';
    const B = 'C:\\WS\\b.txt';
    await openFile(actions, monaco, A, 'a');
    await openFile(actions, monaco, B, 'b');
    const modelB = findModelByPath(monaco, B);

    await act(async () => {
      actions.closeTab(A);
    });
    expect(findModelByPath(monaco, A)).toBeNull();
    expect(modelB.disposed).toBe(false);
    expect(useIdeStore.getState().activePath).toBe(B);
  });

  it('never disposes a model another document still maps to (same URI)', async () => {
    const { actions, monaco } = setup();
    const lower = 'c:\\WS\\files\\main.py'; // different string, same canonical URI as P
    act(() => {
      useIdeStore.getState().openDocument({ path: P, content: 'x' });
      useIdeStore.getState().openDocument({ path: lower, content: 'x' });
    });
    const shared = monaco.getOrCreateModel(P, 'x');

    await act(async () => {
      actions.closeTab(P);
    });
    expect(shared.disposed).toBe(false); // still needed by the other document

    await act(async () => {
      actions.closeTab(lower);
    });
    expect(shared.disposed).toBe(true); // nothing references it anymore
  });
});

describe('useIdeActions — runActive (remote execution)', () => {
  const outputTexts = () => useIdeStore.getState().output.map((l) => l.text);

  it('sends code + language to the provider and prints real output with the exit code', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(1)');
    mockApi.run.mockResolvedValue({
      success: true,
      status: 'completed',
      stdout: '1\n',
      stderr: '',
      exitCode: 0,
      executionTimeMs: 12,
    });

    await act(async () => {
      await actions.runActive();
    });
    // The request now also carries an AbortSignal so Stop can cancel it.
    const sent = mockApi.run.mock.calls[0][0];
    expect({ language: sent.language, sourceCode: sent.sourceCode, stdin: sent.stdin }).toEqual({
      language: 'python',
      sourceCode: 'print(1)',
      stdin: '',
    });
    expect(sent.signal).toBeTruthy();
    expect(outputTexts()).toContain('1');
    expect(outputTexts().some((t) => t.startsWith('✓ Finished') && t.includes('exit 0'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
  });

  it('is running while executing and ignores concurrent Run presses', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(1)');
    let resolveRun;
    mockApi.run.mockImplementation(
      () =>
        new Promise((r) => {
          resolveRun = r;
        }),
    );

    act(() => {
      actions.runActive();
    });
    expect(useIdeStore.getState().runState).toBe('running');

    act(() => {
      actions.runActive(); // second press while running — must be a no-op
    });
    expect(mockApi.run).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRun({ success: true, status: 'completed', stdout: '', stderr: '', exitCode: 0 });
    });
    expect(useIdeStore.getState().runState).toBe('idle');
  });

  it('reports runtime errors with the real exit code', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(x)');
    mockApi.run.mockResolvedValue({
      success: false,
      status: 'runtime_error',
      stdout: '',
      stderr: 'NameError: name \'x\' is not defined\n',
      exitCode: 1,
    });

    await act(async () => {
      await actions.runActive();
    });
    expect(outputTexts()).toContain('✗ Runtime error · exit 1');
    expect(useIdeStore.getState().runState).toBe('idle');
  });

  it('refuses to run a language with no provider runner, without calling the API', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\notes.txt', 'hello');

    await act(async () => {
      await actions.runActive();
    });
    expect(mockApi.run).not.toHaveBeenCalled();
    expect(outputTexts().some((t) => t.includes('No runner configured'))).toBe(true);
  });

  it('does not send a remote request when no API server is reachable from this build', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\main.c', 'int main(){}');
    mockApi.remoteRunAvailability.mockReturnValue({
      ok: false,
      code: 'NO_API_SERVER',
      message: 'Online execution needs an API server, and none is configured for this build.',
    });

    await act(async () => {
      await actions.runActive();
    });
    expect(mockApi.run).not.toHaveBeenCalled();
    expect(outputTexts().some((t) => t.includes('needs an API server'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
  });

  it('Stop aborts the in-flight remote request', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\main.c', 'int main(){}');
    let capturedSignal;
    mockApi.run.mockImplementation(
      (req) =>
        new Promise((_resolve, reject) => {
          capturedSignal = req.signal;
          req.signal.addEventListener('abort', () => reject({ code: 'ERR_CANCELED', message: 'The run was cancelled.' }));
        }),
    );

    act(() => {
      actions.runActive();
    });
    expect(useIdeStore.getState().runState).toBe('running');
    await act(async () => {
      await actions.stopActiveRun();
    });
    expect(capturedSignal.aborted).toBe(true);
    expect(outputTexts().some((t) => t.includes('The run was cancelled.'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
  });

  it('explains an unreachable API server instead of failing silently', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\main.c', 'int main(){}');
    mockApi.run.mockRejectedValue({ status: 0, code: 'NETWORK', message: 'Network error — check your connection and the API server.' });

    await act(async () => {
      await actions.runActive();
    });
    expect(outputTexts().some((t) => t.includes('did not answer'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
  });
});

describe('useIdeActions — runActive (web in-browser JavaScript)', () => {
  const outputTexts = () => useIdeStore.getState().output.map((l) => l.text);

  it('routes a plain JS file to the in-page engine, not the API server', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\app.js', 'console.log(2 + 2)');
    mockBrowser.runBrowserJavaScript.mockResolvedValue({
      success: true,
      status: 'completed',
      stdout: '4\n',
      stderr: '',
      exitCode: 0,
      executionTimeMs: 3,
      provider: 'browser',
    });

    await act(async () => {
      await actions.runActive();
    });
    expect(mockApi.run).not.toHaveBeenCalled();
    expect(mockBrowser.runBrowserJavaScript).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'console.log(2 + 2)' }),
    );
    expect(outputTexts()).toContain('4');
    expect(outputTexts().some((t) => t.startsWith('✓ Finished in the browser'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
  });

  it('refuses to run JS that uses Node APIs and offers the server without taking it', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\srv.js', "const fs = require('fs'); fs.readFileSync('x')");
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await act(async () => {
      await actions.runActive();
    });
    // The browser engine is never handed Node code.
    expect(mockBrowser.runBrowserJavaScript).not.toHaveBeenCalled();
    expect(mockApi.run).not.toHaveBeenCalled();
    expect(outputTexts().some((t) => t.includes('Not runnable in the browser') && t.includes('no Node.js'))).toBe(true);
    expect(outputTexts()).toContain('Stayed in the browser: nothing ran.');
  });

  it('routes JS with a bare npm import to the same honest refusal', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\mod.js', "import _ from 'lodash'; console.log(_.VERSION)");
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    await act(async () => {
      await actions.runActive();
    });
    expect(mockBrowser.runBrowserJavaScript).not.toHaveBeenCalled();
    expect(outputTexts().some((t) => t.includes('Not runnable in the browser') && t.includes('lodash'))).toBe(true);
  });

  it('reports a browser runtime error distinctly and returns to idle', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\boom.js', 'throw new Error("kaboom")');
    mockBrowser.runBrowserJavaScript.mockResolvedValue({
      success: false,
      status: 'runtime_error',
      stdout: '',
      stderr: 'Error: kaboom',
      exitCode: 1,
      provider: 'browser',
    });

    await act(async () => {
      await actions.runActive();
    });
    expect(outputTexts()).toContain('Error: kaboom');
    expect(outputTexts().some((t) => t.startsWith('✗ Runtime error'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
  });
});

describe('useIdeActions — Web Mode interactive stdin', () => {
  const outputTexts = () => useIdeStore.getState().output.map((l) => l.text);

  it('sends staged pre-run stdin to a remote batch run, ending in a newline', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'name = input("Enter your name: ")');
    act(() => actions.setRunStdin('Alice'));
    mockApi.run.mockResolvedValue({
      success: true, status: 'completed', stdout: 'Enter your name: Hello Alice', stderr: '', exitCode: 0, executionTimeMs: 5,
    });
    await act(async () => { await actions.runActive(); });
    // A trailing newline is added so the last read gets a clean EOF.
    expect(mockApi.run.mock.calls[0][0].stdin).toBe('Alice\n');
    expect(outputTexts()).toContain('Enter your name: Hello Alice');
  });

  it('sends an empty stdin unchanged when nothing is staged', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(1)');
    mockApi.run.mockResolvedValue({ success: true, status: 'completed', stdout: '1', stderr: '', exitCode: 0 });
    await act(async () => { await actions.runActive(); });
    expect(mockApi.run.mock.calls[0][0].stdin).toBe('');
  });

  it('surfaces a browser prompt in the panel and resolves it on submit', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\hello.js', 'const name = await prompt("Enter your name:");');
    mockBrowser.runBrowserJavaScript.mockImplementation(async (opts) => {
      const val = await opts.requestInput({ token: opts.token, promptId: 'p1', kind: 'prompt', message: 'Enter your name:' });
      return { success: true, status: 'completed', stdout: `Hello, ${val}!`, stderr: '', exitCode: 0, provider: 'browser', executionTimeMs: 1 };
    });
    let done;
    act(() => { done = actions.runActive(); });
    await act(async () => {}); // flush: the runner requests input and stores the prompt
    expect(useIdeStore.getState().runPrompt).toMatchObject({ promptId: 'p1', kind: 'prompt' });
    expect(outputTexts()).toContain('Enter your name:');
    await act(async () => { actions.answerPendingPrompt('Alice'); });
    await done;
    expect(outputTexts()).toContain('Hello, Alice!');
    expect(outputTexts()).toContain('> Alice');
    expect(useIdeStore.getState().runPrompt).toBeNull();
  });

  it('resolves the prompt with null on cancel so the program never hangs', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\eof.js', 'const x = await prompt("n:");');
    mockBrowser.runBrowserJavaScript.mockImplementation(async (opts) => {
      const val = await opts.requestInput({ token: opts.token, promptId: 'p1', kind: 'prompt', message: 'n:' });
      return { success: true, status: 'completed', stdout: val === null ? 'got EOF' : `got ${val}`, stderr: '', exitCode: 0, provider: 'browser', executionTimeMs: 1 };
    });
    let done;
    act(() => { done = actions.runActive(); });
    await act(async () => {});
    await act(async () => { actions.cancelPendingPrompt(); });
    await done;
    expect(outputTexts()).toContain('got EOF');
    expect(useIdeStore.getState().runPrompt).toBeNull();
  });

  it('a canceled run clears any prompt left over from the previous one', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\x.js', 'await prompt("stale:");');
    // Mirror the real runner: an abort settles the run, whose finally returns to
    // idle — which is what strands no prompt.
    mockBrowser.runBrowserJavaScript.mockImplementation(
      (opts) =>
        new Promise((resolve) => {
          opts.requestInput({ token: opts.token, promptId: 'p1', kind: 'prompt', message: 'stale:' });
          opts.signal.addEventListener('abort', () =>
            resolve({ success: false, status: 'canceled', stdout: '', stderr: '', exitCode: null, canceled: true, provider: 'browser' }),
          );
        }),
    );
    let done;
    act(() => { done = actions.runActive(); });
    await act(async () => {});
    expect(useIdeStore.getState().runPrompt).toBeTruthy();
    await act(async () => { await actions.stopActiveRun(); });
    await done;
    expect(useIdeStore.getState().runPrompt).toBeNull();
  });
});

describe('ideStore — run input correlation contract', () => {
  it('rejects an answer from the wrong run token, leaving the prompt pending', async () => {
    const s = useIdeStore.getState();
    const p = s.requestRunPrompt({ token: 'good', promptId: 'p1', kind: 'prompt', message: 'x:' });
    expect(useIdeStore.getState().runPrompt).toMatchObject({ token: 'good', promptId: 'p1' });
    // A stale/misrouted answer must not resolve this run's prompt.
    expect(useIdeStore.getState().answerRunPrompt('nope', { token: 'evil', promptId: 'p1' })).toBe(false);
    expect(useIdeStore.getState().runPrompt).toBeTruthy();
    // The correct token + promptId does resolve it.
    expect(useIdeStore.getState().answerRunPrompt('yes', { token: 'good', promptId: 'p1' })).toBe(true);
    await expect(p).resolves.toBe('yes');
    expect(useIdeStore.getState().runPrompt).toBeNull();
  });

  it('rejects an answer aimed at a different promptId of the same run', () => {
    useIdeStore.getState().requestRunPrompt({ token: 'r', promptId: 'p2', kind: 'prompt' });
    expect(useIdeStore.getState().answerRunPrompt('x', { token: 'r', promptId: 'p1' })).toBe(false);
    expect(useIdeStore.getState().runPrompt).toMatchObject({ promptId: 'p2' });
  });

  it('resolves a superseded prompt as EOF when a newer one arrives', async () => {
    const first = useIdeStore.getState().requestRunPrompt({ token: 'r1', promptId: 'p1', kind: 'prompt' });
    const second = useIdeStore.getState().requestRunPrompt({ token: 'r2', promptId: 'p1', kind: 'prompt' });
    await expect(first).resolves.toBeNull(); // stale one unwinds with EOF
    expect(useIdeStore.getState().runPrompt).toMatchObject({ token: 'r2' });
    useIdeStore.getState().answerRunPrompt('b', { token: 'r2', promptId: 'p1' });
    await expect(second).resolves.toBe('b');
  });

  it('leaving the running state resolves a pending prompt as EOF', async () => {
    const p = useIdeStore.getState().requestRunPrompt({ token: 'r', promptId: 'p', kind: 'prompt' });
    useIdeStore.getState().setRunState('idle');
    await expect(p).resolves.toBeNull();
    expect(useIdeStore.getState().runPrompt).toBeNull();
  });

  it('stages pre-run stdin as a string', () => {
    useIdeStore.getState().setRunStdin('Alice\n42');
    expect(useIdeStore.getState().runStdin).toBe('Alice\n42');
    useIdeStore.getState().setRunStdin(null);
    expect(useIdeStore.getState().runStdin).toBe('');
  });
});

describe('useIdeActions — runActive (desktop local execution)', () => {
  const outputTexts = () => useIdeStore.getState().output.map((l) => l.text);

  beforeEach(() => {
    mockWorkspace.mode = 'desktop';
    mockLocal.isDesktopLocalRun.mockReturnValue(true);
  });

  it('runs a locally supported language through the main process, never the network', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(2)');
    let sink;
    mockLocal.startLocalRun.mockImplementation(async (_req, onEvent) => {
      sink = onEvent;
      return { ok: true, sessionId: 'sess-1', finished: false };
    });

    await act(async () => {
      await actions.runActive();
    });
    expect(mockLocal.startLocalRun).toHaveBeenCalledWith(
      {
        language: 'python',
        sourceCode: 'print(2)',
        filePath: P,
        jdkPath: null,
        compilerPath: null,
        projectPath: P,
        workspaceRoot: null,
      },
      expect.any(Function),
    );
    expect(mockApi.run).not.toHaveBeenCalled();
    expect(useIdeStore.getState().runHandle).toEqual({ mode: 'local', sessionId: 'sess-1', language: 'python', name: 'main.py' });

    act(() => sink({ type: 'stdout', sessionId: 'sess-1', data: '2\n' }));
    act(() => sink({ type: 'exit', sessionId: 'sess-1', code: 0 }));
    expect(outputTexts()).toContain('2');
    expect(outputTexts().some((t) => t.startsWith('✓ Finished') && t.includes('exit 0'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
    expect(useIdeStore.getState().runHandle).toBeNull();
  });

  it('passes the active file real path (a.py), not a hardcoded entry point', async () => {
    const { actions, monaco } = setup();
    const aPy = 'C:\\WS\\IDE-test\\a.py';
    await openFile(actions, monaco, aPy, 'a = 5\nprint(a)');
    mockLocal.startLocalRun.mockResolvedValue({ ok: true, sessionId: 'sess-a', finished: false });

    await act(async () => {
      await actions.runActive();
    });
    // A saved, unmodified file is run in place at its own absolute path.
    expect(mockLocal.startLocalRun).toHaveBeenCalledWith(
      {
        language: 'python',
        sourceCode: 'a = 5\nprint(a)',
        filePath: aPy,
        jdkPath: null,
        compilerPath: null,
        projectPath: aPy,
        workspaceRoot: null,
      },
      expect.any(Function),
    );
  });

  it('sends the configured JDK folder with a Java run, and the editor text when it is unsaved', async () => {
    const { actions, monaco } = setup();
    const javaFile = 'C:\\WS\\IDE-test\\Main.java';
    await openFile(actions, monaco, javaFile, 'public class Main { }');
    // The same setting IntelliSense uses decides which JDK the run may use.
    act(() => useIdeStore.getState().setLspJdkPath('java', 'C:\\Program Files\\Java\\jdk-21'));
    let sink;
    mockLocal.startLocalRun.mockImplementation(async (_req, onEvent) => {
      sink = onEvent;
      return { ok: true, sessionId: 'sess-j', finished: false };
    });

    await act(async () => {
      await actions.runActive();
    });
    expect(mockLocal.startLocalRun).toHaveBeenCalledWith(
      {
        language: 'java',
        sourceCode: 'public class Main { }',
        filePath: javaFile,
        jdkPath: 'C:\\Program Files\\Java\\jdk-21',
        compilerPath: null,
        projectPath: javaFile,
        workspaceRoot: null,
      },
      expect.any(Function),
    );

    // End that run, then edit the buffer without saving.
    act(() => sink({ type: 'exit', sessionId: 'sess-j', code: 0 }));
    act(() => useIdeStore.getState().updateContent(javaFile, 'public class Main { /* fresh */ }'));
    await act(async () => {
      await actions.runActive();
    });
    const req = mockLocal.startLocalRun.mock.calls[1][0];
    // Unsaved Java edits still execute: the stale file on disk is not run.
    expect(req.filePath).toBeNull();
    expect(req.sourceCode).toContain('/* fresh */');
    expect(req.jdkPath).toBe('C:\\Program Files\\Java\\jdk-21');
  });

  it('runs a multi-file C++ project from its file, with the configured compiler', async () => {
    const { actions, monaco } = setup();
    const cppFile = 'C:\\WS\\CppProjectTest\\src\\main.cpp';
    await openFile(actions, monaco, cppFile, '#include "TextUtils.h"\nint main(){}');
    // A compiler path is its own setting: clangd (IntelliSense) never decides
    // what the Run button can execute.
    act(() => useIdeStore.getState().setCompilerPath('cpp', 'C:\\Tools\\g++.exe'));
    act(() => useIdeStore.getState().setRoot('C:\\WS\\CppProjectTest'));
    mockLocal.startLocalRun.mockResolvedValue({ ok: true, sessionId: 'sess-c', finished: false });

    await act(async () => {
      await actions.runActive();
    });
    expect(mockLocal.startLocalRun).toHaveBeenCalledWith(
      {
        language: 'cpp',
        sourceCode: '#include "TextUtils.h"\nint main(){}',
        filePath: cppFile,
        jdkPath: null,
        compilerPath: 'C:\\Tools\\g++.exe',
        projectPath: cppFile,
        workspaceRoot: 'C:\\WS\\CppProjectTest',
      },
      expect.any(Function),
    );
    // Local-first: a C++ run with a located compiler never reaches the network.
    expect(mockApi.run).not.toHaveBeenCalled();
  });

  it('routes a saved .ts file to the local TypeScript runner with no API server configured', async () => {
    // Reproduces the reported packaged failure: the exact project path (with a
    // space in a parent folder and a nested project dir) must be detected as
    // TypeScript and executed by the desktop local runner even when the online
    // API is unavailable (VITE_API_URL unset for this build).
    const tsFile = 'C:\\Users\\amitk\\Desktop\\typescript test\\ts-calculator\\calculator.ts';
    mockApi.remoteRunAvailability.mockReturnValue({
      ok: false,
      code: 'NO_API_SERVER',
      message: 'Online execution needs an API server, and none is configured for this build.',
    });
    const { actions, monaco } = setup();
    await openFile(actions, monaco, tsFile, 'import { evaluate } from "mathjs";\nconsole.log(evaluate("2 + 3"));');
    // The status bar reads the document's language: it must be TypeScript, never
    // Plain Text, for a saved .ts opened through the Explorer.
    expect(useIdeStore.getState().docs[tsFile].language).toBe('typescript');
    mockLocal.startLocalRun.mockResolvedValue({ ok: true, sessionId: 'sess-ts', finished: false });

    await act(async () => {
      await actions.runActive();
    });
    expect(mockLocal.startLocalRun).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'typescript', filePath: tsFile, projectPath: tsFile }),
      expect.any(Function),
    );
    // The online runner is never reached, so the missing-server message is absent.
    expect(mockApi.run).not.toHaveBeenCalled();
    expect(outputTexts().join('\n')).not.toMatch(/needs an API server/);
  });

  it('still names the project around an unsaved .cpp buffer so siblings compile', async () => {
    const { actions, monaco } = setup();
    const cppFile = 'C:\\WS\\CppProjectTest\\src\\main.cpp';
    await openFile(actions, monaco, cppFile, 'int main(){}');
    act(() => useIdeStore.getState().updateContent(cppFile, 'int main(){ return 7; }'));
    mockLocal.startLocalRun.mockResolvedValue({ ok: true, sessionId: 'sess-c2', finished: false });

    await act(async () => {
      await actions.runActive();
    });
    const req = mockLocal.startLocalRun.mock.calls[0][0];
    // The dirty buffer is executed as editor text (temp copy)...
    expect(req.filePath).toBeNull();
    expect(req.sourceCode).toContain('return 7');
    // ...while the project beside the real file is still handed over, so the
    // planner can compile and link its sibling translation units.
    expect(req.projectPath).toBe(cppFile);
  });

  it('runs the current editor text (not stale disk) when the buffer has unsaved edits', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print("old on disk")');
    // Edit the buffer without saving: content !== savedContent.
    act(() => useIdeStore.getState().updateContent(P, 'print("fresh in editor")'));
    mockLocal.startLocalRun.mockResolvedValue({ ok: true, sessionId: 'sess-d', finished: false });

    await act(async () => {
      await actions.runActive();
    });
    // filePath is omitted so the main process runs a temp copy of the buffer.
    const req = mockLocal.startLocalRun.mock.calls[0][0];
    expect(req.filePath).toBeNull();
    expect(req.sourceCode).toBe('print("fresh in editor")');
  });

  it('reassembles stdout that arrives split across chunks', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print("hello")');
    let sink;
    mockLocal.startLocalRun.mockImplementation(async (_req, onEvent) => {
      sink = onEvent;
      return { ok: true, sessionId: 'sess-2', finished: false };
    });
    await act(async () => {
      await actions.runActive();
    });
    act(() => sink({ type: 'stdout', sessionId: 'sess-2', data: 'he' }));
    expect(outputTexts()).toContain('he'); // partial output is visible immediately
    act(() => sink({ type: 'stdout', sessionId: 'sess-2', data: 'llo\nwor' }));
    expect(outputTexts()).toContain('hello');
    act(() => sink({ type: 'exit', sessionId: 'sess-2', code: 0 }));
    expect(outputTexts().at(-2)).toBe('wor'); // remainder flushed at exit
  });

  it('shows stderr, a non-zero exit and a timeout as distinct honest outcomes', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'import sys; sys.exit(3)');
    let sink;
    mockLocal.startLocalRun.mockImplementation(async (_req, onEvent) => {
      sink = onEvent;
      return { ok: true, sessionId: 'sess-3', finished: false };
    });
    await act(async () => {
      await actions.runActive();
    });
    act(() => sink({ type: 'stderr', sessionId: 'sess-3', data: 'boom\n' }));
    act(() => sink({ type: 'exit', sessionId: 'sess-3', code: 3 }));
    expect(outputTexts()).toContain('boom');
    expect(outputTexts().some((t) => t.includes('exit 3'))).toBe(true);

    act(() => sink({ type: 'exit', sessionId: 'sess-3', code: null, timedOut: true }));
    expect(outputTexts().some((t) => t.includes('Timed out'))).toBe(true);
  });

  it('reports a missing toolchain and never switches to the network on its own', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(1)');
    mockLocal.startLocalRun.mockResolvedValue({
      ok: false,
      code: 'RUNTIME_MISSING',
      message: 'No local Python was found. Install Python from python.org.',
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await act(async () => {
      await actions.runActive();
    });
    expect(mockApi.run).not.toHaveBeenCalled();
    expect(outputTexts().some((t) => t.includes('No local Python was found'))).toBe(true);
    expect(outputTexts().some((t) => t.includes('Staying offline'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
    // The other provider is offered by name, and the answer decides.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(String(confirm.mock.calls[0][0])).toMatch(/online runner/);
  });

  it('runs a C++ file through the provider once the user accepts the online fallback', async () => {
    const { actions, monaco } = setup();
    const cppFile = 'C:\\WS\\CppProjectTest\\src\\main.cpp';
    await openFile(actions, monaco, cppFile, 'int main(){}');
    mockLocal.startLocalRun.mockResolvedValue({
      ok: false,
      code: 'CPP_COMPILER_MISSING',
      message: 'No working C++ compiler was found on this machine.',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockApi.run.mockResolvedValue({ success: true, status: 'completed', stdout: 'online said hi', exitCode: 0 });

    await act(async () => {
      await actions.runActive();
    });
    // Online execution stays reachable — but only after an explicit yes.
    expect(mockApi.run).toHaveBeenCalledWith(expect.objectContaining({ language: 'cpp', sourceCode: 'int main(){}' }));
    expect(outputTexts().some((t) => t.includes('online said hi'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
  });

  it('an unsaved buffer runs from the temp copy (no file path handed to the main process)', async () => {
    const { actions } = setup();
    let untitledPath;
    act(() => {
      untitledPath = useIdeStore.getState().newUntitled();
      useIdeStore.getState().openDocument({ path: `${untitledPath}`, content: '', language: 'plaintext' });
    });
    // Force a python language document so the local plan applies.
    act(() => useIdeStore.getState().closeTab(untitledPath));
    const UP = 'untitled:Untitled-9';
    act(() => useIdeStore.getState().openDocument({ path: UP, content: 'print(1)', language: 'python' }));
    mockLocal.startLocalRun.mockResolvedValue({ ok: true, sessionId: 'sess-4', finished: true });

    await act(async () => {
      await actions.runActive();
    });
    expect(mockLocal.startLocalRun.mock.calls[0][0].filePath).toBeNull();
    expect(useIdeStore.getState().runHandle).toBeNull(); // already finished
  });

  it('Stop terminates the local child process through the bridge', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'while True: pass');
    mockLocal.startLocalRun.mockImplementation(async () => ({ ok: true, sessionId: 'sess-5', finished: false }));
    await act(async () => {
      await actions.runActive();
    });
    await act(async () => {
      await actions.stopActiveRun();
    });
    expect(mockLocal.stopLocalRun).toHaveBeenCalledWith('sess-5');
    expect(mockApi.run).not.toHaveBeenCalled();
  });

  it('stdin is sent to the running local program and echoed to the panel', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(input())');
    mockLocal.startLocalRun.mockResolvedValue({ ok: true, sessionId: 'sess-6', finished: false });
    await act(async () => {
      await actions.runActive();
    });
    await act(async () => {
      await actions.sendRunInput('feed me');
    });
    expect(mockLocal.sendLocalRunStdin).toHaveBeenCalledWith('sess-6', 'feed me\n');
    expect(outputTexts()).toContain('> feed me');
  });

  it('a language with no local plan still uses the online runner in desktop mode', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, 'C:\\WS\\main.go', 'package main');
    mockApi.run.mockResolvedValue({ success: true, status: 'completed', stdout: 'go\n', stderr: '', exitCode: 0 });

    await act(async () => {
      await actions.runActive();
    });
    expect(mockLocal.startLocalRun).not.toHaveBeenCalled();
    expect(mockApi.run).toHaveBeenCalledTimes(1);
  });

  it('detects installed runtimes at mount without touching the network', async () => {
    mockLocal.detectDesktopRuntimes.mockResolvedValue({
      ok: true,
      plans: ['python'],
      runtimes: { python: { available: true, cmd: 'python', path: 'C:\\Py\\python.exe', version: 'Python 3.14.7' } },
    });
    setup();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockLocal.detectDesktopRuntimes).toHaveBeenCalled();
    expect(useIdeStore.getState().localRuntimes.python.version).toBe('Python 3.14.7');
  });
});

describe('useIdeActions — Run Mode routing (Terminal vs Output) + persistence', () => {
  const outputTexts = () => useIdeStore.getState().output.map((l) => l.text);
  const launchedCommand = () => useIdeStore.getState().terminalLaunch?.command;

  beforeEach(() => {
    mockWorkspace.mode = 'desktop';
    mockLocal.isDesktopLocalRun.mockReturnValue(true);
    // Managed Output runs (used by the fallbacks) return a finished success.
    mockLocal.startLocalRun.mockResolvedValue({ ok: true, sessionId: 'sess-rm', finished: true });
    // Clear any one-shot launch left over from a previous test in this file.
    useIdeStore.setState({ terminalLaunch: null });
    // A known starting point; localStorage persists across tests in a file.
    act(() => useIdeStore.getState().setRunMode('output'));
  });

  afterEach(() => {
    try {
      window.localStorage.removeItem('stackamit:run-mode');
    } catch {
      /* ignore */
    }
  });

  it('choosing Terminal persists the setting and routes a saved file through buildTerminalCommand', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(2)');
    // setRunMode is the real store action — it must also write through to disk.
    act(() => useIdeStore.getState().setRunMode('terminal'));
    expect(window.localStorage.getItem('stackamit:run-mode')).toBe('terminal');

    await act(async () => {
      await actions.runActive();
    });
    expect(mockLocal.buildTerminalCommand).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'python', filePath: P }),
    );
    // Terminal mode never spawns a second, divergent managed process.
    expect(mockLocal.startLocalRun).not.toHaveBeenCalled();
    expect(mockApi.run).not.toHaveBeenCalled();
    // The sequential plan is typed into one terminal session, cwd preserved.
    expect(launchedCommand()).toBe('g++ main.cpp -o main.exe && main.exe');
    expect(useIdeStore.getState().terminalLaunch.cwd).toBe('C:\\WS');
    expect(useIdeStore.getState().bottomPanel.tab).toBe('terminal');
  });

  it('an invalid stored run-mode value falls back to the safe Output default', () => {
    window.localStorage.setItem('stackamit:run-mode', 'nonsense');
    // setRunMode normalises anything that is not 'terminal' back to 'output'.
    act(() => useIdeStore.getState().setRunMode('nonsense'));
    expect(useIdeStore.getState().runMode).toBe('output');
    expect(window.localStorage.getItem('stackamit:run-mode')).toBe('output');
  });

  it('terminal mode hands a dirty buffer back to the managed Output run', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print("saved")');
    act(() => useIdeStore.getState().updateContent(P, 'print("unsaved")'));
    act(() => useIdeStore.getState().setRunMode('terminal'));

    await act(async () => {
      await actions.runActive();
    });
    // A shell runs the file on disk, so an unsaved buffer never goes terminal.
    expect(mockLocal.buildTerminalCommand).not.toHaveBeenCalled();
    expect(useIdeStore.getState().terminalLaunch).toBeNull();
    expect(mockLocal.startLocalRun).toHaveBeenCalled();
    expect(outputTexts().some((t) => t.includes('Run in Terminal') && t.includes('Output panel instead'))).toBe(true);
  });

  it('an unsafe terminal path falls back to the Output run without a launch request', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(2)');
    act(() => useIdeStore.getState().setRunMode('terminal'));
    mockLocal.buildTerminalCommand.mockResolvedValueOnce({
      ok: false,
      code: 'TERMINAL_UNSAFE_PATH',
      message: 'The path cannot be written into a shell command safely.',
    });

    await act(async () => {
      await actions.runActive();
    });
    expect(useIdeStore.getState().terminalLaunch).toBeNull();
    expect(mockLocal.startLocalRun).toHaveBeenCalled();
  });

  it('a missing toolchain in terminal mode is surfaced and starts no second run', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(2)');
    act(() => useIdeStore.getState().setRunMode('terminal'));
    mockLocal.buildTerminalCommand.mockResolvedValueOnce({
      ok: false,
      code: 'CPP_COMPILER_MISSING',
      message: 'No working C++ compiler was found.',
    });

    await act(async () => {
      await actions.runActive();
    });
    // Handled in terminal mode: no managed run, and the failure is shown.
    expect(mockLocal.startLocalRun).not.toHaveBeenCalled();
    expect(outputTexts().some((t) => t.includes('No working C++ compiler'))).toBe(true);
  });

  it('runActiveInOutput forces the managed panel regardless of the saved mode', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(2)');
    act(() => useIdeStore.getState().setRunMode('terminal'));

    await act(async () => {
      await actions.runActiveInOutput();
    });
    expect(mockLocal.buildTerminalCommand).not.toHaveBeenCalled();
    expect(mockLocal.startLocalRun).toHaveBeenCalled();
  });

  it('runActiveInTerminal forces a terminal run even when the saved mode is Output', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(2)');
    act(() => useIdeStore.getState().setRunMode('output'));

    await act(async () => {
      await actions.runActiveInTerminal();
    });
    expect(mockLocal.buildTerminalCommand).toHaveBeenCalled();
    expect(mockLocal.startLocalRun).not.toHaveBeenCalled();
    expect(launchedCommand()).toBe('g++ main.cpp -o main.exe && main.exe');
    // The one-shot forcing does not rewrite the persisted preference.
    expect(useIdeStore.getState().runMode).toBe('output');
  });
});

describe('useIdeActions — path transitions release old models', () => {
  it('rename releases the old-path model after reassigning the doc', async () => {
    const { actions, monaco } = setup();
    const model = await openFile(actions, monaco);
    const NEW = 'C:\\WS\\renamed.py';
    mockWorkspace.rename.mockResolvedValue({ ok: true, path: NEW });

    await act(async () => {
      await actions.rename(P, 'renamed.py');
    });
    expect(model.disposed).toBe(true);
    const store = useIdeStore.getState();
    expect(store.docs[P]).toBeUndefined();
    expect(store.docs[NEW].name).toBe('renamed.py');
  });

  it('Save As on an untitled doc releases the orphaned untitled model', async () => {
    const { actions, monaco } = setup();
    let untitledPath;
    act(() => {
      untitledPath = useIdeStore.getState().newUntitled();
    });
    act(() => useIdeStore.getState().setActive(untitledPath));
    const model = monaco.getOrCreateModel(untitledPath, '');
    mockWorkspace.saveAs.mockResolvedValue({ ok: true, path: 'C:\\WS\\saved.txt' });

    await act(async () => {
      await actions.saveAs();
    });
    expect(model.disposed).toBe(true);
    const store = useIdeStore.getState();
    expect(store.docs[untitledPath]).toBeUndefined();
    expect(store.docs['C:\\WS\\saved.txt']).toBeDefined();
  });

  it('deleting a file on disk closes its tab and disposes its model', async () => {
    const { actions, monaco } = setup();
    const model = await openFile(actions, monaco);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockWorkspace.remove.mockResolvedValue({ ok: true, path: P });

    await act(async () => {
      await actions.remove(P);
    });
    expect(model.disposed).toBe(true);
    expect(useIdeStore.getState().docs[P]).toBeUndefined();
  });
});

describe('useIdeActions — saveActive uses the shared Auto Save pipeline', () => {
  it('manual Save writes the active doc and marks it saved (works with Auto Save off)', async () => {
    window.localStorage.setItem('stackamit:editor-prefs', JSON.stringify({ autoSave: false }));
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'orig');
    act(() => useIdeStore.getState().updateContent(P, 'edited'));
    mockWorkspace.writeFile.mockResolvedValue({ ok: true, path: P });

    await act(async () => {
      await actions.saveActive();
    });
    expect(mockWorkspace.writeFile).toHaveBeenCalledWith(P, 'edited');
    const d = useIdeStore.getState().docs[P];
    expect(d.savedContent).toBe('edited');
    expect(d.saveState).toBe('saved');
    window.localStorage.removeItem('stackamit:editor-prefs');
  });

  it('a failed manual save reports the error and keeps the document dirty', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'orig');
    act(() => useIdeStore.getState().updateContent(P, 'edited'));
    mockWorkspace.writeFile.mockResolvedValue({ ok: false, message: 'read-only' });

    await act(async () => {
      await actions.saveActive();
    });
    const d = useIdeStore.getState().docs[P];
    expect(d.saveState).toBe('failed');
    expect(d.savedContent).toBe('orig'); // never falsely committed
    expect(d.content).toBe('edited'); // editor keeps the unsaved text
  });
});

describe('useIdeActions — naming asks the app, never window.prompt', () => {
  /** Electron throws when renderer code calls window.prompt; mimic that exactly. */
  const forbidPrompt = () =>
    vi.spyOn(window, 'prompt').mockImplementation(() => {
      throw new Error('prompt() is and will not be supported.');
    });

  it('rename without a name waits for the modal answer and renames on disk', async () => {
    const promptSpy = forbidPrompt();
    const { actions } = setup();
    mockWorkspace.rename.mockResolvedValue({ ok: true, path: 'C:\\WS\\files\\renamed.py' });

    let res;
    await act(async () => {
      const pending = actions.rename(P);
      await Promise.resolve();
      expect(useIdeStore.getState().prompt?.title).toBe('Rename to:');
      expect(useIdeStore.getState().prompt?.defaultValue).toBe('main.py');
      useIdeStore.getState().answerPrompt('renamed.py');
      res = await pending;
    });

    expect(res.ok).toBe(true);
    expect(mockWorkspace.rename).toHaveBeenCalledWith(P, 'renamed.py');
    expect(promptSpy).not.toHaveBeenCalled();
    expect(useIdeStore.getState().prompt).toBeNull();
  });

  it('a dismissed prompt cancels the rename instead of touching the disk', async () => {
    forbidPrompt();
    const { actions } = setup();

    let res;
    await act(async () => {
      const pending = actions.rename(P);
      await Promise.resolve();
      useIdeStore.getState().answerPrompt(null); // Escape / Cancel
      res = await pending;
    });

    expect(res).toEqual({ ok: false, code: 'CANCELED' });
    expect(mockWorkspace.rename).not.toHaveBeenCalled();
  });

  it('new file and new folder ask the modal for their names', async () => {
    forbidPrompt();
    const { actions } = setup();
    mockWorkspace.createFile.mockResolvedValue({ ok: true, path: 'C:\\WS\\notes.txt' });
    mockWorkspace.readFile.mockResolvedValue({ ok: true, path: 'C:\\WS\\notes.txt', content: '' });
    mockWorkspace.createDirectory.mockResolvedValue({ ok: true, path: 'C:\\WS\\new' });

    let fileRes;
    await act(async () => {
      const pending = actions.createFile('C:\\WS');
      await Promise.resolve();
      expect(useIdeStore.getState().prompt?.defaultValue).toBe('untitled.txt');
      useIdeStore.getState().answerPrompt('notes.txt');
      fileRes = await pending;
    });
    expect(fileRes.ok).toBe(true);
    expect(mockWorkspace.createFile).toHaveBeenCalledWith('C:\\WS', 'notes.txt');

    await act(async () => {
      const pending = actions.createDirectory('C:\\WS');
      await Promise.resolve();
      expect(useIdeStore.getState().prompt?.title).toBe('New folder name:');
      useIdeStore.getState().answerPrompt('new');
      await pending;
    });
    expect(mockWorkspace.createDirectory).toHaveBeenCalledWith('C:\\WS', 'new');
  });

  it('an offline build fires no lint request (no server to ask)', async () => {
    mockApi.remoteRunAvailability.mockReturnValue({ ok: false, code: 'NO_API_SERVER' });
    mockWorkspace.mode = 'desktop';
    const { actions, monaco } = setup();
    await openFile(actions, monaco); // python is a lintable language

    await act(async () => {
      await actions.lintActive();
    });
    expect(mockApi.lint).not.toHaveBeenCalled();
  });

  it('a reachable server still lints the active file', async () => {
    mockApi.lint.mockResolvedValue({ markers: [] });
    const { actions, monaco } = setup();
    await openFile(actions, monaco);

    await act(async () => {
      await actions.lintActive();
    });
    expect(mockApi.lint).toHaveBeenCalled();
  });
});

describe('useIdeActions — Web Mode interactive run (reuses the shared transport)', () => {
  const outputTexts = () => useIdeStore.getState().output.map((l) => l.text);
  const RealWS = global.WebSocket;

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
    send(d) { this.sent.push(JSON.parse(d)); }
    close() { this.readyState = 3; this.onclose && this.onclose(); }
    emit(msg) { this.onmessage && this.onmessage({ data: JSON.stringify(msg) }); }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    FakeWebSocket.instances = [];
    global.WebSocket = FakeWebSocket;
    mockWorkspace.mode = 'web';
    mockLocal.isDesktopLocalRun.mockReturnValue(false);
  });
  afterEach(() => {
    global.WebSocket = RealWS;
  });

  it('routes a native language to a live interactive session, not the batch API', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'name = input("Enter your name: ")');
    act(() => useIdeStore.getState().setInteractiveStatus({ enabled: true, runtimes: { python: { available: true, cmd: 'python' } } }));

    let done;
    act(() => { done = actions.runActive(); });
    await act(flush); // let the socket open + start frame go out
    const ws = FakeWebSocket.instances.at(-1);
    expect(ws.sent[0]).toEqual({ type: 'start', language: 'python', sourceCode: 'name = input("Enter your name: ")' });
    expect(useIdeStore.getState().runHandle).toMatchObject({ mode: 'interactive', language: 'python' });
    expect(useIdeStore.getState().runState).toBe('running');
    // The batch provider is never touched when a live session is available.
    expect(mockApi.run).not.toHaveBeenCalled();

    act(() => ws.emit({ type: 'stdout', data: 'Enter your name: ' }));
    // The user's answer is piped to the running process (the shared stdin path).
    await act(async () => { await actions.sendRunInput('Alice'); });
    expect(ws.sent.some((m) => m.type === 'stdin' && m.data === 'Alice\n')).toBe(true);
    // Interactive input is rendered from the server-confirmed acknowledgement,
    // so the client does not optimistically echo it twice.
    act(() => ws.emit({ type: 'stdin', data: 'Alice\n' }));
    expect(outputTexts()).toContain('> Alice');

    act(() => ws.emit({ type: 'stdout', data: 'Hello Alice' }));
    act(() => ws.emit({ type: 'exit', code: 0 }));
    await act(async () => { await done; });
    expect(outputTexts()).toContain('Hello Alice');
    expect(outputTexts().some((t) => t.startsWith('✓ Finished') && t.includes('exit 0'))).toBe(true);
    expect(useIdeStore.getState().runState).toBe('idle');
    expect(useIdeStore.getState().runHandle).toBeNull();
  });

  it('Stop terminates the interactive session (stop frame) and returns to idle', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'while True: pass');
    act(() => useIdeStore.getState().setInteractiveStatus({ enabled: true, runtimes: { python: { available: true } } }));

    let done;
    act(() => { done = actions.runActive(); });
    await act(flush);
    const ws = FakeWebSocket.instances.at(-1);
    await act(async () => { await actions.stopActiveRun(); });
    expect(ws.sent.some((m) => m.type === 'stop')).toBe(true);
    await act(async () => { await done; });
    expect(useIdeStore.getState().runState).toBe('idle');
  });

  it('falls back to the batch provider when the server reports no interactive runtime', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(1)');
    act(() => useIdeStore.getState().setInteractiveStatus({ enabled: false, runtimes: {} }));
    mockApi.run.mockResolvedValue({ success: true, status: 'completed', stdout: '1', stderr: '', exitCode: 0 });

    await act(async () => { await actions.runActive(); });
    expect(FakeWebSocket.instances.length).toBe(0); // never opened a live socket
    expect(mockApi.run).toHaveBeenCalledTimes(1);
    expect(outputTexts()).toContain('1');
  });

  it('an unavailable runtime for that language also falls back to batch (never assumes interactive)', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(2)');
    act(() => useIdeStore.getState().setInteractiveStatus({ enabled: true, runtimes: { python: { available: false } } }));
    mockApi.run.mockResolvedValue({ success: true, status: 'completed', stdout: '2', stderr: '', exitCode: 0 });

    await act(async () => { await actions.runActive(); });
    expect(FakeWebSocket.instances.length).toBe(0);
    expect(mockApi.run).toHaveBeenCalledTimes(1);
  });

  it('an interactive run never injects staged batch stdin into the live process (no cross-mode leak)', async () => {
    const { actions, monaco } = setup();
    await openFile(actions, monaco, P, 'print(input())');
    act(() => {
      // A pre-run batch value left over from an earlier batch run must not
      // silently feed a program that is now running interactively.
      useIdeStore.getState().setRunStdin('stale');
      useIdeStore.getState().setInteractiveStatus({ enabled: true, runtimes: { python: { available: true } } });
    });
    let done;
    act(() => { done = actions.runActive(); });
    await act(flush);
    const ws = FakeWebSocket.instances.at(-1);
    // The start frame carries the source only — never the staged batch stdin.
    expect(ws.sent[0]).toEqual({ type: 'start', language: 'python', sourceCode: 'print(input())' });
    expect(JSON.stringify(ws.sent)).not.toContain('stale');
    act(() => ws.emit({ type: 'exit', code: 0 }));
    await act(async () => { await done; });
    // The staged batch value is untouched, so a later batch run can still use it.
    expect(useIdeStore.getState().runStdin).toBe('stale');
  });
});

describe('useIdeActions — Web Mode JavaScript prompt() honest hint (no source transform)', () => {
  const outputTexts = () => useIdeStore.getState().output.map((l) => l.text);

  it('warns when a program reads prompt() without awaiting it, and still runs it', async () => {
    const { actions, monaco } = setup();
    mockWorkspace.mode = 'web';
    await openFile(actions, monaco, 'C:\\WS\\hello.js', 'const name = prompt("Enter your name:");\nconsole.log("Hello, " + name + "!");');
    mockBrowser.runBrowserJavaScript.mockResolvedValue({
      success: true, status: 'completed', stdout: 'Hello, [object Promise]!', stderr: '', exitCode: 0, provider: 'browser', executionTimeMs: 2,
    });

    await act(async () => { await actions.runActive(); });
    // The honest hint explains the async bridge and shows the fix, without ever
    // rewriting the user's source (the runner is still handed the original text).
    expect(outputTexts().some((t) => t.includes('without awaiting') && t.includes('await prompt'))).toBe(true);
    expect(mockBrowser.runBrowserJavaScript).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'const name = prompt("Enter your name:");\nconsole.log("Hello, " + name + "!");' }),
    );
    expect(outputTexts()).toContain('Hello, [object Promise]!');
  });

  it('adds no hint when the program already awaits the prompt', async () => {
    const { actions, monaco } = setup();
    mockWorkspace.mode = 'web';
    await openFile(actions, monaco, 'C:\\WS\\ok.js', 'const name = await prompt("Enter your name:");');
    mockBrowser.runBrowserJavaScript.mockResolvedValue({
      success: true, status: 'completed', stdout: 'Hello, Alice!', stderr: '', exitCode: 0, provider: 'browser', executionTimeMs: 2,
    });

    await act(async () => { await actions.runActive(); });
    expect(outputTexts().some((t) => t.includes('without awaiting'))).toBe(false);
  });
});
