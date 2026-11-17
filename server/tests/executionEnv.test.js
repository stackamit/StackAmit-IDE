import test from 'node:test';
import assert from 'node:assert/strict';
import { executionEnv } from '../src/services/executionEnv.js';

test('execution environment excludes application secrets and request variables', () => {
  const safe = executionEnv({
    PATH: '/bin',
    HOME: '/tmp',
    DATABASE_URL: 'mongodb://secret',
    JWT_SECRET: 'secret',
    OPENAI_API_KEY: 'secret',
    SENDGRID_API_KEY: 'secret',
    USER_REQUESTED_SECRET: 'secret',
  }, { OPENAI_API_KEY: 'attempted-bypass', PYTHONUNBUFFERED: '1' });
  assert.equal(safe.PATH, '/bin');
  assert.equal(safe.HOME, '/tmp');
  assert.equal(safe.OPENAI_API_KEY, undefined);
  assert.equal(safe.DATABASE_URL, undefined);
  assert.equal(safe.JWT_SECRET, undefined);
  assert.equal(safe.SENDGRID_API_KEY, undefined);
  assert.equal(safe.USER_REQUESTED_SECRET, undefined);
  assert.equal(safe.PYTHONUNBUFFERED, '1');
});
