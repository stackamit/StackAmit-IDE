/**
 * Thin LSP client for Monaco (renderer side).
 *
 * This is the pivot design: no monaco-languageclient (v11 requires replacing
 * monaco-editor with @codingame/vscode-services), no editor rewrite. Instead a
 * small, honest client speaks standard LSP over the loopback WebSocket that
 * the main process bridges to the real server (Pyright/clangd/JDT.LS), and
 * registers plain Monaco providers for what the server actually supports:
 * completion, hover, signature help, definitions, references, document
 * symbols, formatting and diagnostics (setModelMarkers).
 *
 * Transport detail: one JSON-RPC message per WebSocket frame (no
 * Content-Length headers on the ws hop — the main-process bridge adds that
 * framing when talking to the child's stdio).
 *
 * Web mode / missing tool / crashed server: this module never throws into the
 * editor. It reports the state and leaves the existing basic experience
 * (highlighting + snippets) exactly as it is today.
 */
import { lspStart } from '../services/lsp.js';

// ---------------------------------------------------------------------------
// File-URI helpers (Windows drive letters, spaces, Unicode, # and %)
// ---------------------------------------------------------------------------

/** Absolute fs path -> canonical `file://` URI string. */
export function pathToUri(fsPath) {
  let s = String(fsPath).replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(s)) s = '/' + s;
  if (!s.startsWith('/')) s = '/' + s;
  const segments = s.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  // Keep drive-colon readable (vscode-uri encodes it; both parse back the same).
  return 'file://' + segments.replace('%3A', ':');
}

/** `file://` URI string -> absolute fs path (accepts %3A and : drive forms). */
export function uriToPath(uriString) {
  let rest = String(uriString);
  const m = rest.match(/^file:\/\/(.*)$/i);
  if (!m) return null;
  rest = m[1];
  try {
    rest = decodeURIComponent(rest);
  } catch {
    /* already plain */
  }
  rest = rest.replace(/^\/+/, '');
  if (/^[a-zA-Z%3A:]/i.test(rest) === false && !/^[a-zA-Z]:/.test(rest)) {
    // POSIX absolute path: restore the leading slash.
    return '/' + rest;
  }
  if (/^[a-zA-Z]:/.test(rest)) {
    // Windows: normalize separators and drive-letter case.
    return rest.charAt(0).toUpperCase() + rest.slice(1).replace(/\//g, '\\');
  }
  return '/' + rest;
}

/** True when two LSP uri strings point at the same file (case-insensitive on Windows). */
export function sameUri(a, b) {
  const pa = uriToPath(a);
  const pb = uriToPath(b);
  if (pa === null || pb === null) return String(a) === String(b);
  const win = /^[a-zA-Z]:/.test(pa);
  return win ? pa.toLowerCase() === pb.toLowerCase() : pa === pb;
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 over a WebSocket (one message per frame)
// ---------------------------------------------------------------------------
export class WsJsonRpc {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map(); // id -> {resolve, reject}
    this.requestHandlers = new Map(); // method -> (params) => Promise|result
    this.notificationHandlers = new Map(); // method -> (params) => void
    this.onDropped = null;
    this.onClosed = null;
    this.disposed = false;
    socket.addEventListener('message', (event) => this._onData(String(event.data)));
    socket.addEventListener('close', () => {
      const err = { code: -32000, message: 'connection closed' };
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      if (!this.disposed && this.onClosed) this.onClosed();
    });
  }

  _post(msg) {
    if (this.socket.readyState !== 1 /* OPEN */ || this.disposed) return;
    this.socket.send(JSON.stringify(msg));
  }

  _onData(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      if (this.onDropped) this.onDropped(raw);
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const isResponse = msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined);
    if (isResponse) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(msg.error);
      else p.resolve(msg.result);
      return;
    }
    if (msg.id !== undefined && msg.method) {
      // Server-initiated request: answer what we honestly support, null otherwise.
      const handler = this.requestHandlers.get(msg.method);
      Promise.resolve()
        .then(() => (handler ? handler(msg.params) : null))
        .then(
          (result) => this._post({ jsonrpc: '2.0', id: msg.id, result: result === undefined ? null : result }),
          () => this._post({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'internal error' } }),
        );
      return;
    }
    if (msg.method) {
      const handler = this.notificationHandlers.get(msg.method);
      if (handler) {
        try {
          handler(msg.params);
        } catch {
          /* a broken sink must not kill the stream */
        }
      }
    }
  }

  request(method, params, timeoutMs = 12000) {
    if (this.disposed) return Promise.reject({ code: -32000, message: 'disposed' });
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject({ code: -32001, message: `${method} timed out` });
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this._post({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) {
    this._post({ jsonrpc: '2.0', method, params });
  }

  onRequest(method, handler) {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method, handler) {
    this.notificationHandlers.set(method, handler);
  }

  dispose() {
    this.disposed = true;
    for (const { reject } of this.pending.values()) reject({ code: -32000, message: 'disposed' });
    this.pending.clear();
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
  }
}

// ---------------------------------------------------------------------------
// LSP <-> Monaco conversions
// ---------------------------------------------------------------------------
const lspPos = (p) => ({ line: p.lineNumber - 1, character: p.column - 1 });

function monacoRange(monaco, range) {
  if (!range || !range.start || !range.end) return null;
  return new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);
}

