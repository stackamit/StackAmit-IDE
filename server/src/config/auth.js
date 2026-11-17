import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from './env.js';

/**
 * Ephemeral fallback secret so development works without configuration.
 * A production deploy must set ADMIN_JWT_SECRET (enforced in server.js).
 */
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

export function jwtSecret() {
  return env.adminJwtSecret || EPHEMERAL_SECRET;
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Compare against itself to keep constant time, then return false.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** True only when admin credentials are configured and match. */
export function verifyCredentials(username, password) {
  if (!env.adminUsername || !env.adminPassword) return false;
  const userOk = timingSafeEqualStr(username, env.adminUsername);
  const passOk = timingSafeEqualStr(password, env.adminPassword);
  return userOk && passOk;
}

export function authConfigured() {
  return Boolean(env.adminUsername && env.adminPassword);
}

export function signToken() {
  return jwt.sign({ sub: 'admin', role: 'admin' }, jwtSecret(), {
    expiresIn: `${env.adminTokenTtlHours}h`,
  });
}

/** Returns the token payload, or null if invalid/expired. */
export function verifyToken(token) {
  try {
    return jwt.verify(token, jwtSecret());
  } catch {
    return null;
  }
}
