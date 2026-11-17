import { Schema, model } from 'mongoose';

const authTokenSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
  type: { type: String, enum: ['email_verification', 'password_reset'], required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, index: true },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AuthToken = model('AuthToken', authTokenSchema);
