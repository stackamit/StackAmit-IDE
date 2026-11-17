import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

function keyBytes() {
  const raw = String(env.aiCredentialEncryptionKey || '').trim();
  if (!raw) throw new ApiError('User provider credentials are not configured on this server.', { status: 503, code: 'AI_CREDENTIAL_VAULT_NOT_CONFIGURED' });
  const decoded = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (decoded.length !== 32) throw new ApiError('User provider credentials are not configured on this server.', { status: 503, code: 'AI_CREDENTIAL_VAULT_NOT_CONFIGURED' });
  return decoded;
}

export function encryptCredential(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), keyVersion: 'v1' };
}

export function decryptCredential(encrypted) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new ApiError('Stored provider credentials could not be decrypted.', { status: 503, code: 'AI_CREDENTIAL_DECRYPT_FAILED' });
  }
}

export function maskCredential(value) {
  const text = String(value || '');
  return text ? `${'•'.repeat(Math.min(8, Math.max(4, text.length - 4)))}${text.slice(-4)}` : '';
}
