import { env } from '../../config/env.js';

/**
 * Thin JSON fetch wrapper with an abort-based timeout and normalized errors.
 * Never logs request bodies (source code / stdin) — see security notes in the
 * README.
 */
export async function jsonFetch(url, { method = 'GET', headers = {}, body, timeoutMs = env.executionTimeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();

    // Status is checked BEFORE parsing: a provider that fails with an HTML/plain
    // error page (Wandbox answers `error code: 504` for a program that ran past
    // its CPU limit) must still be reported by its status, not as "malformed
    // response" — otherwise a user's infinite loop looks like an outage.
    if (!res.ok) {
      const err = new Error(`Upstream responded with status ${res.status}`);
      err.code = res.status === 504 || res.status === 408 ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR';
      err.status = res.status;
      try {
        err.body = text ? JSON.parse(text) : undefined;
      } catch {
        err.bodyText = text.slice(0, 200);
      }
      throw err;
    }

    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      // 200 OK but not JSON — the provider is talking nonsense, say so plainly.
      const err = new Error('Upstream returned an unexpected non-JSON response');
      err.code = 'UPSTREAM_MALFORMED';
      err.status = res.status;
      err.bodyText = text.slice(0, 200);
      throw err;
    }

    return parsed;
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout = new Error('Upstream execution request timed out');
      timeout.code = 'UPSTREAM_TIMEOUT';
      throw timeout;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Auth headers shared by providers that require a server-side key. */
export function authHeaders() {
  if (!env.executionApiKey) return {};
  if (env.executionApiKeyHeader) {
    return { [env.executionApiKeyHeader]: env.executionApiKey };
  }
  return { Authorization: `Bearer ${env.executionApiKey}` };
}

export function truncate(text, max = env.maxOutputBytes) {
  if (typeof text !== 'string') return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n… [output truncated at ${max} bytes by StackAmit-IDE]`;
}
