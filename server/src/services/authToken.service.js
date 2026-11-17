import { AuthToken } from '../models/AuthToken.js';
import { hashToken, randomToken } from '../config/userAuth.js';

export async function issueAuthToken(userId, type, ttlMs) {
  await AuthToken.updateMany({ userId, type, consumedAt: null }, { $set: { consumedAt: new Date() } });
  const raw = randomToken();
  const record = await AuthToken.create({ userId, type, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) });
  return { raw, record };
}

export async function consumeAuthToken(raw, type) {
  if (!raw || typeof raw !== 'string' || raw.length > 256) return null;
  return AuthToken.findOneAndUpdate(
    { tokenHash: hashToken(raw), type, consumedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { consumedAt: new Date() } },
    { new: true },
  ).lean();
}
