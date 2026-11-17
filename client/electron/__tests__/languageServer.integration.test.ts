import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

/**
 * Opt-in live integration test: a REAL pyright-langserver over the real
 * main-process bridge, speaking real LSP over the loopback WebSocket.
 *
 * Skipped unless RUN_INTEGRATION=1 (mirrors the repo's live-test convention),
 * and additionally skipped when no pyright binary is present. Nothing here is
 * downloaded or installed — it only exercises a tool that already exists on
 * this machine (the locally npm-installed pyright).
 *
 * The Java half follows the same rule with one addition: Eclipse JDT.LS is a
 * tarball the app never bundles, so when no install is found the suite reports
 * itself BLOCKED (and verifies that the app says the same thing honestly)
 * instead of pretending the server was tested.
 */
const PYRIGHT_CMD = path.resolve(process.cwd(), 'node_modules', '.bin', 'pyright-langserver.cmd');
const LIVE = process.env.RUN_INTEGRATION === '1' && fs.existsSync(PYRIGHT_CMD);

import { findJdk, jdkCandidateHomes, isJdkHome } from '../services/runtimeProbe';
import {
  LS_DESCRIPTORS,
  findEclipseLayout,
  start,
  stop,
  status,
  activeBridges,
  disposeAll,
} from '../services/languageServer';
import { addAuthorizedRoot, clearAuthorizedRoots } from '../services/workspaceFs';

/** An Eclipse JDT.LS distribution already on this machine, if any. */
function locateJdtlsInstall(): string | null {
  const hints = [process.env.JDTLS_HOME, process.env.JDTLS_PATH, path.resolve(process.cwd(), 'jdtls'), path.join(os.homedir(), 'jdtls')].filter(
    (v): v is string => Boolean(v),
  );
  for (const hint of hints) {
    const layout = findEclipseLayout(hint);
    if (layout) return layout.home;
  }
  return null;
}

const JDTLS_HOME = locateJdtlsInstall();
const JAVA_LIVE = process.env.RUN_INTEGRATION === '1' && Boolean(JDTLS_HOME);
console.log(
  JDTLS_HOME
    ? `[languageServer.integration] JDT.LS install found at ${JDTLS_HOME}${JAVA_LIVE ? ' — live Java suite ENABLED' : ' — live Java suite needs RUN_INTEGRATION=1'}`
    : '[languageServer.integration] BLOCKED: no Eclipse JDT.LS install on this machine (JDTLS_HOME unset) — the live Java suite cannot run',
);

let tempRoot: string | null = null;
afterEach(() => {
  disposeAll();
  clearAuthorizedRoots();
  if (tempRoot) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    tempRoot = null;
  }
});

function toUri(fsPath: string): string {
  let s = fsPath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(s)) s = '/' + s;
  return 'file://' + s.split('/').map(encodeURIComponent).join('/').replace('%3A', ':');
}

/** Minimal JSON-RPC over the ws (one message per frame), test-side only. */
function rpc(socket: WebSocket) {
  let nextId = 1;
  const pending = new Map<number, (v: any) => void>();
  const notifications: { method: string; params: any }[] = [];
  socket.on('message', (data) => {
    if (process.env.LSP_DEBUG) console.log('WS_MSG', String(data).slice(0, 100));
    const msg = JSON.parse(String(data));
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      notifications.push({ method: msg.method, params: msg.params });
    }
  });
  const request = (method: string, params: any, timeoutMs = 20000) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      const t = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(t);
        resolve(msg);
      });
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  const notify = (method: string, params: any) => socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  const waitForNotification = (method: string, timeoutMs: number) =>
    new Promise<any>((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const hit = notifications.find((n) => n.method === method);
        if (hit) {
          clearInterval(iv);
          resolve(hit.params);
        } else if (Date.now() > t0 + timeoutMs) {
          clearInterval(iv);
          reject(new Error(`no ${method} within ${timeoutMs}ms`));
        }
      }, 100);
    });
  return { request, notify, waitForNotification };
}

