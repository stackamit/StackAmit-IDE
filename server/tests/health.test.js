import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadApp, stubFetch } from './helpers.js';

let app;
let restore;

before(async () => {
  // Health + languages hit the provider health/list endpoints; stub them.
  restore = stubFetch([
    ['/list.json', () => [200, [{ name: 'cpython-3.11.10' }, { name: 'gcc-13.2.0-c' }, { name: 'nodejs-20.17.0' }]]],
  ]);
  app = await loadApp('wandbox');
});

after(() => restore());

test('GET /api/health returns status with db + execution summary', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.equal(typeof res.body.database.connected, 'boolean');
  assert.equal(res.body.execution.provider, 'wandbox');
  // Must never leak secrets / connection strings.
  const raw = JSON.stringify(res.body);
  assert.ok(!raw.includes('mongodb://') && !raw.includes('Bearer'));
});

test('GET /api/execution/status reports provider availability', async () => {
  const res = await request(app).get('/api/execution/status').expect(200);
  assert.equal(res.body.configured, true);
  assert.equal(res.body.available, true);
});

test('GET /api/languages returns all configured languages', async () => {
  const res = await request(app).get('/api/languages').expect(200);
  const keys = res.body.languages.map((l) => l.key);
  for (const expected of ['python', 'c', 'cpp', 'java', 'javascript']) {
    assert.ok(keys.includes(expected), `missing ${expected}`);
  }
  assert.equal(res.body.provider, 'wandbox');
});

test('Unknown routes return a structured 404', async () => {
  const res = await request(app).get('/api/nope').expect(404);
  assert.equal(res.body.code, 'NOT_FOUND');
});
