import { env } from '../../config/env.js';
import { jsonFetch, authHeaders, truncate } from './http.js';

const BASE = () => env.wandboxApiUrl.replace(/\/+$/, '');

// Small in-memory cache for the (large, rarely changing) compiler list so we do
// not hammer the public service on every /api/languages or /api/execution/status.
let listCache = { at: 0, data: null };
const LIST_TTL_MS = 10 * 60 * 1000;

async function fetchCompilerList() {
  const now = Date.now();
  if (listCache.data && now - listCache.at < LIST_TTL_MS) return listCache.data;
  const data = await jsonFetch(`${BASE()}${env.wandboxListPath}`, { timeoutMs: 10000 });
  listCache = { at: now, data: Array.isArray(data) ? data : [] };
  return listCache.data;
}

/**
 * Wandbox execution adapter — a genuine, long-maintained public compile/run
 * service. Used as the default provider so the editor works out of the box,
 * with the understanding that it is a shared public endpoint with rate limits
 * and availability constraints (see README "Known limitations").
 */
export const wandboxProvider = {
  name: 'wandbox',

  async health() {
    try {
      const list = await fetchCompilerList();
      return { available: list.length > 0, runtimeCount: list.length };
    } catch (err) {
      return { available: false, reason: err.code || 'UNKNOWN', message: err.message };
    }
  },

  async listSupported() {
    try {
      return await fetchCompilerList();
    } catch {
      return [];
    }
  },

  async run({ lang, sourceCode, stdin }) {
    const payload = {
      compiler: lang.wandbox.compiler,
      code: sourceCode,
      stdin: stdin || '',
      save: false,
    };

    const res = await jsonFetch(`${BASE()}${env.wandboxCompilePath}`, {
      method: 'POST',
      headers: authHeaders(),
      body: payload,
    });

    // Wandbox: status "0" means the process exited cleanly.
    const exitCode = Number.parseInt(res.status ?? '0', 10);
    const compileMessage = truncate(res.compiler_error || res.compiler_output || '');
    const stdout = truncate(res.program_output || '');
    const stderr = truncate(res.program_error || '');
    const compileFailed = Boolean(res.compiler_error);
    // Wandbox is a batch provider. A program that calls input() without any
    // staged stdin receives EOF; expose that fact explicitly so the client can
    // guide the user to the pre-run input field instead of reporting only a
    // generic runtime failure.
    const inputRequired = !stdin && /EOFError|EOF when reading a line|end[- ]of[- ]file/i.test(`${stdout}\n${stderr}`);

    let status = 'completed';
    if (compileFailed) status = 'compile_error';
    else if (inputRequired) status = 'input_required';
    else if (res.signal) status = /timeout/i.test(res.signal) ? 'timeout' : 'runtime_error';
    else if (exitCode !== 0) status = 'runtime_error';

    // Wandbox does not report an execution duration, so it is intentionally
    // omitted rather than fabricated.
    return {
      success: status === 'completed',
      status,
      stdout,
      stderr: compileFailed ? compileMessage : stderr,
      compileMessage,
      inputRequired,
      exitCode,
      executionTimeMs: null,
      runtime: res.compiler || lang.wandbox.compiler,
    };
  },
};
