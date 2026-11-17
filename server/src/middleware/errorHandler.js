import { env } from '../config/env.js';

/** 404 handler for unmatched routes. */
export function notFound(req, res, next) {
  res.status(404).json({
    success: false,
    status: 'error',
    code: 'NOT_FOUND',
    message: `Route ${req.originalUrl} not found.`,
  });
}

/**
 * Global error handler. Produces a consistent JSON error envelope and never
 * exposes stack traces, environment values, or provider internals to clients.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const log = req.log || console;
  // Do not log source code / stdin; err.message is safe.
  log.error({ err: { message: err.message, code: err.code, status: err.status } }, 'request failed');

  // Malformed JSON body from express.json().
  if (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err)) {
    return res.status(400).json({
      success: false,
      status: 'error',
      code: 'INVALID_JSON',
      message: 'Request body is not valid JSON.',
    });
  }

  // Unsupported content type / oversized payload from body parser.
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      status: 'error',
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Request payload is too large.',
    });
  }

  const status = Number.isInteger(err.status) ? err.status : 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message =
    status >= 500 && env.isProd && code === 'INTERNAL_ERROR'
      ? 'An unexpected error occurred. Please try again.'
      : err.message || 'An unexpected error occurred.';

  const body = { success: false, status: 'error', code, message };
  if (err.details) body.details = err.details;

  res.status(status).json(body);
}
