import { Schema, model } from 'mongoose';

const sessionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  userAgent: { type: String, maxlength: 300 },
}, { versionKey: false });

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const UserSession = model('UserSession', sessionSchema);
