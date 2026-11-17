import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Strict limiter for the code-execution endpoint. Application-side only — it
 * does not replace provider quotas, but it blunt-limits abuse and runaway
 * upstream load.
 */
export const executionLimiter = rateLimit({
  windowMs: env.rateWindowMs,
  max: env.rateMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    status: 'error',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many execution requests. Please wait a moment before running again.',
  },
});

/** A gentler limiter for read-only metadata endpoints. */
export const apiLimiter = rateLimit({
  windowMs: env.rateWindowMs,
  max: Math.max(env.rateMax * 10, 100),
  standardHeaders: true,
  legacyHeaders: false,
});

export const aiLimiter = rateLimit({
  windowMs: env.aiRateWindowMs,
  max: env.aiRateMax,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Limiter for the live syntax-check endpoint. Local + cheap, but the client
 * debounces typing into it, so allow a generous burst without overloading.
 */
export const lintLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Brute-force protection for the admin login endpoint. Only a single admin
 * account exists, so repeated failures are throttled hard.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    status: 'error',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many login attempts. Please wait before trying again.',
  },
});

export const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, status: 'error', code: 'RATE_LIMIT_EXCEEDED', message: 'Too many verification requests. Please wait before trying again.' },
});

export const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, status: 'error', code: 'RATE_LIMIT_EXCEEDED', message: 'Too many password reset requests. Please wait before trying again.' },
});

/**
 * Contact-form limiter: generous for real users, tight enough to deter spam.
 */
export const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    status: 'error',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many messages sent. Please try again later.',
  },
});
