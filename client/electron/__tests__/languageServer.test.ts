import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import WebSocket from 'ws';

/**
 * Deterministic unit tests for the main-process language-server bridge.
 * Discovery and spawn are injected fakes, so no real server ever starts here;
 * the loopback WebSocket, framing, lifecycle and crash logic are real.
 */
import {
  LS_DESCRIPTORS,
  resolveToolState,
  buildSpawn,
  childEnvironment,
  findEclipseLayout,
  jdtlsDataDir,
  planJdtlsLaunch,
  redactServerLog,
  start,
  stop,
  status,
  activeBridges,
  disposeAll,
  type LspDeps,
} from '../services/languageServer';
import { addAuthorizedRoot, clearAuthorizedRoots } from '../services/workspaceFs';
import type { JdkInfo, ToolDiscovery } from '../services/runtimeProbe';
import { mergePathDirs, pathSearchDirs, refreshPathFromRegistry } from '../services/runtimeProbe';

// ---------------------------------------------------------------------------
// Fake deps
// ---------------------------------------------------------------------------
type DiscoverMap = Record<string, Partial<ToolDiscovery>>;

/** A JDK 21 that does not exist on disk: discovery is faked, decisions are not. */
const FAKE_JDK: JdkInfo = {
  home: 'C:\\jdk-21.0.2',
  javaExe: 'C:\\jdk-21.0.2\\bin\\java.exe',
  version: '21.0.2',
  major: 21,
  source: 'JAVA_HOME',
};

function fakeDeps(
  discovery: DiscoverMap,
  opts: { jdk?: JdkInfo | null } = {},
): LspDeps & { spawns: { cmd: string; args: string[]; options: SpawnOptions; child: any }[] } {
  const spawns: { cmd: string; args: string[]; options: SpawnOptions; child: any }[] = [];
  const discover = async (cmd: string, o: { customPath?: string | null } = {}): Promise<ToolDiscovery> => {
    const over = o.customPath ? discovery[`${cmd}@custom`] : undefined;
    const d = over || discovery[cmd] || {};
    return {
      cmd,
      found: d.found ?? false,
      path: d.path ?? null,
      version: d.version ?? null,
      locatedButUnusable: d.locatedButUnusable ?? false,
    };
  };
  // Java servers need a JDK; tests decide it explicitly instead of inheriting
  // whatever this machine happens to have installed.
  const findJdk = async () => (opts.jdk === undefined ? FAKE_JDK : opts.jdk);
  const spawn = (cmd: string, args: string[], options: SpawnOptions): ChildProcess => {
    const child: any = new EventEmitter();
    child.pid = undefined; // keeps killTree() on the in-process child.kill path
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = { writes: [] as Buffer[], write(b: Buffer) { this.writes.push(Buffer.from(b)); return true; }, end() {} };
    child.kills = 0;
    child.kill = () => {
      child.kills += 1;
      setImmediate(() => child.emit('close', 0, null));
      return true;
    };
    spawns.push({ cmd, args, options, child });
    return child as ChildProcess;
  };
  return { discover, findJdk, spawn, spawns };
}

const OK_PYRIGHT: DiscoverMap = {
  'pyright-langserver': { found: true, path: 'C:\\tools\\pyright-langserver.cmd', version: 'pyright 1.1.414' },
};

const tempDirs: string[] = [];
function makeRoot(prefix = 'lsp-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function connectBridge(wsUrl: string, origin = 'file://'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl, { headers: { Origin: origin } });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
    setTimeout(() => reject(new Error('ws open timeout')), 3000);
  });
}