describe.skipIf(!LIVE)('live Pyright over the loopback bridge (RUN_INTEGRATION=1)', () => {
  it('spawns pyright-langserver, initializes, and reports real diagnostics + completions', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-live-'));
    const file = path.join(tempRoot, 'main.py');
    fs.writeFileSync(file, 'pri = 1\nprint(undefined_name_xyz)\n', 'utf8');
    addAuthorizedRoot(tempRoot);

    const started = await start({ language: 'python', root: tempRoot, toolPath: PYRIGHT_CMD });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    if (!started.ok) return;
    expect(started.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/lsp$/);
    expect(started.tool).toBe('pyright-langserver');

    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(started.wsUrl, { headers: { Origin: 'file://' } });
      s.once('open', () => resolve(s));
      s.once('error', reject);
      s.on('close', (code, reason) => {
        if (process.env.LSP_DEBUG) console.log('WS_CLOSE', code, String(reason));
      });
      setTimeout(() => reject(new Error('bridge ws open timeout')), 10000);
    });
    const rpcc = rpc(socket);

    const init = await rpcc.request('initialize', {
      processId: null,
      rootUri: toUri(tempRoot),
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          completion: { contextSupport: true, completionItem: { snippetSupport: false } },
          publishDiagnostics: { versionSupport: true },
        },
      },
      workspaceFolders: [{ uri: toUri(tempRoot), name: 'live' }],
    }, 30000);
    expect(init.error).toBeUndefined();
    const caps = init.result?.capabilities || {};
    expect(caps.completionProvider).toBeTruthy();
    expect(caps.definitionProvider || caps.typeDefinitionProvider).toBeTruthy();

    rpcc.notify('initialized', {});
    const uri = toUri(file);
    rpcc.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'python', version: 1, text: 'pri = 1\nprint(undefined_name_xyz)\n' },
    });

    // Diagnostics: pyright really flags the undefined name. (Pyright echoes
    // the encoded drive colon `c%3A`; both forms denote the same file.)
    const diag = await rpcc.waitForNotification('textDocument/publishDiagnostics', 30000);
    expect(decodeURIComponent(diag.uri).toLowerCase()).toBe(uri.toLowerCase());
    expect(Array.isArray(diag.diagnostics)).toBe(true);
    expect(diag.diagnostics.some((d: any) => /undefined_name_xyz|not defined|not resolved/i.test(d.message || ''))).toBe(true);

    // Completion: asking after "pri" yields real server suggestions.
    const comp = await rpcc.request('textDocument/completion', {
      textDocument: { uri },
      position: { line: 0, character: 3 },
      context: { triggerKind: 1 },
    });
    const items = Array.isArray(comp.result) ? comp.result : comp.result?.items || [];
    expect(items.length).toBeGreaterThan(0);

    // Hover on the builtin print.
    const hover = await rpcc.request('textDocument/hover', {
      textDocument: { uri },
      position: { line: 1, character: 2 },
    });
    expect(hover.error).toBeUndefined(); // answerable even when there's nothing to show

    rpcc.notify('textDocument/didClose', { textDocument: { uri } });
    await rpcc.request('shutdown', null, 5000);
    rpcc.notify('exit', null);
    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      setTimeout(resolve, 3000);
    });

    const stopped = await stop({ language: 'python', root: tempRoot });
    expect(stopped).toMatchObject({ ok: true });
    expect(activeBridges()).toHaveLength(0);
  }, 90000);
});

// ---------------------------------------------------------------------------
// Java / Eclipse JDT.LS
// ---------------------------------------------------------------------------

/** The exact snippet from the bug report (standard library only). */
const JAVA_STDLIB_EXAMPLE = `import java.util.ArrayList;
import java.util.List;
import java.time.LocalDate;

public class Main {
    public static void main(String[] args) {
        List<String> names = new ArrayList<>();
        names.add("Amit");
        System.out.println(names);
        System.out.println(LocalDate.now());
    }
}
`;

/** A third-party library that is genuinely not on the classpath. */
const JAVA_MISSING_DEP = `import org.apache.commons.lang3.StringUtils;

public class Missing {
    public static void main(String[] args) {
        System.out.println(StringUtils.join(new String[]{"a"}, "-"));
    }
}
`;

