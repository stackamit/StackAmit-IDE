import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { UserSession } from '../models/UserSession.js';
import { AuthToken } from '../models/AuthToken.js';
import { env } from '../config/env.js';
import { hashToken, randomToken, signUserToken } from '../config/userAuth.js';
import { ApiError } from '../utils/ApiError.js';
import { issueAuthToken, consumeAuthToken } from '../services/authToken.service.js';
import { sendEmail } from '../services/email.service.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function safeUser(user) { return { id: String(user._id), email: user.email, status: user.status, emailVerified: Boolean(user.emailVerifiedAt), createdAt: user.createdAt, displayName: user.displayName || '', preferences: user.preferences || { theme: 'dark' } }; }
function csrfCookie(res) { const token = randomToken(); res.cookie('stackamit_csrf', token, { sameSite: 'lax', secure: env.isProd, httpOnly: false, maxAge: env.userTokenTtlDays * 86400000, path: '/' }); return token; }
function sessionCookie(res, token) { res.cookie('stackamit_user', token, { sameSite: 'lax', secure: env.isProd, httpOnly: true, maxAge: env.userTokenTtlDays * 86400000, path: '/' }); csrfCookie(res); }

export function csrf(_req, res) { csrfCookie(res); return res.json({ ok: true }); }

async function registerAccount(req) {
  if (!env.userJwtSecret) throw new ApiError('User authentication is not configured.', { status: 503, code: 'USER_AUTH_NOT_CONFIGURED' });
  const email = String(req.body?.email || '').trim().toLowerCase(); const password = String(req.body?.password || '');
  if (!emailPattern.test(email) || email.length > 254) throw new ApiError('Enter a valid email address.', { status: 400, code: 'INVALID_EMAIL' });
  if (password.length < 10 || password.length > 128) throw new ApiError('Password must contain 10 to 128 characters.', { status: 400, code: 'INVALID_PASSWORD' });
  const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
  const user = await User.create({ email, passwordHash, status: 'pending_verification' });
  try {
    await sendVerificationEmail(user);
  } catch (error) {
    await Promise.allSettled([
      AuthToken.deleteMany({ userId: user._id, type: 'email_verification' }),
      User.deleteOne({ _id: user._id }),
    ]);
    throw error;
  }
  return user;
}

export async function register(req, res, next) {
  try {
    const user = await registerAccount(req);
    return res.status(201).json({ user: safeUser(user), verificationRequired: true });
  } catch (error) { if (error?.code === 11000) return next(new ApiError('An account with that email already exists.', { status: 409, code: 'EMAIL_EXISTS' })); return next(error); }
}

// Desktop registration uses the same validation, verification and cleanup flow
// as web registration, but is called by the trusted main-process bridge rather
// than relying on file:// renderer cookies or relative Axios URLs.
export async function desktopRegister(req, res, next) {
  try {
    const user = await registerAccount(req);
    return res.status(201).json({ user: safeUser(user), verificationRequired: true });
  } catch (error) { if (error?.code === 11000) return next(new ApiError('An account with that email already exists.', { status: 409, code: 'EMAIL_EXISTS' })); return next(error); }
}

export async function login(req, res, next) {
  try {
    if (!env.userJwtSecret) throw new ApiError('User authentication is not configured.', { status: 503, code: 'USER_AUTH_NOT_CONFIGURED' });
    const email = String(req.body?.email || '').trim().toLowerCase(); const password = String(req.body?.password || '');
    const user = await findValidUser(email, password);
    const session = await createSession(user, req, res);
    return res.json({ user: safeUser(user), session: { expiresAt: session.expiresAt } });
  } catch (error) { return next(error); }
}

export async function desktopLogin(req, res, next) {
  try {
    if (!env.userJwtSecret) throw new ApiError('User authentication is not configured.', { status: 503, code: 'USER_AUTH_NOT_CONFIGURED' });
    const email = String(req.body?.email || '').trim().toLowerCase(); const password = String(req.body?.password || '');
    const user = await findValidUser(email, password);
    const session = await createSession(user, req, res, { setCookie: false });
    return res.json({ user: safeUser(user), accessToken: session.authToken, session: { expiresAt: session.expiresAt } });
  } catch (error) { return next(error); }
}

async function createSession(user, req, res, { setCookie = true } = {}) {
  const session = new UserSession({ userId: user._id, tokenHash: 'pending', expiresAt: new Date(Date.now() + env.userTokenTtlDays * 86400000), userAgent: String(req.get('user-agent') || '').slice(0, 300) });
  const token = signUserToken({ userId: user._id, sessionId: session._id });
  session.tokenHash = hashToken(token); await session.save(); if (setCookie) sessionCookie(res, token); session.authToken = token; return session;
}

async function findValidUser(email, password) {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(password, user.passwordHash)) || user.status !== 'active') {
    throw new ApiError('Invalid email or password.', { status: 401, code: 'INVALID_LOGIN' });
  }
  return user;
}

