/**
 * Preview server + dev-script validation tests. These exercise the REAL HTTP
 * server on 127.0.0.1 — including genuine path-traversal attempts and port
 * conflicts — not mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import * as ws from '../services/workspaceFs.js';
import * as preview from '../services/previewServer.js';
import { mergePathDirs, pathSearchDirs, refreshPathFromRegistry } from '../services/runtimeProbe.js';

let rootA: string;
let rootB: string;

function writeFixtures() {
  fs.writeFileSync(path.join(rootA, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hi</h1><script src="app.js"></script></body></html>');
  fs.writeFileSync(path.join(rootA, 'style.css'), 'h1 { color: red }');
  fs.writeFileSync(path.join(rootA, 'app.js'), 'console.log("live")');
  fs.mkdirSync(path.join(rootA, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(rootA, 'sub', 'page.html'), '<p>sub</p>');
  // A file OUTSIDE the workspace that traversal must never reach:
  fs.writeFileSync(path.join(os.tmpdir(), 'stackamit-preview-secret.txt'), 'SECRET');
}

beforeAll(() => {
  rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-preview-A-'));
  rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-preview-B-'));
  writeFixtures();
});

afterAll(() => {
  preview.disposeAll();
  for (const d of [rootA, rootB]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('previewServer — static Go Live server', () => {
  it('refuses roots that were never authorized (no workspace opened)', async () => {
    ws.clearAuthorizedRoots();
    const res = await preview.startStatic({ root: rootA });
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('FORBIDDEN');
  });

  it('serves index.html, css and js with correct MIME types', async () => {
    ws.addAuthorizedRoot(rootA);
    const res = await preview.startStatic({ root: rootA, port: 0 });
    expect(res.ok).toBe(true);
    const anyRes = res as any;
    expect(anyRes.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

    const home = await fetch(anyRes.url);
    expect(home.status).toBe(200);
    expect(home.headers.get('content-type')).toContain('text/html');
    expect(await home.text()).toContain('href="style.css"');

    const css = await fetch(anyRes.url + 'style.css');
    expect(css.headers.get('content-type')).toContain('text/css');
    const js = await fetch(anyRes.url + 'app.js');
    expect(js.headers.get('content-type')).toContain('text/javascript');
    const sub = await fetch(anyRes.url + 'sub/page.html');
    expect(sub.status).toBe(200);
    const nestedRoot = path.join(rootA, 'portfolio');
    fs.mkdirSync(nestedRoot, { recursive: true });
    fs.writeFileSync(path.join(nestedRoot, 'index.html'), '<link rel="stylesheet" href="site.css">');
    fs.writeFileSync(path.join(nestedRoot, 'site.css'), 'body { color: red }');
    const nested = await fetch(anyRes.url + 'portfolio/index.html');
    expect(nested.status).toBe(200);
    expect(await nested.text()).toContain('site.css');
    expect((await fetch(anyRes.url + 'portfolio/site.css')).status).toBe(200);
    const missing = await fetch(anyRes.url + 'nope.html');
    expect(missing.status).toBe(404);
  });

  it('rejects path traversal with 403 (encoded, plain, and NUL attempts)', async () => {
    const status = (res: { ok: boolean; state?: string; url?: string }) => (res as any).url;
    const s = preview.staticStatus({ root: rootA });
    const base = status(s);
    for (const attack of [
      '../stackamit-preview-secret.txt',
      '..%2F..%2Fstackamit-preview-secret.txt',
      '%2e%2e/%2e%2e/stackamit-preview-secret.txt',
      '/../../..%2fstackamit-preview-secret.txt',
      'index.html%00.txt',
    ]) {
      const r = await fetch(base + attack);
      expect([403, 404, 400]).toContain(r.status);
      expect(await r.text()).not.toContain('SECRET');
    }
  });

  it('is idempotent per root (no duplicate servers) and reuses the port', async () => {
    const again = await preview.startStatic({ root: rootA, port: 0 });
    expect((again as any).reused).toBe(true);
    const s = preview.staticStatus({ root: rootA });
    expect((s as any).state).toBe('running');
  });

  it('validates ports: privileged rejected, garbage rejected, 0 accepted', async () => {
    ws.addAuthorizedRoot(rootB);
    expect((await preview.startStatic({ root: rootB, port: 80 })).ok).toBe(false);
    expect((await preview.startStatic({ root: rootB, port: 'abc' as any })).ok).toBe(false);
    expect((await preview.startStatic({ root: rootB, port: 70000 })).ok).toBe(false);
  });

  it('reports PORT_BUSY instead of crashing when the port is taken', async () => {
    const blocker = http.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as { port: number }).port;
    const res = await preview.startStatic({ root: rootB, port });
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('PORT_BUSY');
    blocker.close();
  });

  it('stop closes the server; status flips to stopped', async () => {
    const s1 = preview.staticStatus({ root: rootB });
    expect((s1 as any).state).toBe('stopped'); // rootB never successfully started
    const stop = await preview.stopStatic({ root: rootA });
    expect(stop.ok).toBe(true);
    expect((preview.staticStatus({ root: rootA }) as any).state).toBe('stopped');
  });
});

describe('previewServer — safeJoin (pure)', () => {
  it('maps normal paths inside the root', () => {
    ws.clearAuthorizedRoots();
    ws.addAuthorizedRoot(rootA);
    const joined = preview.safeJoin(rootA, '/sub/page.html');
    expect(joined && path.basename(joined)).toBe('page.html');
    const decoded = preview.safeJoin(rootA, '/style%2Ecss');
    expect(decoded && path.basename(decoded)).toBe('style.css');
  });

  it('rejects escapes and malformed input', () => {
    expect(preview.safeJoin(rootA, '/../secret')).toBeNull();
    expect(preview.safeJoin(rootA, '/a/../../b/../../x')).toBeNull();
    expect(preview.safeJoin(rootA, '/%ff%fe')).toBeNull(); // invalid percent-encoding
    expect(preview.safeJoin(rootA, '/a%00b')).toBeNull();
  });
});

describe('previewServer — dev-script validation (package.json allow-list)', () => {
  beforeAll(() => {
    fs.writeFileSync(
      path.join(rootB, 'package.json'),
      JSON.stringify({ name: 'demo', scripts: { dev: 'vite', 'build:all': 'vite build' } }),
    );
  });

  it('accepts only scripts that exist, with safe names', async () => {
    ws.addAuthorizedRoot(rootB);
    expect((await preview.validateDevScript(rootB, 'dev')).ok).toBe(true);
    expect((await preview.validateDevScript(rootB, 'build:all')).ok).toBe(true);
    const missing = await preview.validateDevScript(rootB, 'nope');
    expect(missing.ok).toBe(false);
    expect((missing as any).code).toBe('SCRIPT_MISSING');
    for (const bad of ['dev && calc', 'dev;rm -rf', '-evil', 'a'.repeat(100), '', 42 as any, null as any]) {
      const r = await preview.validateDevScript(rootB, bad);
      expect(r.ok).toBe(false);
    }
  });

  it('lists scripts for the UI and reports empty for non-projects', async () => {
    const listed = await preview.listDevScripts({ root: rootB });
    expect((listed as any).scripts).toEqual(['dev', 'build:all']);
    const none = await preview.listDevScripts({ root: rootA });
    expect((none as any).scripts).toEqual([]);
  });

  it('rejects dev starts outside authorized roots', async () => {
    ws.clearAuthorizedRoots();
    const r = await preview.startDev({ root: rootB, script: 'dev' });
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe('FORBIDDEN');
  });

  it(
    'spawns a real package.json script, discovers its URL, and kills the tree on stop',
    async () => {
      ws.addAuthorizedRoot(rootB);
      fs.writeFileSync(
        path.join(rootB, 'package.json'),
        JSON.stringify({ name: 'demo', scripts: { live: 'node print-url.js' } }),
      );
      fs.writeFileSync(
        path.join(rootB, 'print-url.js'),
        "console.log('  Local:   http://127.0.0.1:4599/');setTimeout(() => {}, 30000);\n",
      );
      const start = await preview.startDev({ root: rootB, script: 'live' });
      expect(start.ok).toBe(true);

      // Readiness: poll until the URL scraped from the server's own stdout
      // shows the session as running (npm startup takes a few seconds).
      let status: any = null;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        status = preview.devStatus({ root: rootB });
        if (status.state === 'running' && status.url) break;
        if (status.state === 'exited') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(status.state).toBe('running');
      expect(status.url).toBe('http://127.0.0.1:4599');
      expect(preview.isAllowedServerUrl(status.url + '/')).toBe(true);

      const stop = await preview.stopDev({ root: rootB });
      expect(stop.ok).toBe(true);
      expect(preview.devStatus({ root: rootB }).ok && (preview.devStatus({ root: rootB }) as any).state).toBe('exited');
    },
    60000,
  );
});

describe('previewServer — URL allow-list for probe/openExternal', () => {
  it('only accepts ports belonging to live local servers', async () => {
    ws.clearAuthorizedRoots();
    ws.addAuthorizedRoot(rootA);
    const start = await preview.startStatic({ root: rootA, port: 0 });
    const url = (start as any).url;
    const port = new URL(url).port;
    expect(preview.isAllowedServerUrl(url)).toBe(true);
    expect(preview.isAllowedServerUrl(`http://127.0.0.1:${port}/index.html`)).toBe(true);
    expect(preview.isAllowedServerUrl(`http://127.0.0.1:${port === '80' ? '81' : '80'}/`)).toBe(false);
    expect(preview.isAllowedServerUrl(`https://127.0.0.1:${port}/`)).toBe(false);
    expect(preview.isAllowedServerUrl(`http://example.com:${port}/`)).toBe(false);
    expect(preview.isAllowedServerUrl('not a url')).toBe(false);

    const probe = await preview.probeUrl(url + 'style.css');
    expect(probe.ok).toBe(true);
    expect((probe as any).status).toBe(200);
    const forbidden = await preview.probeUrl('http://example.com/');
    expect(forbidden.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The environment `npm run <script>` is started with
// ---------------------------------------------------------------------------
describe('dev server environment', () => {
  it('gives the dev server the PATH the app searches, not the one it inherited', async () => {
    // `npm` is the one command here resolved by name, so a Node.js that this
    // process's snapshot predates would make a valid `npm run dev` fail with
    // "'npm' is not recognized" while the IDE itself had just found it.
    await refreshPathFromRegistry(true);
    const env = preview.devEnvironment({ PATH: 'C:\\own\\bin', SYSTEMROOT: 'C:\\Windows' } as any);
    expect(env.PATH.split(path.delimiter)[0], 'the caller keeps its own order').toBe('C:\\own\\bin');
    expect(env.NO_COLOR).toBe('1');
    const own = new Set(mergePathDirs(process.env.PATH).map((d) => d.toLowerCase()));
    const recovered = pathSearchDirs().filter((d) => !own.has(d.toLowerCase())).map((d) => d.toLowerCase());
    const given = mergePathDirs(env.PATH).map((d) => d.toLowerCase());
    for (const dir of recovered) expect(given, dir).toContain(dir);
  });

  it('adds to the PATH without touching anything else, or the parent process', () => {
    // A dev server is the user's own build toolchain and legitimately needs its
    // environment; only PATH is extended here, and the process itself is left
    // alone so nothing outside this child changes.
    const before = process.env.PATH;
    const env = preview.devEnvironment({ PATH: 'C:\\bin', SYSTEMROOT: 'C:\\Windows', npm_config_registry: 'https://registry.internal' } as any);
    expect(env.SYSTEMROOT).toBe('C:\\Windows');
    expect(env.npm_config_registry).toBe('https://registry.internal');
    expect(process.env.PATH).toBe(before);
  });
});
