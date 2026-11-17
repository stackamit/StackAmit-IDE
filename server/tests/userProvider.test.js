import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { decryptCredential, encryptCredential, maskCredential } from '../src/services/credentialVault.service.js';

test('provider credentials use authenticated encryption and masked display values', () => {
  const previous = env.aiCredentialEncryptionKey;
  env.aiCredentialEncryptionKey = crypto.randomBytes(32).toString('base64');
  try {
    const raw = 'sk-user-private-key-123456';
    const encrypted = encryptCredential(raw);
    assert.equal(decryptCredential(encrypted), raw);
    assert.notEqual(encrypted.ciphertext, raw);
    assert.equal(maskCredential(raw).endsWith('3456'), true);
    assert.equal(maskCredential(raw).includes(raw), false);
  } finally { env.aiCredentialEncryptionKey = previous; }
});

test('user provider endpoints require an end-user session', async () => {
  const response = await request(app).get('/api/user/ai/providers');
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'UNAUTHORIZED');
});

test('web AI streaming cannot use server keys without an end-user session', async () => {
  const response = await request(app).post('/api/ai/chat/stream').send({ provider: 'openai', model: 'gpt-test', messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(response.status, 401);
  assert.equal(response.body.code, 'UNAUTHORIZED');
});
