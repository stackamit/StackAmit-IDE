import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadApp, stubFetch } from './helpers.js';

let app;
let restore;

before(async () => {
  restore = stubFetch([
    ['/list.json', () => [200, [{ name: 'cpython-3.11.10' }]]],
    // Provider down: emulate a 502 upstream error.
    ['/compile.json', () => [502, { message: 'bad gateway' }]],
  ]);
  app = await loadApp('wandbox');
});

after(() => restore());

test('provider failure becomes a clear 502, never a fake success', async () => {
  const res = await request(app).post('/api/code/run').send({ language: 'python', sourceCode: 'print(1)' });
  assert.equal(res.status, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'PROVIDER_UNAVAILABLE');
  assert.ok(!('stdout' in res.body));
});

test('snippet save degrades to 503 when the database is offline', async () => {
  const res = await request(app).post('/api/snippets').send({ language: 'python', sourceCode: 'print(1)', isPublic: true });
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'DATABASE_UNAVAILABLE');
});

test('no authentication is required for core endpoints', async () => {
  // Requests without any Authorization header succeed at the API layer (the
  // provider is down here, but that is a 5xx provider issue, not a 401/403).
  const res = await request(app).post('/api/code/run').send({ language: 'python', sourceCode: 'print(1)' });
  assert.ok(res.status !== 401 && res.status !== 403, 'auth must not be required');
});
