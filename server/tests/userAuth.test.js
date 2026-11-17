import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import { hashToken, randomToken } from '../src/config/userAuth.js';
import { requireCsrf } from '../src/middleware/requireUser.js';
import { requireAdminCsrf } from '../src/middleware/requireAdminCsrf.js';

test('user auth rejects unauthenticated profile access', async () => {
  const response = await request(app).get('/api/auth/me');
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'UNAUTHORIZED');
});

test('profile mutation rejects unauthenticated requests', async () => {
  const response = await request(app).patch('/api/auth/profile').send({ displayName: 'Not authenticated' });
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'UNAUTHORIZED');
});

test('user registration fails closed when user auth is not configured', async () => {
  const response = await request(app).post('/api/auth/register').send({ email: 'test@example.com', password: 'a-valid-password' });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'USER_AUTH_NOT_CONFIGURED');
});

test('admin route remains separate from user sessions', async () => {
  const response = await request(app).get('/api/admin/me');
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'UNAUTHORIZED');
});

test('auth tokens are random and only their hashes are suitable for storage', () => {
  const first = randomToken();
  const second = randomToken();
  assert.notEqual(first, second);
  assert.notEqual(hashToken(first), first);
  assert.equal(hashToken(first), hashToken(first));
});

test('browser user mutations reject missing CSRF tokens', () => {
  let error;
  requireCsrf({ method: 'POST', headers: {}, get: () => undefined }, {}, (value) => { error = value; });
  assert.equal(error.code, 'CSRF_FAILED');
  assert.equal(error.status, 403);
});

test('bearer desktop mutations do not require browser CSRF state', () => {
  let called = false;
  requireCsrf({ method: 'POST', headers: { authorization: 'Bearer desktop-session' }, get: () => undefined }, {}, () => { called = true; });
  assert.equal(called, true);
});

test('admin cookie mutations also require CSRF', () => {
  let error;
  requireAdminCsrf({ method: 'PATCH', headers: {}, get: () => undefined }, {}, (value) => { error = value; });
  assert.equal(error.code, 'CSRF_FAILED');
});
