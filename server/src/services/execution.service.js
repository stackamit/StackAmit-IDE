import { env } from '../config/env.js';
import { getLanguage } from '../config/languages.js';
import { resolveProvider } from '../config/executionProvider.js';
import { ApiError, ErrorCodes } from '../utils/ApiError.js';

/**
 * Minimal promise-based semaphore so we never exceed
 * MAX_CONCURRENT_EXECUTIONS outstanding upstream requests. This is an
 * application-side guard, not a substitute for provider-side quotas.
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) {
      this.active += 1;
      next();
    }
  }
}

const semaphore = new Semaphore(env.maxConcurrentExecutions);

/** Translate provider/network errors into stable, safe ApiError shapes. */
function mapUpstreamError(err) {
  if (err instanceof ApiError) return err;
  // The provider told us the run took too long (its own CPU/wall limit, answered
  // as HTTP 504/408) vs. our outbound request being aborted. Both are timeouts,
  // but only the first has a status — the user sees the same honest outcome.
  if (err.code === 'UPSTREAM_TIMEOUT') {
    return new ApiError(
      'Execution exceeded the time limit. Programs that loop forever (or cold compilers under load) are stopped here; run locally for longer jobs.',
      { status: 504, code: ErrorCodes.UPSTREAM_TIMEOUT },
    );
  }
  // A 429 from the provider is quota pressure, not a broken compiler.
  if (err.status === 429) {
    return new ApiError('The execution service is rate-limiting us right now. Wait a moment and run again.', {
      status: 503,
      code: ErrorCodes.PROVIDER_UNAVAILABLE,
    });
  }
  switch (err.code) {
    case 'UPSTREAM_ERROR':
    case 'UPSTREAM_MALFORMED': {
      // 401/403 from Piston means the public instance is whitelist-only.
      if (err.status === 401 || err.status === 403) {
        return new ApiError(
          'The configured execution provider requires authorization or a self-hosted instance.',
          { status: 503, code: ErrorCodes.PROVIDER_UNAVAILABLE },
        );
      }
      return new ApiError('The execution service is temporarily unavailable. Please retry shortly.', {
        status: 502,
        code: ErrorCodes.PROVIDER_UNAVAILABLE,
      });
    }
    default:
      // Network failure / DNS / connection reset from fetch.
      return new ApiError('Could not reach the execution service. Check your connection and retry.', {
        status: 502,
        code: ErrorCodes.PROVIDER_UNAVAILABLE,
      });
  }
}

export async function executeCode({ language, sourceCode, stdin }) {
  const provider = resolveProvider();
  if (!provider) {
    throw new ApiError(
      'No valid execution provider is configured. Set EXECUTION_PROVIDER to "wandbox" or "piston" and restart the server.',
      { status: 503, code: ErrorCodes.PROVIDER_UNAVAILABLE },
    );
  }

  const lang = getLanguage(language);
  if (!lang) {
    throw new ApiError('Unsupported language.', { status: 400, code: ErrorCodes.UNSUPPORTED_LANGUAGE });
  }
  // The registry may know a language for one provider but not the other
  // (e.g. Wandbox-verified runners without a confirmed Piston runtime id).
  // Report that honestly instead of letting the adapter crash on a null id.
  const runtimeForProvider = provider.name === 'piston' ? lang.piston : lang.wandbox;
  if (!runtimeForProvider) {
    throw new ApiError(
      `${lang.label} has no verified runtime on the ${provider.name} provider yet. Switch providers or use the desktop terminal.`,
      { status: 400, code: ErrorCodes.UNSUPPORTED_LANGUAGE },
    );
  }

  await semaphore.acquire();
  try {
    const result = await provider.run({ lang, sourceCode, stdin });
    return { ...result, language, provider: provider.name };
  } catch (err) {
    throw mapUpstreamError(err);
  } finally {
    semaphore.release();
  }
}

export async function providerStatus() {
  const provider = resolveProvider();
  if (!provider) {
    return { configured: false, name: env.executionProvider, available: false, reason: 'NOT_CONFIGURED' };
  }
  const health = await provider.health();
  return { configured: true, name: provider.name, ...health };
}