/** Monaco CompletionItemKind enum starts at 0; the LSP protocol starts at 1. */
function completionKind(monaco, lspKind) {
  const k = Number(lspKind);
  if (!Number.isFinite(k) || k < 1) return monaco.languages.CompletionItemKind.Text;
  return Math.min(k - 1, monaco.languages.CompletionItemKind.TypeParameter);
}

/** Monaco SymbolKind also sits one below the LSP SymbolKind values. */
function symbolKind(monaco, lspKind) {
  const k = Number(lspKind);
  if (!Number.isFinite(k) || k < 1) return monaco.languages.SymbolKind.File;
  return Math.min(k - 1, monaco.languages.SymbolKind.TypeParameter);
}

function markerSeverity(monaco, sev) {
  switch (Number(sev)) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Error;
  }
}

/** Flatten an LSP MarkupContent / MarkedString / string to markdown text. */
function toMarkdown(contents) {
  if (contents == null) return null;
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents.map((c) => toMarkdown(c)).filter(Boolean).join('\n\n');
  }
  if (typeof contents === 'object') {
    if (typeof contents.value === 'string') return contents.value;
    if (contents.contents !== undefined) return toMarkdown(contents.contents);
  }
  return null;
}

/** Best-effort de-snippet: we declared snippetSupport:false, but be defensive. */
function plainInsertText(text) {
  if (typeof text !== 'string') return null;
  return text
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d*\}/g, '')
    .replace(/\\\$/g, '$');
}

const wordRangeAt = (monaco, model, position) => {
  const word = model.getWordUntilPosition(position);
  return new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
};

// Capabilities we genuinely implement — mirrors LSP_WIRED_FEATURES in the
// registry. Declaring nothing here means the server never claims more than
// this client maps.
const CLIENT_CAPABILITIES = Object.freeze({
  textDocument: {
    synchronization: { dynamicRegistration: false, didSave: true },
    completion: {
      dynamicRegistration: false,
      contextSupport: true,
      completionItem: {
        snippetSupport: false,
        documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true,
        preselectSupport: true,
      },
      completionItemKind: { valueSet: Array.from({ length: 25 }, (_, i) => i + 1) },
    },
    hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      dynamicRegistration: false,
      signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelSupport: true } },
    },
    definition: { dynamicRegistration: false, linkSupport: false },
    references: { dynamicRegistration: false },
    documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: false },
    formatting: { dynamicRegistration: false },
    rangeFormatting: { dynamicRegistration: false },
    publishDiagnostics: { versionSupport: true },
  },
  workspace: {
    didChangeConfiguration: { dynamicRegistration: false },
    didChangeWatchedFiles: { dynamicRegistration: false },
    workspaceFolders: true,
    // JDT.LS asks for `java.*` settings through this request; answering with
    // nulls is what leaves `java.home` (and therefore every `java.*` import)
    // unset, so the settings below are what we genuinely return.
    configuration: true,
  },
});

const TRIGGER_CHARACTERS = ['.', '(', ',', '"', "'", '<', '@', ':', '/', '#'];

/** `language/status` types (JDT.LS) mapped onto the Output panel's kinds. */
const STATUS_TYPES = { Starting: 'info', Started: 'ok', Stopped: 'muted', Warning: 'err', Error: 'fail', ProjectStatus: 'info' };