/** Answer the server's own requests the way the renderer does (offline import). */
function serveClientRequests(socket: WebSocket, jdkHome: string) {
  const settings = {
    java: {
      home: jdkHome,
      import: { maven: { enabled: true, offline: true }, gradle: { enabled: true, offline: true } },
      configuration: { updateBuildConfiguration: 'interactive' },
      maven: { downloadSources: false, downloadJavadoc: false },
    },
  };
  socket.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id === undefined || !msg.method) return;
    if (msg.method === 'workspace/configuration') {
      const items = msg.params?.items || [];
      const answer = items.map((item: any) => (item?.section ? item.section.split('.').reduce((n: any, k: string) => (n ? n[k] : undefined), settings) : settings));
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: answer }));
    } else if (msg.method === 'window/showMessageRequest') {
      const actions = msg.params?.actions || [];
      const chosen = actions.find((a: any) => /update|reload|refresh|yes/i.test(a.title || '')) || null;
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: chosen }));
    } else {
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null }));
    }
  });
}

/** Collect every publishDiagnostics for one file until it settles. */
function diagnosticsCollector(socket: WebSocket, uri: string) {
  const rounds: any[][] = [];
  socket.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.method === 'textDocument/publishDiagnostics' && decodeURIComponent(String(msg.params?.uri || '')).toLowerCase() === uri.toLowerCase()) {
      rounds.push(msg.params?.diagnostics || []);
    }
  });
  return {
    rounds,
    latest: () => rounds[rounds.length - 1] || [],
    async settle(stableMs = 8000, overallMs = 90000) {
      const t0 = Date.now();
      let lastChange = Date.now();
      let seen = 0;
      while (Date.now() - t0 < overallMs) {
        await new Promise((r) => setTimeout(r, 200));
        if (rounds.length !== seen) {
          seen = rounds.length;
          lastChange = Date.now();
        } else if (seen > 0 && Date.now() - lastChange > stableMs) {
          return;
        }
      }
    },
  };
}

describe.runIf(JAVA_LIVE)(`live Eclipse JDT.LS from ${JDTLS_HOME || ''} (RUN_INTEGRATION=1)`, () => {
  it('runs on a real JDK and leaves the reported standard-library imports clean', async () => {
    const jdk = await findJdk({ minMajor: LS_DESCRIPTORS.java.jdk!.minMajor });
    expect(jdk, 'JDT.LS needs a JDK 17+; none is installed here').toBeTruthy();
    if (!jdk || !JDTLS_HOME) return;

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-live-java-'));
    const file = path.join(tempRoot, 'Main.java');
    fs.writeFileSync(file, JAVA_STDLIB_EXAMPLE, 'utf8');
    addAuthorizedRoot(tempRoot);

    const started = await start({ language: 'java', root: tempRoot, toolPath: JDTLS_HOME, storageRoot: tempRoot });
    expect(started.ok, JSON.stringify(started)).toBe(true);
    if (!started.ok) return;
    // The bridge must report the JDK it actually launched the server on.
    expect(started.jdkHome).toBe(jdk.home);

    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(started.wsUrl, { headers: { Origin: 'file://' } });
      s.once('open', () => resolve(s));
      s.once('error', reject);
      setTimeout(() => reject(new Error('bridge ws open timeout')), 10000);
    });
    serveClientRequests(socket, jdk.home);
    const rpcc = rpc(socket);
    const init = await rpcc.request(
      'initialize',
      {
        processId: null,
        rootUri: toUri(tempRoot),
        capabilities: {
          workspace: { configuration: true, didChangeConfiguration: {}, didChangeWatchedFiles: {}, workspaceFolders: true },
          textDocument: { synchronization: { didSave: true }, completion: {}, hover: {}, publishDiagnostics: {} },
        },
        workspaceFolders: [{ uri: toUri(tempRoot), name: 'java-live' }],
        initializationOptions: { settings: { java: { home: jdk.home } } },
      },
      60000,
    );
    expect(init.error).toBeUndefined();
    expect(init.result?.capabilities?.completionProvider).toBeTruthy();
    rpcc.notify('initialized', {});

    const uri = toUri(file);
    const collector = diagnosticsCollector(socket, uri);
    rpcc.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'java', version: 1, text: JAVA_STDLIB_EXAMPLE } });
    await collector.settle();

    const st = await status({ language: 'java', root: tempRoot });
    if (st.ok && st.state !== 'running') console.log('[java live] status', st.state, (st as any).logTail);

    // The bug: java.util/java.time were flagged. None of the final diagnostics
    // may be an error about a `java.*` import or an unresolvable JDK type.
    const offenders = collector
      .latest()
      .filter((d: any) => d.severity === 1 && /java\.(util|time|lang)|cannot be resolved|is not accessible|non-resolvable/i.test(d.message || ''));
    expect({ offenders, rounds: collector.rounds.length }).toEqual({ offenders: [], rounds: expect.any(Number) });

    // Completion and hover on standard-library symbols.
    const comp = await rpcc.request('textDocument/completion', { textDocument: { uri }, position: { line: 6, character: 40 } }, 30000);
    const items = Array.isArray(comp.result) ? comp.result : comp.result?.items || [];
    expect(items.length).toBeGreaterThan(0);
    const hover = await rpcc.request('textDocument/hover', { textDocument: { uri }, position: { line: 9, character: 30 } }, 30000);
    expect(hover.error).toBeUndefined();

    // A genuinely missing third-party library must still be reported.
    const bad = path.join(tempRoot, 'Missing.java');
    fs.writeFileSync(bad, JAVA_MISSING_DEP, 'utf8');
    const badUri = toUri(bad);
    const badCollector = diagnosticsCollector(socket, badUri);
    rpcc.notify('textDocument/didOpen', { textDocument: { uri: badUri, languageId: 'java', version: 1, text: JAVA_MISSING_DEP } });
    await badCollector.settle(6000, 40000);
    expect(badCollector.latest().some((d: any) => d.severity === 1 && /cannot be resolved|does not exist/i.test(d.message || ''))).toBe(true);

    rpcc.notify('textDocument/didClose', { textDocument: { uri } });
    await rpcc.request('shutdown', null, 10000);
    rpcc.notify('exit', null);
    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      setTimeout(resolve, 5000);
    });
    expect(await stop({ language: 'java', root: tempRoot })).toMatchObject({ ok: true });
    expect(activeBridges()).toHaveLength(0);
  }, 240000);
});