function accountUrl(path, token) {
  const origin = String(env.clientUrl || 'http://localhost:5173').replace(/\/$/, '');
  return `${origin}${path}?token=${encodeURIComponent(token)}`;
}

async function sendVerificationEmail(user) {
  const { raw } = await issueAuthToken(user._id, 'email_verification', env.emailVerificationTtlHours * 3600000);
  await sendEmail({
    to: user.email,
    subject: 'Verify your StackAmit account',
    text: `Verify your StackAmit account using this link:\n\n${accountUrl('/account/verify', raw)}\n\nThis link expires in ${env.emailVerificationTtlHours} hours and can only be used once.`,
  });
}

export async function verifyEmail(req, res, next) {
  try {
    const token = String(req.body?.token || req.query?.token || '');
    const record = await consumeAuthToken(token, 'email_verification');
    if (!record) throw new ApiError('This verification link is invalid or expired.', { status: 400, code: 'INVALID_VERIFICATION_TOKEN' });
    const user = await User.findOneAndUpdate(
      { _id: record.userId, status: 'pending_verification', emailVerifiedAt: null },
      { $set: { status: 'active', emailVerifiedAt: new Date(), updatedAt: new Date() } },
      { new: true },
    ).lean();
    if (!user) throw new ApiError('This verification link is invalid or expired.', { status: 400, code: 'INVALID_VERIFICATION_TOKEN' });
    return res.json({ user: safeUser(user), verified: true });
  } catch (error) { return next(error); }
}

export async function resendVerification(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await User.findOne({ email }).lean();
    // Always return the same response so account existence is not disclosed.
    if (user?.status === 'pending_verification') await sendVerificationEmail(user);
    return res.status(202).json({ ok: true, message: 'If the account requires verification, an email will be sent.' });
  } catch (error) { return next(error); }
}

export async function requestPasswordReset(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = await User.findOne({ email }).lean();
    if (user && user.status !== 'suspended') {
      const { raw } = await issueAuthToken(user._id, 'password_reset', env.passwordResetTtlMinutes * 60000);
      await sendEmail({
        to: user.email,
        subject: 'Reset your StackAmit password',
        text: `Reset your StackAmit password using this link:\n\n${accountUrl('/account/reset-password', raw)}\n\nThis link expires in ${env.passwordResetTtlMinutes} minutes and can only be used once.`,
      });
    }
    return res.status(202).json({ ok: true, message: 'If an account matches that email, reset instructions will be sent.' });
  } catch (error) { return next(error); }
}

export async function resetPassword(req, res, next) {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (password.length < 10 || password.length > 128) throw new ApiError('Password must contain 10 to 128 characters.', { status: 400, code: 'INVALID_PASSWORD' });
    const record = await consumeAuthToken(token, 'password_reset');
    if (!record) throw new ApiError('This password reset link is invalid or expired.', { status: 400, code: 'INVALID_RESET_TOKEN' });
    const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
    const user = await User.findOneAndUpdate({ _id: record.userId, status: { $ne: 'suspended' } }, { $set: { passwordHash, updatedAt: new Date() } }, { new: true }).lean();
    if (!user) throw new ApiError('This password reset link is invalid or expired.', { status: 400, code: 'INVALID_RESET_TOKEN' });
    await UserSession.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    return res.json({ ok: true });
  } catch (error) { return next(error); }
}

export async function me(req, res) { return res.json({ user: req.user }); }

export async function updateProfile(req, res, next) {
  try {
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'displayName')) {
      if (typeof req.body.displayName !== 'string' || req.body.displayName.trim().length > 80) throw new ApiError('Display name must be 80 characters or fewer.', { status: 400, code: 'INVALID_PROFILE' });
      updates.displayName = req.body.displayName.trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'theme')) {
      if (!['dark', 'light'].includes(req.body.theme)) throw new ApiError('Theme must be dark or light.', { status: 400, code: 'INVALID_PROFILE' });
      updates['preferences.theme'] = req.body.theme;
    }
    if (!Object.keys(updates).length) throw new ApiError('No supported profile changes were provided.', { status: 400, code: 'INVALID_PROFILE' });
    const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true, runValidators: true }).lean();
    if (!user) throw new ApiError('Account unavailable.', { status: 404, code: 'USER_NOT_FOUND' });
    return res.json({ user: safeUser(user) });
  } catch (error) { return next(error); }
}

export async function logout(req, res, next) {
  try { await UserSession.updateOne({ _id: req.userSessionId, userId: req.user.id }, { $set: { revokedAt: new Date() } }); res.clearCookie('stackamit_user', { httpOnly: true, sameSite: 'lax', secure: env.isProd, path: '/' }); res.clearCookie('stackamit_csrf', { sameSite: 'lax', secure: env.isProd, path: '/' }); return res.json({ ok: true }); } catch (error) { return next(error); }
}