/** LSP `MessageType` (1 Error … 4 Log) mapped onto the same kinds. */
const MESSAGE_TYPES = { 1: 'fail', 2: 'err', 3: 'info', 4: 'muted' };

/**
 * Credential-shaped values never belong in a log the user can read or copy:
 * a language server can echo its own environment/settings into its output.
 */
const SECRET_VALUE_RE =
  /\b([a-z0-9_-]*(?:token|password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization|credential|client[_-]?secret)[a-z0-9_-]*)(\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;{}]+)/gi;

export function redactSecrets(text) {
  return String(text || '').replace(SECRET_VALUE_RE, '$1$2[redacted]');
}

// ---------------------------------------------------------------------------
// Java client settings (the honest offline story)
// ---------------------------------------------------------------------------
/** Files whose change means the Java project model must be re-read. */
const JAVA_BUILD_DESCRIPTORS = /(^|[\\/])(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|module-info\.java)$/i;

export function isJavaBuildDescriptor(fsPath) {
  return JAVA_BUILD_DESCRIPTORS.test(String(fsPath || ''));
}

/**
 * Settings handed to JDT.LS, both in `initialize` and in
 * `workspace/didChangeConfiguration`.
 *
 * - `java.home` is the point of the whole object: it is the JDK the server runs
 *   on, and the one its `java.util` / `java.time` resolves from.
 * - Maven/Gradle offline is forced ON, so a dependency change never causes a
 *   silent download; already-cached artifacts still resolve.
 * - `updateBuildConfiguration: 'interactive'` keeps the server asking instead
 *   of re-importing behind the user's back (we surface every such request).
 * - Sources/javadoc downloads and telemetry are off: no surprise traffic.
 * - `standalone` (a plain .java file with no pom/gradle marker) is the normal
 *   supported mode; third-party libraries simply are not available there, and
 *   the server says so through its own diagnostics rather than us hiding them.
 */
export function javaSettings({ jdkHome = null, standalone = false } = {}) {
  const java = {
    home: jdkHome || undefined,
    homeSource: jdkHome ? 'setting' : 'auto',
    import: {
      maven: { enabled: true, offline: true, importableSources: [] },
      gradle: { enabled: true, offline: true, wrapperEnabled: true },
      exclusions: ['**/node_modules/**', '**/.git/**'],
      generators: { enabled: false },
    },
    configuration: {
      updateBuildConfiguration: 'interactive',
      maven: { lifecycleMappingDisabled: false },
    },
    maven: { downloadSources: false, downloadJavadoc: false },
    referencesCodeLens: { enabled: false },
    inlayHints: { parameterNames: { enabled: 'none' } },
    trace: { server: 'off' },
    nullAnalysis: { nonNullAnnotation: null },
    maxCompletionResults: 300,
    completion: { favoriteStaticMembers: [], importMethod: 'auto', enabled: { postfix: false } },
    signatureHelp: { activationParameterTriggers: { enabled: false } },
    saveActions: { organizeImports: false },
    implementations: { include: 'source-only' },
    codeServer: { enabled: false },
    progressReports: { enabled: false },
    showOperationStatus: false,
  };
  if (standalone) {
    // No build tool involved: the file is compiled against the JDK platform.
    java.import.maven.enabled = false;
    java.import.gradle.enabled = false;
  }
  return { java };
}

