import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from './env.js';

export function userJwtSecret() { return env.userJwtSecret || ''; }
export function signUserToken({ userId, sessionId }) { return jwt.sign({ sub: String(userId), sid: String(sessionId), role: 'user' }, userJwtSecret(), { expiresIn: `${env.userTokenTtlDays}d` }); }
export function verifyUserToken(token) { try { return jwt.verify(token, userJwtSecret()); } catch { return null; } }
export function randomToken() { return crypto.randomBytes(32).toString('base64url'); }
export function hashToken(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }
