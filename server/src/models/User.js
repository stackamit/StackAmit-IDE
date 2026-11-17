import { Schema, model } from 'mongoose';

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  displayName: { type: String, trim: true, maxlength: 80, default: '' },
  preferences: { theme: { type: String, enum: ['dark', 'light'], default: 'dark' } },
  status: { type: String, enum: ['active', 'suspended', 'pending_verification'], default: 'active' },
  emailVerifiedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

export const User = model('User', userSchema);
