import { verifyToken } from '../config/auth.js';
import { ApiError, ErrorCodes } from '../utils/ApiError.js';

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  // Also accept a same-site cookie so browser sessions survive reload.
  const cookies = req.headers.cookie || '';
  const match = /(?:^|;\s*)stackamit_admin=([^;]+)/.exec(cookies);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Guards admin-only routes. Accepts a Bearer token or the `stackamit_admin`
 * cookie. Never reveals whether a token was malformed vs. missing.
 */
export function requireAdmin(req, _res, next) {
  const token = extractToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.role !== 'admin') {
    return next(new ApiError('Authentication required.', { status: 401, code: ErrorCodes.UNAUTHORIZED }));
  }
  req.admin = { username: process.env.ADMIN_USERNAME };
  return next();
}
