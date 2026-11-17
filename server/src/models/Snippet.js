import crypto from 'node:crypto';
import { Schema, model } from 'mongoose';
import { LANGUAGE_KEYS } from '../config/languages.js';

/** Unpredictable, URL-safe id so private/public snippets are not enumerable. */
export function generateSnippetId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

const snippetSchema = new Schema(
  {
    _id: { type: String, default: generateSnippetId },
    language: { type: String, required: true, enum: LANGUAGE_KEYS },
    sourceCode: { type: String, required: true },
    title: { type: String, trim: true, maxlength: 120, default: '' },
    isPublic: { type: Boolean, default: true },
    // NOTE: stdin / stdout are intentionally NOT persisted by default.
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

// Mongo background job removes expired snippets automatically.
snippetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Snippet = model('Snippet', snippetSchema);
