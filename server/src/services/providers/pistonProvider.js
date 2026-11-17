import { env } from '../../config/env.js';
import { jsonFetch, authHeaders, truncate } from './http.js';

const BASE = () => env.pistonApiUrl.replace(/\/+$/, '');

/**
 * Piston-compatible execution adapter.
 *
 * The public emkc.org instance is whitelist-only as of 2026, so this adapter
 * is intended for a self-hosted or otherwise authorized Piston deployment
 * configured via PISTON_API_URL / EXECUTION_API_KEY. The request/response
 * contract follows Piston v2 (/execute).
 */
export const pistonProvider = {
  name: 'piston',

  async health() {
    try {
      const runtimes = await jsonFetch(`${BASE()}${env.pistonRuntimesPath}`, {
        headers: authHeaders(),
        timeoutMs: 8000,
      });
      return { available: Array.isArray(runtimes), runtimes };
    } catch (err) {
      return { available: false, reason: err.code || 'UNKNOWN', message: err.message };
    }
  },

  async listSupported() {
    try {
      const runtimes = await jsonFetch(`${BASE()}${env.pistonRuntimesPath}`, {
        headers: authHeaders(),
        timeoutMs: 8000,
      });
      return Array.isArray(runtimes) ? runtimes : [];
    } catch {
      return [];
    }
  },

  async run({ lang, sourceCode, stdin }) {
    const payload = {
      language: lang.piston.language,
      version: lang.piston.version,
      files: [{ name: lang.fileName, content: sourceCode }],
      stdin: stdin || '',
      compile: { timeout: 10 },
      run: { stdin: stdin || '', args: [] },
    };

    const res = await jsonFetch(`${BASE()}${env.pistonRunPath}`, {
      method: 'POST',
      headers: authHeaders(),
      body: payload,
    });

    const compile = res.compile || {};
    const run = res.run || {};
    const compileMessage = truncate(compile.output || '');
    const exitCode = typeof run.code === 'number' ? run.code : (compile.code || 0);
    const stdout = truncate(run.stdout || '');
    const rawStderr = run.stderr !== undefined ? run.stderr : (run.output && !run.stdout ? run.output : '');
    const stderr = truncate(rawStderr || '');
    const compiled = Object.keys(compile).length > 0;
    const compileFailed = compiled && compile.code !== 0;

    const timeSec = typeof run.time === 'number' ? run.time : 0;

    let status = 'completed';
    if (compileFailed) status = 'compile_error';
    else if (run.signal && run.signal !== null) status = run.signal === 'SIGTERM' ? 'timeout' : 'runtime_error';
    else if (exitCode !== 0) status = 'runtime_error';

    return {
      success: status === 'completed',
      status,
      stdout,
      stderr: compileFailed ? compileMessage : stderr,
      compileMessage,
      exitCode,
      executionTimeMs: Math.round(timeSec * 1000),
      runtime: `${res.language || lang.piston.language}@${res.version || lang.piston.version}`,
    };
  },
};
