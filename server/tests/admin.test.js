import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadApp } from './helpers.js';

// Admin credentials come from server/.env (loaded by config/env.js), so the
// login flow is exercised exactly as it runs in development.
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'StackAmit@Admin2026';

describe('admin authentication', () => {
  test('rejects invalid credentials with 401', async () => {
    const app = await loadApp();
    const res = await request(app).post('/api/admin/login').send({ username: ADMIN_USER, password: 'wrong-password' });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTHORIZED');
    assert.equal(res.body.success, false);
  });

  test('issues a token for valid credentials', async () => {
    const app = await loadApp();
    const res = await request(app).post('/api/admin/login').send({ username: ADMIN_USER, password: ADMIN_PASS });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.token, 'expected a JWT token');
  });

  test('protects admin routes without a token', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/admin/dashboard');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTHORIZED');
  });

  test('accepts a valid bearer token on protected routes', async () => {
    const app = await loadApp();
    const login = await request(app).post('/api/admin/login').send({ username: ADMIN_USER, password: ADMIN_PASS });
    const token = login.body.data.token;

    const me = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.authenticated, true);

    const dash = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${token}`);
    assert.equal(dash.status, 200);
    assert.equal(typeof dash.body.data.subsystems.database.connected, 'boolean');
    assert.ok(dash.body.data.executions, 'expected execution stats');
  });
});

describe('admin settings', () => {
  test('reads settings (degrades when the database is offline)', async () => {
    const app = await loadApp();
    const login = await request(app).post('/api/admin/login').send({ username: ADMIN_USER, password: ADMIN_PASS });
    const token = login.body.data.token;
    const res = await request(app).get('/api/admin/settings').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.snippetEnabled, 'boolean');
  });

  test('rejects empty settings patches with 400', async () => {
    const app = await loadApp();
    const login = await request(app).post('/api/admin/login').send({ username: ADMIN_USER, password: ADMIN_PASS });
    const token = login.body.data.token;
    const res = await request(app).patch('/api/admin/settings').set('Authorization', `Bearer ${token}`).send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });
});

describe('admin AI provider mode', () => {
  test('keeps server provider metadata behind admin authentication', async () => {
    const app = await loadApp();
    const unauthenticated = await request(app).get('/api/admin/ai/providers');
    assert.equal(unauthenticated.status, 401);
    const login = await request(app).post('/api/admin/login').send({ username: ADMIN_USER, password: ADMIN_PASS });
    const token = login.body.data.token;
    const res = await request(app).get('/api/admin/ai/providers').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.providers));
    assert.equal(JSON.stringify(res.body).includes('OPENAI_API_KEY'), false);
    assert.equal(JSON.stringify(res.body).includes('apiKey'), false);
  });

  test('normal user AI route cannot invoke server admin provider mode', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/admin/ai/providers');
    assert.equal(res.status, 401);
  });
});

describe('public site settings', () => {
  test('exposes non-sensitive settings without authentication', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/site/settings');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.snippetEnabled, 'boolean');
    assert.ok('announcementBanner' in res.body.data);
  });
});

describe('public page content', () => {
  test('GET /api/site/content returns admin-editable copy with defaults', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/site/content');
    assert.equal(res.status, 200);
    const c = res.body.data;
    assert.equal(typeof c.home.heroTitle, 'string');
    assert.equal(typeof c.about.intro, 'string');
    assert.equal(typeof c.contact.email, 'string');
    assert.ok('website' in c.social);
  });

  test('POST /api/site/contact requires a database and returns 503 when offline', async () => {
    const app = await loadApp();
    const res = await request(app)
      .post('/api/site/contact')
      .send({ name: 'Amit', email: 'amit@example.com', subject: 'Hi', message: 'This is a valid enquiry.' });
    // The test environment has no MongoDB, so storage must fail honestly (never fake success).
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'DATABASE_UNAVAILABLE');
  });

  test('admin content route is protected without a token', async () => {
    const app = await loadApp();
    const res = await request(app).get('/api/admin/content');
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'UNAUTHORIZED');
  });

  test('admin can read page content with a valid token', async () => {
    const app = await loadApp();
    const login = await request(app).post('/api/admin/login').send({ username: ADMIN_USER, password: ADMIN_PASS });
    const token = login.body.data.token;
    const res = await request(app).get('/api/admin/content').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.persisted, 'boolean');
    assert.ok(res.body.data.content.home, 'expected home content');
  });
});
