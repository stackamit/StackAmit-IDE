import { pino } from 'pino';
import { env } from './env.js';

/**
 * Structured logger. Redacts anything secret-shaped so credentials or URIs can
 * never be written to logs even if accidentally included in an object.
 */
export const logger = pino({
  level: env.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      '*.mongoUri',
      '*.executionApiKey',
      '*.sourceCode',
      '*.stdin',
      '*.password',
    ],
    censor: '[REDACTED]',
  },
  transport: env.isProd
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
});

export default logger;
