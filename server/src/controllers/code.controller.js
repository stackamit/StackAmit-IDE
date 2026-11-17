import { runSchema, validate } from '../validators/code.validator.js';
import { executeCode, providerStatus } from '../services/execution.service.js';
import { lintCode as lintService } from '../services/lint.service.js';
import { env } from '../config/env.js';
import { isDatabaseConnected } from '../config/db.js';
import { ExecutionLog } from '../models/ExecutionLog.js';

// Fire-and-forget audit record. Source code and stdin are NEVER persisted —
// only non-sensitive metadata for the admin dashboard's usage stats.
function recordExecution(result, sourceCode, stdin) {
  if (!isDatabaseConnected()) return;
  ExecutionLog.create({
    language: result.language,
    provider: result.provider,
    status: result.status,
    success: result.success,
    exitCode: result.exitCode ?? null,
    executionTimeMs: result.executionTimeMs ?? null,
    sourceBytes: Buffer.byteLength(sourceCode || '', 'utf8'),
    stdinBytes: Buffer.byteLength(stdin || '', 'utf8'),
  }).catch(() => {
    /* auditing must never break the run response */
  });
}

/**
 * POST /api/code/run
 * Validates, executes through the configured provider, and returns the actual
 * result envelope. A program that compiles and runs but exits non-zero is a
 * real result (HTTP 200 with success:false), NOT an HTTP-level failure.
 * Provider/network/validation failures throw ApiError and are handled
 * upstream with meaningful status codes.
 */
export async function runCode(req, res, next) {
  try {
    const { language, sourceCode, stdin = '' } = validate(runSchema, req.body);
    const result = await executeCode({ language, sourceCode, stdin });
    recordExecution(result, sourceCode, stdin);
    res.status(200).json({ success: result.success, ...result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/execution/status
 * Whether the configured provider is reachable. No secrets or config details.
 */
export async function executionStatus(_req, res, next) {
  try {
    const status = await providerStatus();
    res.status(200).json({
      configured: status.configured,
      provider: status.name,
      available: Boolean(status.available),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/code/lint
 * Live, local syntax check for as-you-type error highlighting. Returns
 * { linted, available, markers:[{line,column,severity,message}] }. Never
 * persists anything and costs no provider quota (runs the local toolchain).
 */
export async function lintCode(req, res, next) {
  try {
    const language = String(req.body?.language || '');
    const sourceCode =
      typeof req.body?.sourceCode === 'string' ? req.body.sourceCode.slice(0, env.maxSourceBytes) : '';
    if (!language) {
      return res.status(400).json({ success: false, code: 'BAD_REQUEST', message: 'language is required' });
    }
    const result = await lintService(language, sourceCode);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}
