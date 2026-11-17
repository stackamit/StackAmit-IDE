import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load server/.env explicitly so the app works regardless of the launch cwd.
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const num = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: num(process.env.PORT, 5000),
  // Browser Origin values never contain a trailing slash. Normalize the
  // deployment setting so a harmless CLIENT_URL mismatch cannot break CORS
  // and the cookie-authenticated CSRF flow.
  clientUrl: String(process.env.CLIENT_URL || 'http://localhost:5173').trim().replace(/\/+$/, ''),
  // Netlify and Render are different sites in production, so browser user
  // sessions must be sent on credentialed cross-origin API requests. Local
  // development remains SameSite=Lax.
  userCookieSameSite: ((process.env.NODE_ENV || 'development') === 'production') ? 'none' : 'lax',
  mongoUri: process.env.MONGODB_URI || '',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Execution provider
  executionProvider: (process.env.EXECUTION_PROVIDER || 'wandbox').toLowerCase(),
  pistonApiUrl: process.env.PISTON_API_URL || 'https://emkc.org/api/v2/piston',
  pistonRunPath: process.env.PISTON_RUN_PATH || '/execute',
  pistonRuntimesPath: process.env.PISTON_RUNTIMES_PATH || '/runtimes',
  wandboxApiUrl: process.env.WANDBOX_API_URL || 'https://wandbox.org/api',
  wandboxCompilePath: process.env.WANDBOX_COMPILE_PATH || '/compile.json',
  wandboxListPath: process.env.WANDBOX_LIST_PATH || '/list.json',
  executionApiKey: process.env.EXECUTION_API_KEY || '',
  executionApiKeyHeader: process.env.EXECUTION_API_KEY_HEADER || '',
  // Cold compiled-language runs (Go/Rust/.NET/Julia/Haskell on the Wandbox free
  // tier) measured 24-41s wall clock in Oct 2026 verification, so the default
  // budget has to sit well above a minute or those runners always fail.
  executionTimeoutMs: num(process.env.EXECUTION_TIMEOUT_MS, 90000),

  // Application-side limits
  maxSourceBytes: num(process.env.MAX_SOURCE_BYTES, 65536),
  maxStdinBytes: num(process.env.MAX_STDIN_BYTES, 16384),
  maxOutputBytes: num(process.env.MAX_OUTPUT_BYTES, 65536),
  rateWindowMs: num(process.env.EXECUTION_RATE_LIMIT_WINDOW_MS, 60000),
  rateMax: num(process.env.EXECUTION_RATE_LIMIT_MAX, 10),
  aiRateWindowMs: num(process.env.AI_RATE_LIMIT_WINDOW_MS, 60000),
  aiRateMax: num(process.env.AI_RATE_LIMIT_MAX, 30),
  maxConcurrentExecutions: num(process.env.MAX_CONCURRENT_EXECUTIONS, 3),

  // Local interactive execution (WebSocket-backed live processes).
  // Enabled by default outside production so the local dev IDE can offer
  // "type when input() is called"; disabled in production unless opted in.
  localRunEnabled: bool(process.env.LOCAL_RUN_ENABLED, (process.env.NODE_ENV || 'development') !== 'production'),
  interactiveIdleTimeoutMs: num(process.env.INTERACTIVE_IDLE_TIMEOUT_MS, 120000),

  // Live, local syntax checking (as-you-type error highlighting). Gated by
  // localRunEnabled; uses the installed toolchain so it's cheap and offline.
  lintTimeoutMs: num(process.env.LINT_TIMEOUT_MS, 4000),

  // Snippets
  snippetEnabled: bool(process.env.SNIPPET_ENABLED, true),
  snippetTtlDays: num(process.env.SNIPPET_DEFAULT_TTL_DAYS, 30),
  snippetMaxCodeBytes: num(process.env.SNIPPET_MAX_CODE_BYTES, 65536),

  // Admin authentication (single admin account; no public registration)
  adminUsername: process.env.ADMIN_USERNAME || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminJwtSecret: process.env.ADMIN_JWT_SECRET || '',
  adminTokenTtlHours: num(process.env.ADMIN_TOKEN_TTL_HOURS, 12),

  // End-user authentication is intentionally separate from admin auth.
  userJwtSecret: process.env.USER_JWT_SECRET || '',
  userTokenTtlDays: num(process.env.USER_TOKEN_TTL_DAYS, 30),
  bcryptRounds: num(process.env.USER_BCRYPT_ROUNDS, 12),
  // AES-256-GCM key for user-owned provider credentials. This is deliberately
  // independent from provider API keys and must be supplied in production.
  aiCredentialEncryptionKey: process.env.AI_CREDENTIAL_ENCRYPTION_KEY || '',
  sendgridApiKey: process.env.SENDGRID_API_KEY || '',
  // Permit a human-readable inline comment in local .env files while keeping
  // the value sent to SendGrid a valid address/header.
  sendgridFromEmail: String(process.env.SENDGRID_FROM_EMAIL || '').replace(/\s+#.*$/, '').trim(),
  sendgridFromName: String(process.env.SENDGRID_FROM_NAME || 'StackAmit IDE').trim().slice(0, 120),
  emailVerificationTtlHours: num(process.env.EMAIL_VERIFICATION_TTL_HOURS, 24),
  passwordResetTtlMinutes: num(process.env.PASSWORD_RESET_TTL_MINUTES, 30),
};

/**
 * Origins the API accepts from browsers. The configured CLIENT_URL plus the
 * two loopback spellings of the Vite dev port (5173 in client/vite.config.js).
 * HTTP CORS and the interactive WebSocket handshake MUST check against this
 * same set — keeping the list here is what stops the two from drifting.
 */
export const ALLOWED_ORIGINS = new Set([
  env.clientUrl,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin); // no-Origin = same-origin/curl/tests
}

export default env;
