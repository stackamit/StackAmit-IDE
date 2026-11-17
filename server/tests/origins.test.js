import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { env, isAllowedOrigin, ALLOWED_ORIGINS } from '../src/config/env.js';
import { loadApp, stubFetch } from './helpers.js';

/**
 * Browser-origin policy lives in ONE set (config/env.js) and both consumers —
 * HTTP CORS and the interactive WebSocket handshake — check against it. These
 * tests pin the set itself and the CORS behaviour built on it.
 */

let app;
let restore;

before(async () => {
  restore = stubFetch([]);
  app = await loadApp('wandbox');
});

after(() => restore());

test('the configured client origin and dev loopbacks are allowed', () => {
  assert.ok(isAllowedOrigin(env.clientUrl));
  assert.ok(isAllowedOrigin('http://localhost:5173'));
  assert.ok(isAllowedOrigin('http://127.0.0.1:5173'));
  // A browser sends no Origin for same-origin/curl-style requests.
  assert.ok(isAllowedOrigin(undefined));
});

test('configured client origins are normalized without trailing slashes', () => {
  assert.equal(env.clientUrl.endsWith('/'), false);
  assert.equal(isAllowedOrigin('https://stackamit-ide.netlify.app/'), false);
});

test('unrelated origins are rejected, including look-alikes', () => {
  assert.ok(!isAllowedOrigin('https://evil.example'));
  assert.ok(!isAllowedOrigin('http://localhost:5173.evil.example'));
  assert.ok(!isAllowedOrigin('http://evil.test:5173'));
});

test('the dev port in the origin set is the one Vite actually serves on', () => {
  // client/vite.config.js pins server.port 5173 — if either side moves alone,
  // the packaged dev experience breaks with a CORS error that is hard to trace.
  assert.ok([...ALLOWED_ORIGINS].some((o) => o.endsWith(':5173')));
});

test('CORS echoes an allowed origin and withholds it from a stranger', async () => {
  const ok = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
  assert.equal(ok.headers['access-control-allow-origin'], 'http://localhost:5173');

  const bad = await request(app).get('/api/health').set('Origin', 'https://evil.example');
  assert.ok(
    !bad.headers['access-control-allow-origin'] || bad.headers['access-control-allow-origin'] !== 'https://evil.example',
    'a stranger origin must never be echoed back',
  );
});
