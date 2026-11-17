import { Schema, model } from 'mongoose';

const credentialSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  providerId: { type: String, required: true, lowercase: true, trim: true },
  encryptedApiKey: {
    ciphertext: { type: String, required: false, select: false },
    iv: { type: String, required: false, select: false },
    tag: { type: String, required: false, select: false },
    keyVersion: { type: String, required: true, default: 'v1' },
  },
  maskedApiKey: { type: String, default: '' },
  enabled: { type: Boolean, default: true },
  baseUrl: { type: String, default: '' },
  defaultModel: { type: String, default: '' },
  status: { type: String, enum: ['not_tested', 'connected', 'invalid', 'unavailable'], default: 'not_tested' },
  lastHealthCheckAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

credentialSchema.index({ userId: 1, providerId: 1 }, { unique: true });

export const UserProviderCredential = model('UserProviderCredential', credentialSchema);