/** Dotted lookup into a nested settings object; undefined when absent. */
export function resolveConfigSection(tree, section) {
  if (!section) return tree;
  let node = tree;
  for (const part of String(section).split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return node;
}

/** Answer one `workspace/configuration` batch from the client's settings tree. */
export function answerWorkspaceConfiguration(items, tree) {
  return (items || []).map((item) => {
    const value = item && item.section ? resolveConfigSection(tree, item.section) : tree;
    // A section this client genuinely does not carry stays null: the server then
    // uses its own default rather than being fed an invented empty object.
    return value === undefined ? null : value;
  });
}

/**
 * Which button to press for a server message request. The recommended refresh
 * is chosen (never "Never"/"Cancel": refusing to re-read a build file is how a
 * pom.xml edit appears ignored), and the choice is reported to the user because
 * it is the server acting on the project. Offline mode is already forced, so a
 * refresh resolves from the local cache and cannot quietly download.
 */
export function pickMessageRequestAction(actions) {
  const list = Array.isArray(actions) ? actions.filter((a) => a && a.title) : [];
  if (!list.length) return null;
  const avoid = /never|cancel|dismiss|don'?t|disable/i;
  const prefer = /update|reload|refresh|sync|yes/i;
  return list.find((a) => prefer.test(a.title) && !avoid.test(a.title)) || list.find((a) => !avoid.test(a.title)) || list[0];
}

// ---------------------------------------------------------------------------
// Session: start bridge -> connect -> handshake -> providers -> dispose
// ---------------------------------------------------------------------------
/** The one attached session (the editor attaches a single document at a time). */
let activeSession = null;

/**
 * Tell the attached server that files changed on disk. This is what makes a
 * saved `pom.xml` / `build.gradle` actually re-import instead of sitting stale
 * until restart. Returns false when nothing is listening (web mode, no tool).
 */
export function notifyLspFilesChanged(paths, changeType = 2 /* Changed */) {
  return Boolean(activeSession && activeSession.notifyFileChanges && activeSession.notifyFileChanges(paths, changeType));
}

/**
 * Attach a language-server session to one editor model.
 *
 * @param opts {{
 *   monaco, editor, model, language, docPath, root, toolPath, jdkPath, reprobe,
 *   onState: (state: 'starting'|'ready'|'missing-tool'|'error'|'idle') => void,
 *   onServerMessage?: (m: {language: string, kind: string, text: string, outputKind: string}) => void,
 *   lookupModelUri?: (uriString: string) => object|null  // map file URIs to open models
 * }}
 * @returns {Promise<object>} `{ connected, reason?, detail?, dispose(), notifyFileChanges() }`
 */
export async function attachLspSession(opts) {
  const { monaco, editor, model, language, docPath, root, toolPath, jdkPath, reprobe, onState, onServerMessage, lookupModelUri } = opts;
  const noop = { connected: false, dispose: async () => {} };

  // Only real on-disk files get an LSP session; untitled buffers keep the
  // current basic experience (honest, and matches how the run flow works).
  if (!model || !docPath || /^untitled:/i.test(docPath)) {
    return { ...noop, reason: 'not-a-file' };
  }
  const uri = pathToUri(docPath);
  const languageId = language; // descriptor keys are Monaco ids (python, c, cpp, java)
  const isJava = languageId === 'java';
  // 'standalone' = the caller checked the workspace and found no pom.xml /
  // build.gradle anywhere above this file. Anything else (including 'auto')
  // keeps Maven/Gradle import enabled, because guessing "standalone" wrongly
  // is exactly what would break a real project's dependencies.
  const standaloneJava = isJava && opts.javaProjectMode === 'standalone';

  onState?.('starting');
  const started = await lspStart({ language, root, toolPath, jdkPath, reprobe });
  if (!started?.ok) {
    const code = started?.code || 'ERROR';
    if (code === 'MISSING_TOOL') onState?.('missing-tool');
    else if (code === 'UNSUPPORTED_LANGUAGE') onState?.('idle');
    else onState?.('error');
    return { ...noop, reason: code };
  }

  // Settings tree this session answers `workspace/configuration` with.
  const settings = isJava
    ? javaSettings({ jdkHome: started.jdkHome || null, standalone: standaloneJava })
    : {};

  let conn = null;
  let disposed = false;
  let failed = false; // report the terminal error state only once per session
  const disposables = [];
  let version = 1;
  let changeTimer = 0;

  const finishDispose = async () => {
    if (disposed) return;
    disposed = true;
    for (const d of disposables) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
    disposables.length = 0;
    try {
      monaco.editor.setModelMarkers(model, 'stackamit-lsp', []);
    } catch {
      /* ignore */
    }
    if (conn) {
      try {
        conn.notify('textDocument/didClose', { textDocument: { uri } });
        await Promise.race([conn.request('shutdown', null, 700), new Promise((r) => setTimeout(r, 700))]);
        conn.notify('exit', null);
      } catch {
        /* best effort */
      }
      conn.dispose();
    }
    if (activeSession && activeSession.dispose === finishDispose) activeSession = null;
  };

  // Connect the WebSocket.
  let socket;
  try {
    socket = new WebSocket(started.wsUrl);
  } catch (err) {
    onState?.('error');
    return { ...noop, reason: 'ws-failed' };
  }
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('open-timeout')), 8000);
      socket.addEventListener('open', () => {
        clearTimeout(t);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(t);
        reject(new Error('ws-error'));
      }, { once: true });
    });
  } catch {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    onState?.('error');
    return { ...noop, reason: 'ws-open-failed' };
  }

  conn = new WsJsonRpc(socket);
  conn.onClosed = () => {
    if (!disposed && !failed) {
      failed = true;
      onState?.('error');
      void finishDispose();
    }
  };

  // Server-initiated traffic we must answer to keep the protocol healthy.
  conn.onRequest('workspace/configuration', (params) => answerWorkspaceConfiguration(params?.items, settings));
  conn.onRequest('client/registerCapability', () => null); // declined: static only
  conn.onRequest('client/unregisterCapability', () => null);
  conn.onRequest('window/workDoneProgress/create', () => null);
  // The server's own voice. JDT.LS reports import/dependency problems here
  // ("Missing class files", "Failed to create Java session", Maven errors),
  // which the editor never sees because they are not diagnostics — showing
  // them is the difference between "imports are red" and "here is why".
  const relay = (kind) => (params) => {
    const text = String(params?.message || params?.text || '').trim();
    if (!text) return;
    onServerMessage?.({ language, kind, text: redactSecrets(text), outputKind: MESSAGE_TYPES[params?.type] || 'info' });
  };
  conn.onNotification('window/logMessage', relay('log'));
  conn.onNotification('window/showMessage', relay('message'));
  conn.onNotification('language/status', (params) => {
    const text = String(params?.message || '').trim();
    if (!text) return;
    onServerMessage?.({ language, kind: 'status', outputKind: STATUS_TYPES[params?.type] || 'info', text: redactSecrets(text) });
  });
  conn.onRequest('window/showMessageRequest', (params) => {
    const chosen = pickMessageRequestAction(params?.actions);
    if (chosen) {
      onServerMessage?.({
        language,
        kind: 'action',
        outputKind: 'info',
        text: `${redactSecrets(String(params?.message || ''))} — chose "${chosen.title}" (dependencies resolve from the local cache only; nothing is downloaded).`,
      });
    }
    return chosen || null;
  });
  conn.onNotification('textDocument/publishDiagnostics', (params) => {
    if (!params || !sameUri(params.uri, uri)) return;
    const markers = (params.diagnostics || []).map((d) => {
      const range = d.range ? monacoRange(monaco, d.range) : null;
      return {
        severity: markerSeverity(monaco, d.severity),
        message: d.message || '',
        startLineNumber: range ? range.startLineNumber : 1,
        startColumn: range ? range.startColumn : 1,
        endLineNumber: range ? range.endLineNumber : 1,
        endColumn: range ? range.endColumn : 2,
        code: d.code !== undefined && d.code !== null ? String(d.code) : undefined,
        source: d.source || started.tool || 'lsp',
      };
    });
    try {
      monaco.editor.setModelMarkers(model, 'stackamit-lsp', markers);
    } catch {
      /* model may be gone */
    }
  });

  // Initialize handshake.
  const rootUri = root ? pathToUri(root) : null;
  let initResult;
  try {
    initResult = await conn.request(
      'initialize',
      {
        processId: null,
        clientInfo: { name: 'StackAmit-IDE' },
        locale: 'en',
        rootUri,
        workspaceFolders: rootUri ? [{ uri: rootUri, name: String(root).split(/[\\/]/).pop() || 'workspace' }] : null,
        capabilities: CLIENT_CAPABILITIES,
        initializationOptions: isJava ? { settings } : {},
      },
      25000,
    );
  } catch (err) {
    if (!failed) {
      failed = true;
      onState?.('error');
    }
    await finishDispose();
    return { ...noop, reason: 'initialize-failed', detail: err?.message || String(err) };
  }
  conn.notify('initialized', {});
  if (isJava) {
    // Some servers read settings only from the notification path; sending the
    // same tree twice (harmless, idempotent) means `java.home` cannot be missed.
    conn.notify('workspace/didChangeConfiguration', { settings });
  }

  // Document sync (full text — simplest correct mode, servers accept it).
  conn.notify('textDocument/didOpen', {
    textDocument: { uri, languageId, version, text: model.getValue() },
  });
  disposables.push(
    model.onDidChangeContent(() => {
      clearTimeout(changeTimer);
      changeTimer = setTimeout(() => {
        if (disposed) return;
        version += 1;
        conn?.notify('textDocument/didChange', {
          textDocument: { uri, version },
          contentChanges: [{ text: model.getValue() }],
        });
      }, 200);
    }),
  );

  // Conflict control: while a real server answers completions, turn off
  // word-based suggestions for this editor (they were the only duplicate).
  let previousWordBased = 'currentLanguage';
  try {
    previousWordBased = editor.getOptions()?.wordBasedSuggestions ?? 'currentLanguage';
  } catch {
    /* keep default */
  }
  editor.updateOptions({ wordBasedSuggestions: 'off' });
  disposables.push({
    dispose: () => {
      try {
        editor.updateOptions({ wordBasedSuggestions: previousWordBased || 'currentLanguage' });
      } catch {
        /* editor may be gone */
      }
    },
  });

  // ---- provider registrations (scoped: only answer for OUR model) ----
  const forUs = (m) => m && m.uri.toString() === model.uri.toString();
  const doc = { textDocument: { uri } };
  const safe = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch {
      return null; // a dead/slow server never breaks the editor
    }
  };

  disposables.push(
    monaco.languages.registerCompletionItemProvider(languageId, {
      triggerCharacters: TRIGGER_CHARACTERS,
      provideCompletionItems: safe(async (m, position, context) => {
        if (!forUs(m) || disposed || !conn) return null;
        const prevChar = context?.triggerKind === 2 ? context.triggerCharacter : undefined;
        const res = await conn.request('textDocument/completion', {
          textDocument: doc,
          position: lspPos(position),
          context: prevChar ? { triggerKind: 2, triggerCharacter: prevChar } : { triggerKind: 1 },
        });
        const items = Array.isArray(res) ? res : res?.items || [];
        const suggestions = [];
        for (const item of items) {
          if (!item || !item.label) continue;
          let insertText = item.textEdit?.newText ?? item.insertText ?? item.label;
          if (item.insertTextFormat === 2) insertText = plainInsertText(insertText) ?? item.label;
          if (!insertText) continue;
          const label = typeof item.label === 'string' ? item.label : item.label.label;
          const editRange = item.textEdit?.range ? monacoRange(monaco, item.textEdit.range) : null;
          suggestions.push({
            label,
            kind: completionKind(monaco, item.kind),
            insertText,
            range: editRange ? model.validateRange(editRange) : wordRangeAt(monaco, model, position),
            detail: typeof item.detail === 'string' ? item.detail : undefined,
            documentation: toMarkdown(item.documentation)
              ? { value: toMarkdown(item.documentation) }
              : undefined,
            sortText: item.sortText,
            filterText: typeof item.filterText === 'string' ? item.filterText : undefined,
          });
        }
        return { suggestions, incomplete: Boolean(res && !Array.isArray(res) && res.isIncomplete) };
      }),
    }),
  );

  disposables.push(
    monaco.languages.registerHoverProvider(languageId, {
      provideHover: safe(async (m, position) => {
        if (!forUs(m) || disposed || !conn) return null;
        const res = await conn.request('textDocument/hover', { textDocument: doc, position: lspPos(position) });
        if (!res) return null;
        const value = toMarkdown(res.contents ?? res);
        if (!value) return null;
        const range = res.range ? monacoRange(monaco, res.range) : null;
        return { range: range || wordRangeAt(monaco, model, position), contents: [{ value }] };
      }),
    }),
  );

  disposables.push(
    monaco.languages.registerSignatureHelpProvider(languageId, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: safe(async (m, position) => {
        if (!forUs(m) || disposed || !conn) return null;
        const res = await conn.request('textDocument/signatureHelp', { textDocument: doc, position: lspPos(position) });
        if (!res || !Array.isArray(res.signatures)) return null;
        const signatures = res.signatures.map((s) => ({
          label: s.label || '',
          documentation: toMarkdown(s.documentation) ? { value: toMarkdown(s.documentation), isTrusted: false } : undefined,
          parameters: (s.parameters || []).map((p) => ({
            label: typeof p.label === 'string' ? p.label : s.label ? s.label.substring(p.label[0], p.label[1]) : '',
            documentation: toMarkdown(p.documentation) ? { value: toMarkdown(p.documentation), isTrusted: false } : undefined,
          })),
        }));
        return {
          value: {
            signatures,
            activeSignature: Math.max(0, Math.min(res.activeSignature || 0, signatures.length - 1)),
            activeParameter: Math.max(0, res.activeParameter || 0),
          },
          dispose: () => {},
        };
      }),
    }),
  );

  const mapLocations = (res) => {
    const list = Array.isArray(res) ? res : res ? [res] : [];
    const out = [];
    for (const loc of list) {
      if (!loc) continue;
      const targetUri = loc.uri || loc.target?.uri || loc.location?.uri;
      const range = loc.range || loc.target?.range || loc.location?.range;
      if (!targetUri || !range) continue;
      if (sameUri(targetUri, uri)) {
        out.push({ uri: model.uri, range: model.validateRange(monacoRange(monaco, range)) });
        continue;
      }
      const known = lookupModelUri ? lookupModelUri(targetUri) : null;
      if (known) out.push({ uri: known.uri || known, range: monacoRange(monaco, range) });
      // Locations in files with no open model are dropped rather than shown
      // as broken empty editors — honest partial navigation, never a fake.
    }
    return out;
  };

  disposables.push(
    monaco.languages.registerDefinitionProvider(languageId, {
      provideDefinition: safe(async (m, position) => {
        if (!forUs(m) || disposed || !conn) return null;
        const res = await conn.request('textDocument/definition', { textDocument: doc, position: lspPos(position) });
        const list = mapLocations(res);
        return list.length ? list : null;
      }),
    }),
  );

  disposables.push(
    monaco.languages.registerReferenceProvider(languageId, {
      provideReferences: safe(async (m, position) => {
        if (!forUs(m) || disposed || !conn) return null;
        const res = await conn.request('textDocument/references', {
          textDocument: doc,
          position: lspPos(position),
          context: { includeDeclaration: true },
        });
        const list = mapLocations(res);
        return list.length ? list : null;
      }),
    }),
  );

  disposables.push(
    monaco.languages.registerDocumentSymbolProvider(languageId, {
      provideDocumentSymbols: safe(async (m) => {
        if (!forUs(m) || disposed || !conn) return null;
        const res = await conn.request('textDocument/documentSymbol', { textDocument: doc });
        if (!Array.isArray(res)) return null;
        return res
          .filter((s) => s && s.name && s.location)
          .map((s) => {
            const locUri = s.location.uri;
            const isOurs = sameUri(locUri, uri);
            const known = !isOurs && lookupModelUri ? lookupModelUri(locUri) : null;
            if (!isOurs && !known) return null;
            return {
              name: s.name,
              detail: s.detail || (s.containerName ? s.containerName : ''),
              kind: symbolKind(monaco, s.kind),
              range: model.validateRange(monacoRange(monaco, s.location.range)),
              selectionRange: model.validateRange(monacoRange(monaco, s.location.range)),
              children: [],
            };
          })
          .filter(Boolean);
      }),
    }),
  );

  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider(languageId, {
      provideDocumentFormattingEdits: safe(async (m, options) => {
        if (!forUs(m) || disposed || !conn) return null;
        const res = await conn.request('textDocument/formatting', {
          textDocument: doc,
          options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
        });
        if (!Array.isArray(res) || !res.length) return null;
        return res
          .filter((e) => e && e.range && typeof e.newText === 'string')
          .map((e) => ({ range: model.validateRange(monacoRange(monaco, e.range)), text: e.newText }));
      }),
    }),
  );

  onState?.('ready');
  const session = {
    connected: true,
    language,
    dispose: finishDispose,
    /** `paths` are absolute fs paths; `type` is LSP FileChangeType (1/2/3). */
    notifyFileChanges: (paths, type = 2) => {
      if (disposed || !conn) return false;
      const changes = (Array.isArray(paths) ? paths : [paths])
        .filter((p) => typeof p === 'string' && p && !/^untitled:/i.test(p))
        .map((p) => ({ type, uri: pathToUri(p) }));
      if (!changes.length) return false;
      conn.notify('workspace/didChangeWatchedFiles', { changes });
      return true;
    },
  };
  activeSession = session;
  return session;
}
