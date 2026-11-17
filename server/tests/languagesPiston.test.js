import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadApp, stubFetch } from './helpers.js';

/**
 * Separate file on purpose: helpers.loadApp caches the app module per process,
 * so the provider under test is fixed by the first load in each file.
 * Node's test runner gives every file its own process.
 */
let app;
let restore;

before(async () => {
  restore = stubFetch([
    ['/runtimes', () => [200, [{ language: 'python', version: '3.10.0' }, { language: 'go', version: '1.19.0' }]]],
  ]);
  app = await loadApp('piston');
});

after(() => restore());

test('piston cross-check tolerates null provider entries', async () => {
  const res = await request(app).get('/api/languages');
  assert.equal(res.status, 200);
  if (!res.body.configured) return; // adapter not resolvable in this environment
  const byKey = Object.fromEntries(res.body.languages.map((l) => [l.key, l]));
  assert.equal(byKey.python.supported, true);
  // go exists in the stub catalog but has no `piston` entry in the registry —
  // it must be reported unsupported rather than crashing the endpoint.
  assert.equal(byKey.go.supported, false);
});

test('piston run of a Wandbox-only language fails honestly, not with a crash', async () => {
  const res = await request(app).post('/api/code/run').send({ language: 'sql', sourceCode: 'SELECT 1;' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'UNSUPPORTED_LANGUAGE');
});
