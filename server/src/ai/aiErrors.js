export class AiError extends Error {
  constructor(message, { code = 'AI_ERROR', status = 502, provider = null, cause = null } = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
    this.provider = provider;
    this.cause = cause;
  }
}

export function providerError(provider, response, fallback = 'AI provider request failed.') {
  const status = response?.status || 502;
  if (status === 401 || status === 403) return new AiError('Provider credentials were rejected.', { code: 'AI_AUTH_FAILED', status, provider });
  if (status === 404) return new AiError('The requested AI model or provider endpoint was not found.', { code: 'AI_MODEL_NOT_FOUND', status, provider });
  if (status === 429) return new AiError('The AI provider rate limit was reached.', { code: 'AI_RATE_LIMITED', status: 429, provider });
  return new AiError(fallback, { code: 'AI_PROVIDER_ERROR', status, provider });
}

export function normalizeAiError(error, provider = null) {
  if (error instanceof AiError) return error;
  if (error?.name === 'AbortError') return new AiError('The AI request was cancelled or timed out.', { code: 'AI_CANCELLED', status: 499, provider, cause: error });
  if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') return new AiError('The AI provider is unavailable.', { code: 'AI_UNAVAILABLE', status: 503, provider, cause: error });
  return new AiError('The AI provider request failed.', { code: 'AI_PROVIDER_ERROR', status: 502, provider, cause: error });
}
