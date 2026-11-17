import { Schema, model } from 'mongoose';

/**
 * Lightweight execution audit record. Source code and stdin are NEVER stored —
 * only non-sensitive metadata, for the admin dashboard's usage statistics.
 */
const executionLogSchema = new Schema(
  {
    language: { type: String, required: true },
    provider: { type: String, required: true },
    status: { type: String, required: true },
    success: { type: Boolean, required: true },
    exitCode: { type: Number, default: null },
    executionTimeMs: { type: Number, default: null },
    sourceBytes: { type: Number, default: 0 },
    stdinBytes: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

executionLogSchema.index({ createdAt: -1 });
executionLogSchema.index({ language: 1, createdAt: -1 });

export const ExecutionLog = model('ExecutionLog', executionLogSchema);