describe.runIf(!JDTLS_HOME)('JDT.LS is BLOCKED on this machine (no Eclipse JDT.LS install)', () => {
  it('refuses to start Java IntelliSense and says exactly how to fix it', async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-java-blocked-'));
    fs.writeFileSync(path.join(tempRoot, 'Main.java'), JAVA_STDLIB_EXAMPLE, 'utf8');
    addAuthorizedRoot(tempRoot);

    const started = await start({ language: 'java', root: tempRoot, storageRoot: tempRoot });
    expect(started.ok, 'the bridge must not claim Java IntelliSense works without a server').toBe(false);
    if (started.ok) return;
    expect(['MISSING_TOOL', 'INCOMPATIBLE']).toContain(started.code);
    // Actionable: the real acquisition route (or the JDK requirement), never a
    // generic "not found".
    expect(started.message.length).toBeGreaterThan(60);
    expect(started.message).toMatch(/download\.eclipse\.org\/jdtls|JDK 17\+|Custom JDK path|Eclipse\.Temurin-JDK/i);

    const jdk = await findJdk({ minMajor: 0 });
    console.log(
      `[java] BLOCKED reason=${started.code}; JDK discovered: ${jdk ? `${jdk.home} (${jdk.version}, major ${jdk.major})` : 'none'}; ` +
        `recognized Java homes: ${jdkCandidateHomes().filter(isJdkHome).length}`,
    );
    expect((await status({ language: 'java', root: tempRoot })) as any).toBeTruthy();
  }, 60000);

  it('keeps the Java descriptor honest about what it needs', () => {
    const d = LS_DESCRIPTORS.java;
    expect(d.eclipseLayout).toBe(true);
    expect(d.jdk?.minMajor).toBeGreaterThanOrEqual(17);
    expect(d.rootMarkers).toEqual(expect.arrayContaining(['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle']));
    expect(d.install.note).toMatch(/download\.eclipse\.org\/jdtls/);
  });
});
