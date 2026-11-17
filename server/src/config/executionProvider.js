import { env } from './env.js';
import { pistonProvider } from '../services/providers/pistonProvider.js';
import { wandboxProvider } from '../services/providers/wandboxProvider.js';

const registry = {
  piston: pistonProvider,
  wandbox: wandboxProvider,
};

/**
 * Resolve the configured execution provider. Returns null when the configured
 * name is unknown, letting callers surface a clear setup message instead of
 * faking execution.
 */
export function resolveProvider(name = env.executionProvider) {
  return registry[name] || null;
}

export function providerName() {
  return env.executionProvider;
}

export { registry as providerRegistry };
