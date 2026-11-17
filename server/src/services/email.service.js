import sgMail from '@sendgrid/mail';
import { env } from '../config/env.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let configuredKey = '';

function configureClient() {
  if (!emailConfigured()) return false;
  if (configuredKey !== env.sendgridApiKey) {
    sgMail.setApiKey(env.sendgridApiKey);
    configuredKey = env.sendgridApiKey;
  }
  return true;
}

export function emailConfigured() {
  return Boolean(
    env.sendgridApiKey
      && emailPattern.test(env.sendgridFromEmail)
      && env.sendgridFromName,
  );
}

function htmlFromText(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<p style="white-space:pre-line;font-family:Arial,sans-serif;line-height:1.6">${escaped}</p>`;
}

/**
 * Send transactional mail through SendGrid. Provider credentials and error
 * payloads stay server-side; callers receive only stable safe error codes.
 */
export async function sendEmail({ to, subject, text, html }) {
  if (!emailConfigured()) {
    const error = new Error('Email delivery is not configured.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }
  if (!emailPattern.test(String(to || '').trim())) {
    const error = new Error('Email recipient is invalid.');
    error.code = 'EMAIL_INVALID_RECIPIENT';
    error.status = 400;
    throw error;
  }

  configureClient();
  try {
    await sgMail.send({
      to: String(to).trim(),
      from: { email: env.sendgridFromEmail, name: env.sendgridFromName },
      subject: String(subject || '').slice(0, 200),
      text: String(text || ''),
      html: typeof html === 'string' && html ? html : htmlFromText(text || ''),
    });
  } catch (cause) {
    const status = Number(cause?.response?.statusCode || cause?.code || 0);
    const temporaryCode = cause?.name === 'TimeoutError' || cause?.code === 'ETIMEDOUT'
      ? 'EMAIL_PROVIDER_TIMEOUT'
      : status >= 500 || status === 0
        ? 'EMAIL_PROVIDER_UNAVAILABLE'
        : null;
    const error = new Error(
      temporaryCode === 'EMAIL_PROVIDER_TIMEOUT'
        ? 'SendGrid request timed out.'
        : temporaryCode === 'EMAIL_PROVIDER_UNAVAILABLE'
          ? 'SendGrid is temporarily unavailable.'
          : status === 401 || status === 403
        ? 'SendGrid credentials or sender address were rejected.'
        : status === 429
          ? 'SendGrid rate limit reached.'
          : status >= 500
            ? 'SendGrid is temporarily unavailable.'
            : 'SendGrid rejected the message.',
    );
    error.code = temporaryCode || (status === 401 || status === 403
      ? 'EMAIL_PROVIDER_AUTH_FAILED'
      : status === 429
        ? 'EMAIL_PROVIDER_RATE_LIMITED'
        : 'EMAIL_DELIVERY_FAILED');
    error.status = error.code === 'EMAIL_PROVIDER_TIMEOUT' || error.code === 'EMAIL_PROVIDER_UNAVAILABLE'
      ? 503
      : status === 429 ? 429 : 502;
    throw error;
  }
  return { accepted: true };
}