afterEach(() => {
  disposeAll();
  clearAuthorizedRoots();
  delete process.env.CANARY_SECRET;
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp noise must not fail a test */
    }
  }
});

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------
describe('LS_DESCRIPTORS', () => {
  it('covers exactly the wired Tier 1 languages with constant spawn data', () => {
    expect(Object.keys(LS_DESCRIPTORS).sort()).toEqual(['c', 'cpp', 'java', 'python'].sort());
    for (const [lang, d] of Object.entries(LS_DESCRIPTORS)) {
      expect(d.id, lang).toBeTruthy();
      expect(d.tool, lang).toBeTruthy();
      expect(Array.isArray(d.args), lang).toBe(true);
      for (const a of d.args) expect(typeof a).toBe('string');
      expect(Array.isArray(d.rootMarkers), lang).toBe(true);
      expect(d.features).toContain('completion');
      expect(typeof d.install.note, lang).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// resolveToolState — MISSING vs INCOMPATIBLE vs OK
// ---------------------------------------------------------------------------
describe('tool state resolution', () => {
  const py = LS_DESCRIPTORS.python;
  const java = LS_DESCRIPTORS.java;

  it('reports MISSING with an actionable install line', async () => {
    const deps = fakeDeps({});
    const st = await resolveToolState(py, null, deps);
    expect(st.state).toBe('missing');
    expect(st.state === 'missing' && st.message).toMatch(/npm install -g pyright/);
  });

  it('treats a located tool that does not answer --version as OK with unknown version', async () => {
    // pyright-langserver (and jdtls launchers) have no --version flag; that
    // alone must not be reported as a broken install. A truly broken binary
    // fails at launch and is handled honestly by the crash limit instead.
    const deps = fakeDeps({ 'pyright-langserver': { found: false, path: 'C:\\x\\pyright-langserver.cmd' } });
    const st = await resolveToolState(py, null, deps);
    expect(st.state).toBe('ok');
    expect(st.state === 'ok' && st.version).toBeNull();
  });

  it('reports INCOMPATIBLE below the minimum version', async () => {
    const deps = fakeDeps({ 'pyright-langserver': { found: true, path: 'C:\\x\\p.cmd', version: 'pyright 1.0.5' } });
    const st = await resolveToolState(py, null, deps);
    expect(st.state).toBe('incompatible');
    expect(st.state === 'incompatible' && st.message).toMatch(/1\.1\.0/);
  });

  it('reports OK for a current version and passes the discovered path through', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const st = await resolveToolState(py, null, deps);
    expect(st.state).toBe('ok');
    expect(st.state === 'ok' && st.path).toBe('C:\\tools\\pyright-langserver.cmd');
  });

  it('honors a user-configured absolute tool path', async () => {
    const deps = fakeDeps({
      'pyright-langserver': { found: false, path: null },
      'pyright-langserver@custom': { found: true, path: 'D:\\my tools\\pyright-langserver.cmd', version: 'pyright 1.1.400' },
    });
    const st = await resolveToolState(py, 'D:\\my tools\\pyright-langserver.cmd', deps);
    expect(st.state).toBe('ok');
  });

  it('reports a missing JDK as an actionable failure for JDT.LS', async () => {
    const deps = fakeDeps({ jdtls: { found: true, path: 'C:\\jdtls\\jdtls', version: '1.0' } }, { jdk: null });
    const st = await resolveToolState(java, null, deps);
    expect(st.state).toBe('missing');
    expect(st.state === 'missing' && st.message).toMatch(/JDK 17\+/);
    expect(st.state === 'missing' && st.message).toMatch(/winget install -e --id Microsoft\.OpenJDK\.21/);
  });

  it('names a JRE-only machine as its own incompatible state (the import-error bug)', async () => {
    // `java` is on PATH, no JDK anywhere: this used to start JDT.LS on the JRE,
    // which then flagged every java.util/java.time import as an error.
    const deps = fakeDeps(
      {
        jdtls: { found: true, path: 'C:\\jdtls\\jdtls', version: 'jdtls 1.40' },
        java: { found: true, path: 'C:\\Program Files\\Java\\jre-1.8\\bin\\java.exe', version: '"1.8.0_452"' },
      },
      { jdk: null },
    );
    const st = await resolveToolState(java, null, deps);
    expect(st.state).toBe('incompatible');
    expect(st.state === 'incompatible' && st.message).toMatch(/no full JDK/);
    expect(st.state === 'incompatible' && st.message).toMatch(/java\.\* import/);
  });

  it('converts legacy "1.8" java versions to major 8 and rejects them', async () => {
    const deps = fakeDeps(
      { jdtls: { found: true, path: 'C:\\jdtls\\jdtls', version: 'jdtls 1.40' } },
      { jdk: { ...FAKE_JDK, home: 'C:\\jdk-1.8', javaExe: 'C:\\jdk-1.8\\bin\\java.exe', version: '1.8.0_452', major: 8, source: 'scan' } },
    );
    const st = await resolveToolState(java, null, deps);
    expect(st.state).toBe('incompatible');
    expect(st.state === 'incompatible' && st.message).toMatch(/needs JDK 17\+/);
  });

  it('accepts JDT.LS on a JDK 17+ and carries the JDK through to the caller', async () => {
    const deps = fakeDeps({ jdtls: { found: true, path: 'C:\\jdtls\\jdtls', version: 'jdtls 1.40' } });
    const st = await resolveToolState(java, null, deps);
    expect(st.state).toBe('ok');
    expect(st.state === 'ok' && st.jdk?.home).toBe(FAKE_JDK.home);
  });

  it('passes a user-configured JDK path to discovery', async () => {
    const seen: (string | null | undefined)[] = [];
    const deps = fakeDeps({ jdtls: { found: true, path: 'C:\\jdtls\\jdtls' } });
    deps.findJdk = async (o) => {
      seen.push(o?.customPath);
      return FAKE_JDK;
    };
    await resolveToolState(java, null, deps, { jdkPath: 'D:\\tools\\jdk-21' });
    expect(seen).toEqual(['D:\\tools\\jdk-21']);
  });
});

// ---------------------------------------------------------------------------
// Java launch planning: Eclipse distribution layout + the java command line
// ---------------------------------------------------------------------------
describe('Eclipse JDT.LS launch planning', () => {
  function makeEclipseInstall(prefix = 'jdtls-'): string {
    const home = makeRoot(prefix);
    fs.mkdirSync(path.join(home, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(home, 'plugins', 'org.eclipse.equinox.launcher_1.6.400.v20240131-1022.jar'), '');
    fs.mkdirSync(path.join(home, 'config_win'), { recursive: true });
    fs.mkdirSync(path.join(home, 'config_linux'), { recursive: true });
    fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, 'bin', 'jdtls'), '#!/bin/sh');
    return home;
  }

  it('recognizes the distribution from its folder, launcher script or launcher jar', () => {
    const home = makeEclipseInstall();
    const jar = path.join(home, 'plugins', 'org.eclipse.equinox.launcher_1.6.400.v20240131-1022.jar');
    for (const target of [home, path.join(home, 'bin', 'jdtls'), jar]) {
      const layout = findEclipseLayout(target, 'win32');
      expect(layout, target).toBeTruthy();
      expect(layout?.launcherJar).toBe(jar);
      expect(layout?.configDir).toBe(path.join(home, 'config_win'));
    }
  });

  it('picks the platform config area and returns null for a folder that is not JDT.LS', () => {
    const home = makeEclipseInstall();
    expect(findEclipseLayout(home, 'linux')?.configDir).toBe(path.join(home, 'config_linux'));
    const elsewhere = makeRoot('not-jdtls-');
    expect(findEclipseLayout(elsewhere, 'win32')).toBeNull();
  });

  it('builds the java command line a real JDT.LS needs (module image, agent, -data)', () => {
    const home = makeEclipseInstall();
    const layout = findEclipseLayout(home, 'win32')!;
    const plan = planJdtlsLaunch({ jdk: FAKE_JDK, layout, dataDir: path.join(home, 'ws') });
    expect(plan.cmd).toBe(FAKE_JDK.javaExe); // never whatever `java` PATH points at
    const joined = plan.args.join(' ');
    expect(joined).toContain('-Declipse.application=org.eclipse.jdt.ls.core.id1');
    expect(joined).toContain('--add-modules=ALL-SYSTEM');
    expect(joined).toContain(`-javaagent:${layout.launcherJar}`);
    expect(plan.args[plan.args.indexOf('-jar') + 1]).toBe(layout.launcherJar);
    expect(plan.args[plan.args.indexOf('-configuration') + 1]).toBe(layout.configDir);
    expect(plan.args[plan.args.indexOf('-data') + 1]).toBe(path.join(home, 'ws'));
  });

  it('keeps one stable, safe data directory per project', () => {
    const storage = makeRoot('storage-');
    const a = jdtlsDataDir(storage, 'C:\\Users\\me\\My Projects\\demo');
    const b = jdtlsDataDir(storage, 'C:\\Users\\me\\My Projects\\demo');
    const c = jdtlsDataDir(storage, 'C:\\Users\\me\\My Projects\\other');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(path.basename(a)).toMatch(/^demo-[0-9a-f]{12}$/);
    const weird = path.basename(jdtlsDataDir(storage, 'C:\\x\\weird name <>|&"'));
    // Hostile/path-separator characters must be gone; the hash suffix keeps the
    // directory unique per project root, so exact underscore counts don't matter.
    expect(weird).not.toMatch(/[<>|&"*?:]/);
    expect(weird).toMatch(/-[0-9a-f]{12}$/);
  });

  it('start() plans the JDK launch, sets JAVA_HOME for the child and refuses a non-install path', async () => {
    const home = makeEclipseInstall();
    const storage = makeRoot('storage-');
    const root = makeRoot();
    addAuthorizedRoot(root);
    const deps = fakeDeps({ jdtls: { found: true, path: home } });
    const res = await start({ language: 'java', root, storageRoot: storage }, deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jdkHome).toBe(FAKE_JDK.home);

    const socket = await connectBridge(res.wsUrl);
    expect(deps.spawns).toHaveLength(1);
    const { cmd, args, options } = deps.spawns[0];
    expect(cmd).toBe(FAKE_JDK.javaExe);
    expect(args).toContain('-jar');
    const env = options.env as Record<string, string>;
    expect(env.JAVA_HOME).toBe(FAKE_JDK.home);
    expect(env.PATH.startsWith(path.join(FAKE_JDK.home, 'bin'))).toBe(true);
    socket.close();

    // A folder without the equinox launcher is not a JDT.LS install. Needs its
    // own project root, otherwise the healthy bridge above is simply reused.
    const bogusRoot = makeRoot('java-root2-');
    addAuthorizedRoot(bogusRoot);
    const bogus = makeRoot('plain-folder-');
    const bad = await start({ language: 'java', root: bogusRoot, storageRoot: storage }, fakeDeps({ jdtls: { found: true, path: bogus } }));
    expect(bad).toMatchObject({ ok: false, code: 'MISSING_TOOL' });
    expect(bad.ok === false && bad.message).toMatch(/not an Eclipse JDT\.LS install/);
  });

  it('childEnvironment keeps JAVA_HOME out for non-Java servers and drops secrets', () => {
    process.env.CANARY_SECRET = 'nope';
    const plain = childEnvironment({ jdkHome: null });
    expect(plain.JAVA_HOME).toBeUndefined();
    expect(Object.keys(plain).some((k) => k.includes('CANARY'))).toBe(false);
    const withJdk = childEnvironment({ jdkHome: 'D:\\jdk' }, { PATH: 'C:\\tools', CANARY_SECRET: 'nope' } as any);
    expect(withJdk.JAVA_HOME).toBe('D:\\jdk');
    expect(withJdk.PATH.startsWith(`D:\\jdk${path.sep}bin`)).toBe(true);
    expect((withJdk as any).CANARY_SECRET).toBeUndefined();
    delete process.env.CANARY_SECRET;
  });

  it('childEnvironment hands the server the PATH the tool lookup searched', async () => {
    // A language server is itself a Node/Java program that starts helpers by
    // name; on the snapshot-only PATH the app can report a tool as found while
    // the server it just launched cannot resolve it.
    await refreshPathFromRegistry(true);
    const own = new Set(mergePathDirs(process.env.PATH).map((d) => d.toLowerCase()));
    const recovered = pathSearchDirs().filter((d) => !own.has(d.toLowerCase())).map((d) => d.toLowerCase());
    const given = mergePathDirs(childEnvironment({ jdkHome: null }).PATH).map((d) => d.toLowerCase());
    for (const dir of recovered) expect(given, dir).toContain(dir);
    // The JDK's own bin still wins over everything else.
    const jdk = mergePathDirs(childEnvironment({ jdkHome: 'D:\\jdk' }, { PATH: 'C:\\tools' } as any).PATH);
    expect(jdk[0].toLowerCase()).toBe(`d:\\jdk${path.sep}bin`.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// Server diagnostics stay visible but never carry credentials
// ---------------------------------------------------------------------------
describe('server log capture', () => {
  it('redacts credential-shaped values', () => {
    expect(redactServerLog('token=abc123def456')).toBe('token=[redacted]');
    expect(redactServerLog('AWS_SECRET_ACCESS_KEY: "hunter2" and more')).toBe('AWS_SECRET_ACCESS_KEY: [redacted] and more');
    expect(redactServerLog('INFO: compiled 3 files in 210ms')).toBe('INFO: compiled 3 files in 210ms');
  });

  it('keeps the server stderr tail so a failure says why', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const started = await start({ language: 'python' }, deps);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const socket = await connectBridge(started.wsUrl);
    const child = deps.spawns[0].child;
    child.stderr.write('org.eclipse.jdt.launching error: A JRE does not provide the java.base module\r\n');
    child.stderr.write('api_key=LEAKME\r\n');
    await new Promise((r) => setTimeout(r, 30));
    const st = status({ language: 'python' });
    expect(st.ok && st.state).toBe('running');
    const tail = (st as any).logTail as string[];
    expect(tail.join('\n')).toMatch(/A JRE does not provide the java\.base module/);
    expect(tail.join('\n')).toContain('api_key=[redacted]');
    expect(tail.join('\n')).not.toContain('LEAKME');
    socket.close();
  });
});

// ---------------------------------------------------------------------------
// buildSpawn — argv arrays only; Windows .cmd shims through cmd.exe
// ---------------------------------------------------------------------------
describe('buildSpawn', () => {
  it('spawns plain executables directly with a fixed argv array', () => {
    const spec = buildSpawn('C:\\llvm\\bin\\clangd.exe', ['--stdio'], {}, 'C:\\w', 'win32');
    expect(spec.cmd).toBe('C:\\llvm\\bin\\clangd.exe');
    expect(spec.args).toEqual(['--stdio']);
    expect(spec.options.windowsHide).toBe(true);
    expect(spec.options.windowsVerbatimArguments).toBeUndefined();
    expect(spec.options.shell).toBeUndefined();
  });

  it('runs npm .cmd shims through cmd.exe /d /c with a fully quoted path', () => {
    const spec = buildSpawn(
      'C:\\Program Files\\nodejs\\pyright-langserver.cmd',
      ['--stdio'],
      {},
      'C:\\w',
      'win32',
      'C:\\Windows\\System32\\cmd.exe',
    );
    expect(spec.cmd).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.args).toEqual(['/d', '/c', '"C:\\Program Files\\nodejs\\pyright-langserver.cmd" --stdio']);
    // cmd parses `\"` escapes as literal text, so the line must go verbatim.
    expect(spec.options.windowsVerbatimArguments).toBe(true);
  });

  it('refuses a tool path containing shell metacharacters', () => {
    expect(() => buildSpawn('C:\\x\\a"&calc.cmd', ['--stdio'], {}, 'C:\\w', 'win32', 'cmd.exe')).toThrow(/unsafe tool path/i);
    expect(() => buildSpawn('C:\\x\\b|evil.cmd', [], {}, 'C:\\w', 'win32', 'cmd.exe')).toThrow(/unsafe tool path/i);
  });

  it('keeps Unicode tool paths intact', () => {
    const spec = buildSpawn('D:\\工具\\pyright-langserver.cmd', [], {}, 'C:\\w', 'win32', 'cmd.exe');
    expect(spec.args[2]).toBe('"D:\\工具\\pyright-langserver.cmd"');
  });

  it('refuses to build a command line from unsafe arguments', () => {
    expect(() => buildSpawn('C:\\x\\a.cmd', ['--ok && calc.exe'], {}, 'C:\\w', 'win32', 'cmd.exe')).toThrow(/unsafe/i);
  });
});

// ---------------------------------------------------------------------------
// start() boundary results (before anything is spawned)
// ---------------------------------------------------------------------------
describe('bridge start boundary', () => {
  it('rejects languages with no configured server without touching discovery', async () => {
    const deps = fakeDeps({});
    const discoverSpy = vi.spyOn(deps, 'discover');
    const res = await start({ language: 'go' }, deps);
    expect(res).toMatchObject({ ok: false, code: 'UNSUPPORTED_LANGUAGE' });
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  it('rejects a root that is not an authorized workspace folder', async () => {
    addAuthorizedRoot(makeRoot());
    const res = await start({ language: 'python', root: 'C:\\Windows\\System32' }, fakeDeps(OK_PYRIGHT));
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('rejects a non-absolute configured tool path', async () => {
    const res = await start({ language: 'python', toolPath: 'pyright-langserver' }, fakeDeps(OK_PYRIGHT));
    expect(res).toMatchObject({ ok: false, code: 'BAD_TOOL_PATH' });
  });

  it('returns MISSING_TOOL when discovery located nothing', async () => {
    const res = await start({ language: 'python' }, fakeDeps({}));
    expect(res).toMatchObject({ ok: false, code: 'MISSING_TOOL' });
    expect(activeBridges()).toHaveLength(0);
  });

  it('starts a loopback bridge and reuses it per (server, root) without double-spawning', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const root = makeRoot();
    addAuthorizedRoot(root);
    const first = await start({ language: 'python', root }, deps);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.wsUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/lsp$/);
    expect(first.reused).toBe(false);
    // Starting never spawns a child by itself; only WebSocket connections do.
    expect(deps.spawns).toHaveLength(0);

    const cpp = await start({ language: 'cpp', root }, fakeDeps({ clangd: { found: true, path: 'C:\\clangd\\clangd.exe', version: 'clangd version 18.1.0' } }));
    expect(cpp.ok).toBe(true); // different server id -> its own bridge
    expect(activeBridges()).toHaveLength(2);

    const second = await start({ language: 'python', root }, deps);
    expect(second.ok && second.reused).toBe(true);
    expect(second.ok && second.wsUrl).toBe(first.wsUrl);
    expect(deps.spawns).toHaveLength(0);
  });

  it('reports running/stopped through status() and clears state via stop()', async () => {
    const root = makeRoot();
    addAuthorizedRoot(root);
    const started = await start({ language: 'python', root }, fakeDeps(OK_PYRIGHT));
    expect(started.ok).toBe(true);
    expect(status({ language: 'python', root }).ok && status({ language: 'python', root })).toMatchObject({ state: 'running', tool: 'pyright-langserver' });
    const stopped = await stop({ language: 'python', root });
    expect(stopped).toMatchObject({ ok: true, stopped: true });
    expect(status({ language: 'python', root })).toMatchObject({ ok: true, state: 'stopped' });
    expect(activeBridges()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Connection plumbing: framing, env hygiene, origin checks, crash limit
// ---------------------------------------------------------------------------
describe('bridge connections', () => {
  async function openBridge(deps: ReturnType<typeof fakeDeps>) {
    const res = await start({ language: 'python' }, deps);
    if (!res.ok) throw new Error('bridge did not start');
    return res.wsUrl;
  }

  it('forwards a ws JSON frame to the child as one Content-Length frame', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const socket = await connectBridge(await openBridge(deps));
    expect(deps.spawns).toHaveLength(1);
    const child = deps.spawns[0].child;
    const msg = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } };
    socket.send(JSON.stringify(msg));
    await new Promise((r) => setTimeout(r, 50));
    expect(child.stdin.writes).toHaveLength(1);
    const text = child.stdin.writes[0].toString('utf8');
    const sep = text.indexOf('\r\n\r\n');
    expect(text.slice(0, sep)).toMatch(/Content-Length: \d+/);
    expect(JSON.parse(text.slice(sep + 4))).toEqual(msg);
    socket.close();
  });

  it('reassembles split Content-Length frames from the child into single ws messages', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const socket = await connectBridge(await openBridge(deps));
    const child = deps.spawns[0].child;
    const response = { jsonrpc: '2.0', id: 1, result: { capabilities: { hoverProvider: true } } };
    const body = JSON.stringify(response);
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const got = new Promise<any>((resolve) => {
      socket.on('message', (data) => resolve(JSON.parse(data.toString('utf8'))));
    });
    child.stdout.write(Buffer.from(frame.slice(0, 20), 'utf8'));
    await new Promise((r) => setTimeout(r, 10));
    child.stdout.write(Buffer.from(frame.slice(20), 'utf8'));
    expect(await got).toEqual(response);
    socket.close();
  });

  it('drops malformed ws frames instead of forwarding them to the server', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const socket = await connectBridge(await openBridge(deps));
    const child = deps.spawns[0].child;
    socket.send('this is not json{{{');
    socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));
    await new Promise((r) => setTimeout(r, 50));
    expect(child.stdin.writes).toHaveLength(1); // only the valid frame
    socket.close();
  });

  it('refuses WebSocket handshakes from foreign origins', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const url = await openBridge(deps);
    await expect(connectBridge(url, 'https://evil.example')).rejects.toThrow();
    expect(deps.spawns).toHaveLength(0); // rejected before handleConnection
  });

  it('children get the allow-list environment only — a canary secret never leaks', async () => {
    process.env.CANARY_SECRET = 'must-never-be-inherited';
    const deps = fakeDeps(OK_PYRIGHT);
    const socket = await connectBridge(await openBridge(deps));
    expect(deps.spawns).toHaveLength(1);
    const env = deps.spawns[0].options.env as Record<string, string>;
    expect(env).toBeDefined();
    expect(Object.keys(env).some((k) => k.includes('CANARY'))).toBe(false);
    socket.close();
  });

  it('kills the child when the connection closes and the child is tracked until then', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const socket = await connectBridge(await openBridge(deps));
    const child = deps.spawns[0].child;
    await new Promise((r) => setTimeout(r, 20));
    socket.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(child.kills).toBeGreaterThanOrEqual(1);
  });

  it('disables a bridge after repeated early crashes instead of restart-spawning forever', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const url = await openBridge(deps);
    // Every spawned child dies within milliseconds without ever answering.
    const origSpawn = deps.spawn;
    deps.spawn = (cmd, args, options) => {
      const child = origSpawn(cmd, args, options);
      setTimeout(() => (child as any).emit('close', 1, null), 5);
      return child;
    };
    for (let i = 0; i < 3; i++) {
      const socket = await connectBridge(url);
      await new Promise<void>((resolve) => {
        socket.on('close', () => resolve());
        setTimeout(resolve, 2000);
      });
    }
    const res = await start({ language: 'python' }, deps);
    expect(res).toMatchObject({ ok: false, code: 'LS_CRASHED' });
    // stop() is the documented recovery path and clears the crash flag.
    await stop({ language: 'python' });
    const again = await start({ language: 'python' }, deps);
    expect(again.ok).toBe(true);
  }, 20000);

  it('disposeAll() terminates every tracked child and bridge', async () => {
    const deps = fakeDeps(OK_PYRIGHT);
    const socket = await connectBridge(await openBridge(deps));
    const child = deps.spawns[0].child;
    disposeAll();
    await new Promise<void>((resolve) => {
      socket.on('close', () => resolve());
      setTimeout(resolve, 2000);
    });
    expect(child.kills).toBeGreaterThanOrEqual(1);
    expect(activeBridges()).toHaveLength(0);
  });

  it('works for a workspace root containing spaces and Unicode', async () => {
    const root = makeRoot('my projects ünïcødē 测试-');
    addAuthorizedRoot(root);
    const res = await start({ language: 'python', root }, fakeDeps(OK_PYRIGHT));
    expect(res.ok).toBe(true);
    const socket = await connectBridge(res.ok ? res.wsUrl : '');
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
  });
});
