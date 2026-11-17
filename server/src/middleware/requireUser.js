import crypto from 'node:crypto';
import { verifyUserToken, hashToken } from '../config/userAuth.js';
import { User } from '../models/User.js';
import { UserSession } from '../models/UserSession.js';
import { ApiError, ErrorCodes } from '../utils/ApiError.js';

function cookie(req, name) { const match = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || ''); return match ? decodeURIComponent(match[1]) : null; }
export function userToken(req) { const header = req.headers.authorization || ''; return header.startsWith('Bearer ') ? header.slice(7).trim() : cookie(req, 'stackamit_user'); }

export async function requireUser(req, _res, next) {
  const payload = verifyUserToken(userToken(req));
  if (!payload || payload.role !== 'user' || !payload.sub || !payload.sid) return next(new ApiError('Authentication required.', { status: 401, code: ErrorCodes.UNAUTHORIZED }));
  try {
    const session = await UserSession.findOne({ _id: payload.sid, tokenHash: hashToken(userToken(req)), userId: payload.sub, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
    if (!session) return next(new ApiError('Session expired or revoked.', { status: 401, code: ErrorCodes.UNAUTHORIZED }));
    const user = await User.findById(payload.sub).lean();
    if (!user || user.status !== 'active') return next(new ApiError('Account unavailable.', { status: 403, code: ErrorCodes.FORBIDDEN }));
    req.user = { id: String(user._id), email: user.email, role: 'user', status: user.status, emailVerified: Boolean(user.emailVerifiedAt), createdAt: user.createdAt, displayName: user.displayName || '', preferences: user.preferences || { theme: 'dark' } };
    req.userSessionId = String(session._id);
    return next();
  } catch (error) { return next(error); }
}

export function requireCsrf(req, _res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  // Bearer-authenticated desktop requests do not have ambient browser
  // credentials, so CSRF does not apply. Cookie-authenticated browser
  // requests must still provide the double-submit token.
  if ((req.headers.authorization || '').startsWith('Bearer ')) return next();
  const header = req.get('x-csrf-token'); const token = cookie(req, 'stackamit_csrf');
  if (!header || !token || header.length !== token.length || !crypto.timingSafeEqual(Buffer.from(header), Buffer.from(token))) return next(new ApiError('CSRF validation failed.', { status: 403, code: 'CSRF_FAILED' }));
  return next();
}
