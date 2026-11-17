import test from 'node:test';
import assert from 'node:assert/strict';
import sgMail from '@sendgrid/mail';
import { env } from '../src/config/env.js';
import { sendEmail } from '../src/services/email.service.js';

const original = {
  apiKey: env.sendgridApiKey,
  fromEmail: env.sendgridFromEmail,
  fromName: env.sendgridFromName,
  send: sgMail.send,
  setApiKey: sgMail.setApiKey,
};

test.beforeEach(() => {
  env.sendgridApiKey = 'SG.test-key';
  env.sendgridFromEmail = 'noreply@example.com';
  env.sendgridFromName = 'StackAmit IDE';
  sgMail.setApiKey = () => {};
});

test.afterEach(() => {
  env.sendgridApiKey = original.apiKey;
  env.sendgridFromEmail = original.fromEmail;
  env.sendgridFromName = original.fromName;
  sgMail.send = original.send;
  sgMail.setApiKey = original.setApiKey;
});

test('sends plain-text and HTML email through SendGrid without exposing credentials', async () => {
  let message;
  sgMail.send = async (value) => { message = value; return [{ statusCode: 202 }]; };
  const result = await sendEmail({ to: 'user@example.com', subject: 'Verify', text: 'Verify this account.' });
  assert.deepEqual(result, { accepted: true });
  assert.equal(message.to, 'user@example.com');
  assert.deepEqual(message.from, { email: 'noreply@example.com', name: 'StackAmit IDE' });
  assert.match(message.html, /Verify this account/);
  assert.equal(JSON.stringify(message).includes('SG.test-key'), false);
});

test('classifies SendGrid authentication rejection without leaking provider payloads', async () => {
  sgMail.send = async () => { const error = new Error('provider detail'); error.response = { statusCode: 401, body: { secret: 'do-not-return' } }; throw error; };
  await assert.rejects(sendEmail({ to: 'user@example.com', subject: 'Test', text: 'Test' }), (error) => {
    assert.equal(error.code, 'EMAIL_PROVIDER_AUTH_FAILED');
    assert.equal(error.status, 502);
    assert.equal(error.message, 'SendGrid credentials or sender address were rejected.');
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
});

test('rejects missing sender configuration before calling SendGrid', async () => {
  env.sendgridFromEmail = '';
  sgMail.send = async () => { throw new Error('must not call provider'); };
  await assert.rejects(sendEmail({ to: 'user@example.com', subject: 'Test', text: 'Test' }), (error) => error.code === 'EMAIL_NOT_CONFIGURED' && error.status === 503);
});

test('classifies SendGrid network timeout as a temporary failure', async () => {
  sgMail.send = async () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error; };
  await assert.rejects(sendEmail({ to: 'user@example.com', subject: 'Test', text: 'Test' }), (error) => error.code === 'EMAIL_PROVIDER_TIMEOUT' && error.status === 503);
});
