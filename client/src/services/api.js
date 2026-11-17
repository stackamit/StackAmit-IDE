import axios from 'axios';
import { localRunLanguages } from '../languages/languageCapabilities.js';

// The browser only ever talks to our own API — never to the execution provider.
const configuredApiUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
// A relative `/api` is valid only while the renderer is hosted by Vite or the
// web deployment. It cannot work from a packaged `file://` renderer, so do
// not mistake it for a configured desktop backend origin.
const baseURL = /^https?:\/\//i.test(configuredApiUrl) ? configuredApiUrl : '';

export const http = axios.create({
  baseURL: baseURL || undefined, // empty => relative "/api" via the dev proxy
  headers: { 'Content-Type': 'application/json' },
  timeout: 20000,
});

// A remote run is not a normal XHR: a cold compiled-language container (Go,
// Rust, C#, Haskell) legitimately takes 24-41s, and the API itself waits up to
// its EXECUTION_TIMEOUT_MS (90s). Waiting *longer* than the server means the
// user always gets the server's honest verdict instead of a browser abort.
const RUN_TIMEOUT_MS = 120000;

/**
 * Can remote execution even be reached from this page? Decided once, from the
 * build configuration and the document origin — never guessed at click time:
 *  - an absolute VITE_API_URL always works (packaged desktop app pointing at a
 *    server it was told about);
 *  - an http(s) origin works too, because the Vite dev proxy forwards /api;
 *  - a `file://` renderer with no configured URL has nothing to talk to, and the
 *    old silent failure (`/api/...` resolved against the filesystem) is exactly
 *    the bug this prevents.
 */
export function remoteRunAvailability() {
  if (baseURL) return { ok: true, target: baseURL };
  const origin = typeof window !== 'undefined' ? window.location?.origin || '' : '';
  if (/^https?:/i.test(origin)) return { ok: true, target: `${origin} (dev proxy)` };
  // The offline list is read from the capability registry, not hardcoded, so it
  // always names exactly what the packaged desktop app can run without a server
  // (Python, JavaScript, TypeScript, PowerShell, Java, C++) and never drifts
  // behind the runners it advertises.
  const offline = localRunLanguages()
    .map((l) => l.label)
    .filter(Boolean)
    .join(' / ');
  return {
    ok: false,
    code: 'NO_API_SERVER',
    message:
      `Online execution needs an API server, and none is configured for this build. Start the server and set VITE_API_URL when packaging, or run ${offline} offline in the desktop app.`,
  };
}

/** Normalize axios/network errors into a compact, user-safe descriptor. */
function toApiError(err) {
  if (err.response) {
    const data = err.response.data || {};
    return {
      status: err.response.status,
      code: data.code || 'HTTP_ERROR',
      message: data.message || 'The request failed.',
      details: data.details,
    };
  }
  if (axios.isCancel?.(err) || err.code === 'ERR_CANCELED' || err.name === 'CanceledError') {
    return { status: 0, code: 'CANCELED', message: 'The run was cancelled.' };
  }
  if (err.code === 'ECONNABORTED') {
    return { status: 0, code: 'TIMEOUT', message: `The API server did not answer within ${RUN_TIMEOUT_MS / 1000}s. It may be busy or the program may still be compiling.` };
  }
  return { status: 0, code: 'NETWORK', message: 'Network error — check your connection and the API server.' };
}

export const api = {
  async health() {
    try {
      const { data } = await http.get('/api/health');
      return data;
    } catch (err) {
      throw toApiError(err);
    }
  },

  async languages() {
    const { data } = await http.get('/api/languages');
    return data;
  },

  async executionStatus() {
    try {
      const { data } = await http.get('/api/execution/status');
      return data;
    } catch (err) {
      throw toApiError(err);
    }
  },

  /** Whether local interactive execution is enabled and which runtimes exist. */
  async interactiveStatus() {
    try {
      const { data } = await http.get('/api/interactive/status');
      return data;
    } catch (err) {
      throw toApiError(err);
    }
  },

  /** The command that installing a language's runtime would run (for consent). */
  async interactiveInstallPlan(language) {
    try {
      const { data } = await http.get(`/api/interactive/install/plan/${encodeURIComponent(language)}`);
      return data;
    } catch (err) {
      throw toApiError(err);
    }
  },

  /**
   * Run code through the backend. Resolves with the result envelope even for
   * compile/runtime errors (HTTP 200). Rejects with a normalized descriptor for
   * validation / rate-limit / provider failures. `signal` lets the UI Stop a
   * run that is still in flight.
   */
  async run({ language, sourceCode, stdin, signal }) {
    try {
      const { data } = await http.post('/api/code/run', { language, sourceCode, stdin }, { signal, timeout: RUN_TIMEOUT_MS });
      return data;
    } catch (err) {
      throw toApiError(err);
    }
  },

  /**
   * Live syntax check for as-you-type error highlighting. Resolves with
   * { linted, available, markers:[{line,column,severity,message}] }. Failures
   * are swallowed by the caller (the editor simply keeps its last markers).
   */
  async lint(language, sourceCode) {
    const { data } = await http.post('/api/code/lint', { language, sourceCode });
    return data;
  },

  async saveSnippet(payload) {
    const { data } = await http.post('/api/snippets', payload);
    return data;
  },

  async getSnippet(id) {
    const { data } = await http.get(`/api/snippets/${encodeURIComponent(id)}`);
    return data;
  },

  /** Public, admin-controlled site settings (banner, snippet availability). */
  async siteSettings() {
    const { data } = await http.get('/api/site/settings');
    return data.data || data;
  },

  /** Admin-controlled copy for the public pages (Home/About/Contact/social). */
  async siteContent() {
    const { data } = await http.get('/api/site/content');
    return data.data || data;
  },

  /** Submit the public contact form into the admin inbox. */
  async submitContact(payload) {
    const { data } = await http.post('/api/site/contact', payload);
    return data.data || data;
  },
};
