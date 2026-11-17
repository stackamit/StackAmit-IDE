/**
 * Application error carrying an HTTP status and a machine-readable code so the
 * global error handler and the frontend can distinguish failure categories
 * without ever leaking stack traces or provider internals.
 */
export class ApiError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

export const ErrorCodes = {
  VALIDATION: 'VALIDATION_ERROR',
  EMPTY_SOURCE: 'EMPTY_SOURCE',
  UNSUPPORTED_LANGUAGE: 'UNSUPPORTED_LANGUAGE',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMIT: 'RATE_LIMIT_EXCEEDED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  NOT_FOUND: 'NOT_FOUND',
  DB_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  SERVER_CONFIG: 'SERVER_CONFIG',
  INTERNAL: 'INTERNAL_ERROR',
};
