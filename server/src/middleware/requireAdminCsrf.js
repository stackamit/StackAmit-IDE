import crypto from 'node:crypto';
import { ApiError } from '../utils/ApiError.js';

function cookie(req, name) {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '');
  return match ? decodeURIComponent(match[1]) : null;
}

export function requireAdminCsrf(req, _res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if ((req.headers.authorization || '').startsWith('Bearer ')) return next();
  const header = req.get('x-csrf-token');
  const token = cookie(req, 'stackamit_admin_csrf');
  if (!header || !token || header.length !== token.length || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(token))) {
    return next(new ApiError('CSRF validation failed.', { status: 403, code: 'CSRF_FAILED' }));
  }
  return next();
}
