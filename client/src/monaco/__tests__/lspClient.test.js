/**
 * Renderer-side tests for the thin LSP client.
 *
 * The desktop bridge (window.stackamit.lsp) and WebSocket are faked here;
 * what is under test is the client's honest decision tree: connect and wire
 * real Monaco providers only when a wsUrl comes back, keep the untouched
 * basic experience on MISSING_TOOL / no bridge, speak a correct LSP
 * handshake, convert payloads, and clean everything up on dispose.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  attachLspSession,
  answerWorkspaceConfiguration,
  isJavaBuildDescriptor,
  javaSettings,
  notifyLspFilesChanged,
  pathToUri,
  pickMessageRequestAction,
  redactSecrets,
  resolveConfigSection,
  uriToPath,
  sameUri,
  WsJsonRpc,
} from '../lspClient.js';

// ---------------------------------------------------------------------------
// Fake WebSocket (jsdom's real one would try to hit the network)
// ---------------------------------------------------------------------------
const NO_REPLY = '__no_reply__';
// Tests that want a request to stay unanswered flip this before connecting.
let replyToInitialize = true;

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.listeners = {};
    this.sent = [];
    // Method -> canned result for incoming requests (beyond initialize).
    this.results = {};
    FakeWebSocket.instances.push(this);
    setTimeout(() => {
      if (this.readyState === 0) {
        this.readyState = 1;
        this._fire('open', {});
      }
    }, 0);
  }
  addEventListener(type, cb) {
    (this.listeners[type] = this.listeners[type] || []).push(cb);
  }
  removeEventListener(type, cb) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== cb);
  }
  _fire(type, ev) {
    for (const cb of this.listeners[type] || []) cb(ev);
  }
  send(raw) {
    const msg = JSON.parse(raw);
    this.sent.push(msg);
    if (msg.id && msg.method) {
      let result = null;
      if (msg.method === 'initialize') {
        if (!replyToInitialize) return; // simulate a server that never answers
        result = { capabilities: { completionProvider: {} } };
      } else if (Object.prototype.hasOwnProperty.call(this.results, msg.method)) {
        result = this.results[msg.method];
      }
      if (result === NO_REPLY) return;
      setTimeout(() => this.reply({ jsonrpc: '2.0', id: msg.id, result }), 0);
    }
  }
  reply(obj) {
    this._fire('message', { data: JSON.stringify(obj) });
  }
  pushNotification(method, params) {
    this._fire('message', { data: JSON.stringify({ jsonrpc: '2.0', method, params }) });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this._fire('close', {}), 0);
  }
  findSent(method) {
    return this.sent.find((m) => m.method === method);
  }
}

function fakeMonaco() {
  const providers = {};
  const reg = (name) => vi.fn((lang, provider) => {
    (providers[name] = providers[name] || []).push({ lang, provider });
    return { dispose: vi.fn() };
  });
  const monaco = {
    Range: class {
      constructor(a, b, c, d) {
        this.startLineNumber = a;
        this.startColumn = b;
        this.endLineNumber = c;
        this.endColumn = d;
      }
    },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    languages: {
      CompletionItemKind: Object.assign([...Array(26)].map((_, i) => i), { Text: 0, Function: 2, Module: 2, TypeParameter: 25 }),
      SymbolKind: Object.assign([...Array(27)].map((_, i) => i), { File: 0, TypeParameter: 26 }),
      registerCompletionItemProvider: reg('completion'),
      registerHoverProvider: reg('hover'),
      registerSignatureHelpProvider: reg('signature'),
      registerDefinitionProvider: reg('definition'),
      registerReferenceProvider: reg('references'),
      registerDocumentSymbolProvider: reg('symbols'),
      registerDocumentFormattingEditProvider: reg('formatting'),
    },
    editor: { setModelMarkers: vi.fn() },
  };
  return { monaco, providers };
}

function fakeParts() {
  const docPath = 'C:\\w\\a.py';
  const model = {
    uri: { toString: () => 'file:///c:/w/a.py' },
    getValue: () => 'print("x")\n',
    onDidChangeContent: vi.fn(() => ({ dispose: () => {} })),
    getWordUntilPosition: () => ({ startColumn: 1, endColumn: 5 }),
    validateRange: (r) => r,
  };
  const editor = {
    getOptions: () => ({ wordBasedSuggestions: 'currentLanguage' }),
    updateOptions: vi.fn(),
  };
  return { docPath, model, editor };
}

let startMock;
beforeEach(() => {
  FakeWebSocket.instances = [];
  replyToInitialize = true;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  startMock = vi.fn();
  window.stackamit = { lsp: { start: startMock, stop: vi.fn(), status: vi.fn() } };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.stackamit;
});

async function connect(overrides = {}) {
  const { monaco, providers } = fakeMonaco();
  const parts = fakeParts();
  const states = [];
  const opts = {
    monaco,
    providers,
    editor: parts.editor,
    model: parts.model,
    language: 'python',
    docPath: parts.docPath,
    root: 'C:\\w',
    toolPath: null,
    onState: (s) => states.push(s),
    lookupModelUri: () => null,
    ...overrides,
  };
  const session = await attachLspSession(opts);
  return { session, monaco, providers, states, parts };
}

// ---------------------------------------------------------------------------
describe('uri helpers', () => {
  it('round-trips Windows paths with drive letters, spaces and Unicode', () => {
    const uri = pathToUri('C:\\Program Files\\工具\\main.py');
    expect(uri.startsWith('file:///')).toBe(true);
    expect(uriToPath(uri)).toBe('C:\\Program Files\\工具\\main.py');
    expect(sameUri(pathToUri('c:\\w\\A.py'), pathToUri('C:\\w\\a.py'))).toBe(true);
    expect(sameUri('file:///c:/w/a.py', 'file:///c:/w/other.py')).toBe(false);
  });
});

describe('attachLspSession decision tree', () => {
  it('connects and reports ready when the bridge returns a wsUrl', async () => {
    startMock.mockResolvedValue({ ok: true, wsUrl: 'ws://127.0.0.1:54321/lsp', tool: 'pyright-langserver', version: 'pyright 1.1.414', reused: false });
    const { session, states, providers, parts } = await connect();
    expect(session.connected).toBe(true);
    expect(states).toEqual(['starting', 'ready']);
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe('ws://127.0.0.1:54321/lsp');
    // Handshake in protocol order, with the workspace root as rootUri.
    const methods = socket.sent.map((m) => m.method);
    expect(methods[0]).toBe('initialize');
    expect(methods[1]).toBe('initialized');
    expect(methods[2]).toBe('textDocument/didOpen');
    expect(socket.findSent('initialize').params.rootUri).toContain('C:');
    expect(socket.findSent('textDocument/didOpen').params.textDocument.uri).toBe(pathToUri(parts.docPath));
    // Real providers registered for python only.
    expect(providers.completion[0].lang).toBe('python');
    expect(providers.hover).toHaveLength(1);
    expect(providers.symbols).toHaveLength(1);
    // Duplicate-provider control while connected.
    expect(parts.editor.updateOptions).toHaveBeenCalledWith({ wordBasedSuggestions: 'off' });
  });

  it('keeps the basic experience untouched on MISSING_TOOL', async () => {
    startMock.mockResolvedValue({ ok: false, code: 'MISSING_TOOL', message: 'pyright-langserver was not found on PATH.' });
    const { session, states, providers, parts } = await connect();
    expect(session.connected).toBe(false);
    expect(session.reason).toBe('MISSING_TOOL');
    expect(states).toEqual(['starting', 'missing-tool']);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(Object.keys(providers)).toHaveLength(0);
    expect(parts.editor.updateOptions).not.toHaveBeenCalled();
  });

  it('reports idle for unsupported languages and error when no desktop bridge exists', async () => {
    startMock.mockResolvedValue({ ok: false, code: 'UNSUPPORTED_LANGUAGE', message: 'no server' });
    let res = await connect();
    expect(res.states).toEqual(['starting', 'idle']);

    delete window.stackamit; // web mode
    startMock.mockResolvedValue(undefined);
    res = await connect();
    expect(res.session.reason).toBe('NO_DESKTOP_BRIDGE');
    expect(res.states).toEqual(['starting', 'error']);
  });

  it('never attaches to untitled buffers and never calls the bridge', async () => {
    const { session } = await connect({ docPath: 'untitled:Untitled-1' });
    expect(session.reason).toBe('not-a-file');
    expect(startMock).not.toHaveBeenCalled();
  });
});

describe('protocol behavior over the fake socket', () => {
  async function connected() {
    startMock.mockResolvedValue({ ok: true, wsUrl: 'ws://127.0.0.1:1/lsp', tool: 'pyright-langserver', version: null, reused: false });
    const ctx = await connect();
    expect(ctx.session.connected).toBe(true);
    const socket = FakeWebSocket.instances[0];
    // Give the didOpen/registration round-trip a tick to settle.
    await vi.waitFor(() => expect(socket.sent.some((m) => m.method === 'textDocument/didOpen')).toBe(true));
    return { ...ctx, socket };
  }

  it('maps published diagnostics to Monaco markers for the same file only', async () => {
    const { socket, monaco, parts } = await connected();
    const uri = pathToUri('C:\\w\\a.py');
    socket.pushNotification('textDocument/publishDiagnostics', {
      uri,
      diagnostics: [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } }, severity: 1, message: 'expected int', code: 120, source: 'Pylance' }],
    });
    await vi.waitFor(() => expect(monaco.editor.setModelMarkers).toHaveBeenCalled());
    const [model, owner, markers] = monaco.editor.setModelMarkers.mock.calls.at(-1);
    expect(model).toBe(parts.model);
    expect(owner).toBe('stackamit-lsp');
    expect(markers[0]).toMatchObject({
      severity: monaco.MarkerSeverity.Error,
      message: 'expected int',
      startLineNumber: 1,
      startColumn: 7,
      code: '120',
      source: 'Pylance',
    });
    // Diagnostics for a different file must not touch this model.
    monaco.editor.setModelMarkers.mockClear();
    socket.pushNotification('textDocument/publishDiagnostics', { uri: pathToUri('C:\\w\\b.py'), diagnostics: [{ message: 'other' }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(monaco.editor.setModelMarkers).not.toHaveBeenCalled();
  });

  it('converts LSP completions into Monaco suggestions through the registered provider', async () => {
    const { socket, providers } = await connected();
    socket.results['textDocument/completion'] = {
      isIncomplete: false,
      items: [
        { label: 'print', kind: 3, insertText: 'print', detail: 'built-in function' },
        { label: 're.sub(pattern)', insertText: 're.sub(${0:pattern})', insertTextFormat: 2 },
      ],
    };
    const provider = providers.completion[0].provider;
    const res = await provider.provideCompletionItems(
      { uri: { toString: () => 'file:///c:/w/a.py' } },
      { lineNumber: 1, column: 3 },
      { triggerKind: 1 },
    );
    const request = socket.findSent('textDocument/completion');
    expect(request.params.position).toEqual({ line: 0, character: 2 });
    expect(res.incomplete).toBe(false);
    expect(res.suggestions[0].label).toBe('print');
    expect(res.suggestions[0].kind).toBe(monacoKindFunction());
    // Snippets were declared unsupported, but de-snippet defensively anyway.
    expect(res.suggestions[1].insertText).toBe('re.sub(pattern)');
  });

  it('answers another-model requests with nothing (providers are model-scoped)', async () => {
    const { providers } = await connected();
    const otherModel = { uri: { toString: () => 'file:///c:/w/other.py' } };
    const res = await providers.hover[0].provider.provideHover(otherModel, { lineNumber: 1, column: 1 });
    expect(res).toBeNull();
  });

  it('dispose performs didClose + shutdown + exit, clears markers and restores options', async () => {
    const { session, socket, monaco, parts } = await connected();
    await session.dispose();
    expect(socket.findSent('textDocument/didClose')).toBeTruthy();
    expect(socket.findSent('shutdown')).toBeTruthy();
    expect(socket.findSent('exit')).toBeTruthy();
    expect(socket.readyState).toBe(3);
    const calls = monaco.editor.setModelMarkers.mock.calls;
    expect(calls.at(-1)[2]).toEqual([]);
    expect(parts.editor.updateOptions).toHaveBeenLastCalledWith({ wordBasedSuggestions: 'currentLanguage' });
  });

  it('reports error and unwinds if the socket dies mid-handshake', async () => {
    replyToInitialize = false; // server accepted the socket but never answers
    startMock.mockResolvedValue({ ok: true, wsUrl: 'ws://127.0.0.1:2/lsp', tool: 'pyright-langserver', version: null, reused: false });
    const { monaco, providers } = fakeMonaco();
    const parts = fakeParts();
    const states = [];
    const promise = attachLspSession({ ...parts, monaco, language: 'python', docPath: parts.docPath, root: null, toolPath: null, onState: (s) => states.push(s), lookupModelUri: () => null });
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    // Kill the connection while initialize is still pending.
    await vi.waitFor(() => expect(socket.sent.some((m) => m.method === 'initialize')).toBe(true));
    socket.readyState = 3;
    socket._fire('close', {});
    const session = await promise;
    expect(session.connected).toBe(false);
    expect(session.reason).toBe('initialize-failed');
    expect(states).toEqual(['starting', 'error']);
    expect(parts.editor.updateOptions).not.toHaveBeenCalled();
    expect(providers.completion || []).toHaveLength(0);
  });
});

// Small helper so the completion assertion doesn't hardcode enum arithmetic.
function monacoKindFunction() {
  return fakeMonaco().monaco.languages.CompletionItemKind.Function;
}

// ---------------------------------------------------------------------------
// Java: the settings that make java.* resolve, and the server's own voice
// ---------------------------------------------------------------------------
describe('java settings helpers', () => {
  it('points java.home at the verified JDK and keeps dependency import offline', () => {
    const s = javaSettings({ jdkHome: 'C:\\jdk-21' });
    expect(s.java.home).toBe('C:\\jdk-21');
    expect(s.java.homeSource).toBe('setting');
    expect(s.java.import.maven.offline).toBe(true);
    expect(s.java.import.gradle.offline).toBe(true);
    expect(s.java.maven.downloadSources).toBe(false);
    // A build-file change must be confirmed with the user, not silently applied.
    expect(s.java.configuration.updateBuildConfiguration).toBe('interactive');
  });

  it('leaves java.home on server auto-detection when the bridge has no JDK', () => {
    const s = javaSettings({});
    expect(s.java.home).toBeUndefined();
    expect(s.java.homeSource).toBe('auto');
  });

  it('switches Maven/Gradle import off for a standalone .java file', () => {
    const s = javaSettings({ jdkHome: 'C:\\jdk-21', standalone: true });
    expect(s.java.import.maven.enabled).toBe(false);
    expect(s.java.import.gradle.enabled).toBe(false);
  });

  it('looks sections up by dotted path and answers unknown ones with null', () => {
    const tree = javaSettings({ jdkHome: 'C:\\jdk-21' });
    expect(resolveConfigSection(tree, 'java.import.maven').offline).toBe(true);
    expect(resolveConfigSection(tree, 'java.nope.deep')).toBeUndefined();
    const answered = answerWorkspaceConfiguration(
      [{ scopeUri: 'file:///c:/w/Main.java', section: 'java.import.maven' }, { section: 'editor' }, {}],
      tree,
    );
    expect(answered[0]).toMatchObject({ offline: true });
    // null = "the server default", never an invented empty object.
    expect(answered[1]).toBeNull();
    expect(answered[2]).toBe(tree);
  });

  it('recognizes the files whose change means the Java model must be re-read', () => {
    for (const p of ['C:\\w\\pom.xml', 'C:\\w\\build.gradle', 'C:\\w\\app\\build.gradle.kts', 'C:\\w\\settings.gradle', 'path/to/module-info.java']) {
      expect(isJavaBuildDescriptor(p), p).toBe(true);
    }
    for (const p of ['C:\\w\\Main.java', 'C:\\w\\pom.xml.bak', 'C:\\w\\gradle-wrapper.properties', '']) {
      expect(isJavaBuildDescriptor(p), p).toBe(false);
    }
  });

  it('chooses to re-read the project and never presses "Never"', () => {
    expect(pickMessageRequestAction([{ title: 'Never do this automatically' }, { title: 'Update project' }])?.title).toBe('Update project');
    expect(pickMessageRequestAction([{ title: 'Cancel' }, { title: 'Reload project' }])?.title).toBe('Reload project');
    expect(pickMessageRequestAction([{ title: 'OK' }])?.title).toBe('OK');
    expect(pickMessageRequestAction([])).toBeNull();
    expect(pickMessageRequestAction(null)).toBeNull();
  });

  it('redacts credential-shaped values coming from a server', () => {
    expect(redactSecrets('settings.xml password=Hunter2! server offline')).toMatch(/password=\[redacted\]/);
    expect(redactSecrets('token: "abcd1234", repo id')).toBe('token: [redacted], repo id');
    expect(redactSecrets('Nothing sensitive: 3 files imported')).toBe('Nothing sensitive: 3 files imported');
  });
});

describe('java session over the fake socket', () => {
  async function connectJava({ javaProjectMode = 'project', jdkHome = 'C:\\jdk-21' } = {}) {
    startMock.mockResolvedValue({
      ok: true,
      wsUrl: 'ws://127.0.0.1:17/lsp',
      tool: 'jdtls',
      version: null,
      reused: false,
      jdkHome,
      jdkVersion: '21.0.2',
    });
    const { monaco, providers } = fakeMonaco();
    const parts = fakeParts();
    const messages = [];
    const session = await attachLspSession({
      monaco,
      editor: parts.editor,
      model: parts.model,
      language: 'java',
      docPath: 'C:\\w\\Main.java',
      root: 'C:\\w',
      toolPath: null,
      jdkPath: jdkHome,
      reprobe: true,
      javaProjectMode,
      onState: () => {},
      onServerMessage: (m) => messages.push(m),
      lookupModelUri: () => null,
    });
    const socket = FakeWebSocket.instances.at(-1);
    await vi.waitFor(() => expect(socket.sent.some((m) => m.method === 'initialized')).toBe(true));
    return { session, socket, messages, monaco, providers };
  }

  it('sends the verified JDK in initializationOptions and repeats it via didChangeConfiguration', async () => {
    const { socket } = await connectJava();
    const init = socket.findSent('initialize');
    expect(init.params.initializationOptions.settings.java.home).toBe('C:\\jdk-21');
    expect(init.params.capabilities.workspace.configuration).toBe(true);
    const changed = socket.findSent('workspace/didChangeConfiguration');
    expect(changed.params.settings.java.home).toBe('C:\\jdk-21');
  });

  it('answers the server workspace/configuration from the same settings tree', async () => {
    const { socket } = await connectJava();
    socket.reply({ jsonrpc: '2.0', id: 500, method: 'workspace/configuration', params: { items: [{ section: 'java.import.maven' }] } });
    await vi.waitFor(() => expect(socket.sent.find((m) => m.id === 500)).toBeTruthy());
    expect(socket.sent.find((m) => m.id === 500).result[0]).toMatchObject({ offline: true, enabled: true });
  });

  it('disables build-tool import for a standalone file (third-party libraries are not available there)', async () => {
    const { socket } = await connectJava({ javaProjectMode: 'standalone' });
    expect(socket.findSent('initialize').params.initializationOptions.settings.java.import.maven.enabled).toBe(false);
  });

  it('relays server progress, warnings and errors to the Output panel, redacted', async () => {
    const { socket, messages } = await connectJava();
    socket.pushNotification('language/status', { type: 'ProjectStatus', message: 'Starting Java Language Server' });
    socket.pushNotification('window/showMessage', { type: 1, message: 'The host JAVA_HOME=undefined password=s3cr3t broke' });
    socket.pushNotification('window/logMessage', { type: 4, message: 'DEBUG chatty line' });
    await vi.waitFor(() => expect(messages).toHaveLength(3));
    expect(messages[0]).toMatchObject({ kind: 'status', outputKind: 'info', language: 'java' });
    expect(messages[1].text).toContain('password=[redacted]');
    expect(messages[1].text).not.toContain('s3cr3t');
    expect(messages[1].outputKind).toBe('fail');
    expect(messages[2].outputKind).toBe('muted');
  });

  it('answers a showMessageRequest with the refresh action and tells the user', async () => {
    const { socket, messages } = await connectJava();
    socket.reply({
      jsonrpc: '2.0',
      id: 501,
      method: 'window/showMessageRequest',
      params: {
        type: 2,
        message: 'Build file changes detected. Would you like to reload the project?',
        actions: [{ title: 'Never do this automatically' }, { title: 'Update project' }],
      },
    });
    await vi.waitFor(() => expect(socket.sent.find((m) => m.id === 501)).toBeTruthy());
    expect(socket.sent.find((m) => m.id === 501).result).toEqual({ title: 'Update project' });
    await vi.waitFor(() => expect(messages.some((m) => m.kind === 'action' && /chose "Update project"/.test(m.text))).toBe(true));
    expect(messages.find((m) => m.kind === 'action').text).toMatch(/local cache only; nothing is downloaded/);
  });

  it('forwards on-disk file changes and stops after dispose', async () => {
    const { session, socket } = await connectJava();
    expect(notifyLspFilesChanged(['C:\\w\\pom.xml'])).toBe(true);
    const watched = socket.findSent('workspace/didChangeWatchedFiles');
    expect(watched.params.changes[0].uri).toBe(pathToUri('C:\\w\\pom.xml'));
    expect(watched.params.changes[0].type).toBe(2);
    await session.dispose();
    expect(notifyLspFilesChanged(['C:\\w\\pom.xml'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('WsJsonRpc', () => {
  it('resolves responses, rejects timeouts and answers server requests', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const socket = new FakeWebSocket('ws://x');
    socket.readyState = 1;
    const rpc = new WsJsonRpc(socket);
    socket.results = { ping: { pong: 1 }, 'slow/method': NO_REPLY };
    await expect(rpc.request('ping', {})).resolves.toEqual({ pong: 1 });
    await expect(rpc.request('slow/method', {}, 30)).rejects.toMatchObject({ code: -32001 });
    // Unknown server-initiated requests get an honest null answer...
    socket.sent = [];
    socket.reply({ jsonrpc: '2.0', id: 99, method: 'workspace/anything', params: {} });
    await new Promise((r) => setTimeout(r, 5));
    expect(socket.sent.find((m) => m.id === 99)).toMatchObject({ result: null });
    // ...while a registered handler answers with its own result.
    rpc.onRequest('custom/get', () => 5);
    socket.sent = [];
    socket.reply({ jsonrpc: '2.0', id: 100, method: 'custom/get', params: {} });
    await new Promise((r) => setTimeout(r, 5));
    expect(socket.sent.find((m) => m.id === 100)).toMatchObject({ result: 5 });
    rpc.dispose();
  });
});
