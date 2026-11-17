import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadApp } from './helpers.js';

let app;

before(async () => {
  app = await loadApp('wandbox');
});

test('debug capability is readable for guests and separates auth from runtime readiness', async () => {
  const res = await request(app).get('/api/debug/capabilities').expect(200);
  assert.equal(typeof res.body.python.authenticationRequired, 'boolean');
  assert.equal(res.body.python.authenticated, false);
  assert.equal(typeof res.body.python.runtimeAvailable, 'boolean');
  assert.equal(typeof res.body.python.debugpyAvailable, 'boolean');
  assert.equal(typeof res.body.python.debuggerAvailable, 'boolean');
  assert.equal(JSON.stringify(res.body).includes('API_KEY'), false);
});
