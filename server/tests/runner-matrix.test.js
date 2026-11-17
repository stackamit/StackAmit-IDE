import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Online-runner matrix — deterministic, offline, one block per registered
 * runner.
 *
 * Every language in `server/src/config/languages.js` is exercised through the
 * real service → provider → HTTP-client path with `fetch` stubbed, so this
 * proves the parts that are *ours*: that the request carries the right provider
 * compiler id, that stdout/stderr/exit/compile output are mapped honestly, and
 * that provider-side failures are reported as provider failures.
 *
 * Live provider behaviour (does the compiler actually exist and run) is covered
 * separately by `integration.test.js` under RUN_INTEGRATION=1. A green test
 * here never means the remote compiler worked — it means our wiring is right.
 */

// env.js caches configuration at import time, so it must be set first.
process.env.EXECUTION_PROVIDER = 'wandbox';
process.env.NODE_ENV = 'test';
process.env.EXECUTION_TIMEOUT_MS = '250'; // keeps the aborted-request test quick

const { LANGUAGES, LANGUAGE_KEYS, getLanguage, listLanguageMetadata } = await import('../src/config/languages.js');
const { executeCode } = await import('../src/services/execution.service.js');
const { resolveProvider } = await import('../src/config/executionProvider.js');

/** Install a fetch stub; returns { restore, calls }. */
function stubCompile(makeResponse) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : undefined });
    const res = makeResponse({ url: String(url), body: calls.at(-1).body });
    if (res.__network) {
      // Simulate an aborted/never-answering request, honoring AbortController
      // exactly like a real fetch would.
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    const body = res.__raw ?? JSON.stringify(res.__json ?? {});
    return {
      ok: res.__status >= 200 && res.__status < 300,
      status: res.__status,
      headers: { get: () => 'application/json' },
      text: async () => body,
    };
  };
  return { restore: () => (globalThis.fetch = original), calls };
}

const ok = (program_output = '', extra = {}) => ({ __status: 200, __json: { status: '0', program_output, program_error: '', compiler_error: '', compiler_output: '', ...extra } });
const compileError = (compiler_error) => ({ __status: 200, __json: { status: '1', program_output: '', program_error: '', compiler_error, compiler_output: '' } });
const exitCode = (code, program_error = '') => ({ __status: 200, __json: { status: String(code), program_output: '', program_error, compiler_error: '', compiler_output: '' } });

// ---------------------------------------------------------------------------
// Registry integrity — the contract every downstream adapter relies on.
// ---------------------------------------------------------------------------
describe('runner registry', () => {
  test('has exactly the 18 documented online runners', () => {
    assert.deepEqual(
      [...LANGUAGE_KEYS].sort(),
      [
        'c', 'cpp', 'csharp', 'go', 'haskell', 'java', 'javascript', 'julia',
        'lua', 'pascal', 'perl', 'php', 'python', 'ruby', 'rust', 'shell',
        'sql', 'typescript',
      ].sort(),
    );
  });

  test('every entry is complete and unique', () => {
    const seen = new Set();
    for (const l of LANGUAGES) {
      assert.ok(l.key && l.label && l.monaco && l.fileName && l.starter, `incomplete entry: ${l.key}`);
      assert.ok(!seen.has(l.key), `duplicate key ${l.key}`);
      seen.add(l.key);
      // At least one provider must actually be able to run it.
      assert.ok(l.wandbox || l.piston, `${l.key} has no provider runtime`);
      assert.equal(getLanguage(l.key), l, `${l.key} lookup`);
    }
  });

  test('GET /api/languages metadata exposes label + runtime per provider', () => {
    const w = listLanguageMetadata('wandbox');
    assert.equal(w.length, LANGUAGES.length);
    for (const meta of w) {
      const lang = getLanguage(meta.key);
      assert.equal(meta.label, lang.label);
      assert.equal(meta.monaco, lang.monaco);
      assert.equal(meta.fileName, lang.fileName);
      if (lang.wandbox) {
        assert.equal(meta.version, lang.wandbox.label);
        assert.equal(meta.runtimeId, lang.wandbox.compiler);
      } else {
        assert.equal(meta.version, null);
      }
    }
    // Piston ids are only published where they were verified.
    const p = listLanguageMetadata('piston');
    for (const meta of p) {
      const lang = getLanguage(meta.key);
      assert.equal(meta.version, lang.piston ? lang.piston.label : null);
    }
  });

  test('unknown language keys are refused before any provider call', async () => {
    const { restore, calls } = stubCompile(() => ok());
    try {
      await assert.rejects(() => executeCode({ language: 'brainfuck', sourceCode: '+', stdin: '' }), (err) => {
        assert.equal(err.code, 'UNSUPPORTED_LANGUAGE');
        assert.equal(err.status, 400);
        return true;
      });
      assert.equal(calls.length, 0, 'must not reach the network');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Per-runner matrix.
// ---------------------------------------------------------------------------
for (const lang of LANGUAGES) {
  describe(`runner: ${lang.key} (${lang.label})`, () => {
    test('sends its own compiler id and maps stdout as a completed run', async () => {
      const { restore, calls } = stubCompile(() => ok(`ran:${lang.key}\n`));
      try {
        const r = await executeCode({ language: lang.key, sourceCode: lang.starter, stdin: 'matrix-stdin' });
        const post = calls.find((c) => c.url.includes('/compile.json'));
        assert.ok(post, 'no provider request issued');
        assert.equal(post.body.compiler, lang.wandbox.compiler);
        assert.equal(post.body.code, lang.starter);
        assert.equal(post.body.stdin, 'matrix-stdin');
        assert.equal(r.status, 'completed');
        assert.equal(r.success, true);
        assert.equal(r.stdout, `ran:${lang.key}\n`);
        assert.equal(r.exitCode, 0);
        assert.equal(r.language, lang.key);
        assert.equal(r.provider, 'wandbox');
        // Wandbox gives no duration, so we must not invent one.
        assert.equal(r.executionTimeMs, null);
      } finally {
        restore();
      }
    });

    test('compiler errors are reported as compile_error, never as success', async () => {
      const { restore } = stubCompile(() => compileError(`${lang.fileName}:1: syntax error`));
      try {
        const r = await executeCode({ language: lang.key, sourceCode: 'broken', stdin: '' });
        assert.equal(r.status, 'compile_error');
        assert.equal(r.success, false);
        assert.match(r.compileMessage, /syntax error/);
        assert.equal(r.stderr, r.compileMessage, 'compile output must also surface in stderr');
      } finally {
        restore();
      }
    });

    test('non-zero exit is a runtime_error carrying the real exit code', async () => {
      const { restore } = stubCompile(() => exitCode(3, `${lang.key} blew up`));
      try {
        const r = await executeCode({ language: lang.key, sourceCode: 'x', stdin: '' });
        assert.equal(r.status, 'runtime_error');
        assert.equal(r.success, false);
        assert.equal(r.exitCode, 3);
        assert.equal(r.stderr, `${lang.key} blew up`);
      } finally {
        restore();
      }
    });

    test('a failure printed only on stdout still reaches the user as a failure', async () => {
      // Live evidence (php-8.3.12, 2026-10-21): a PHP parse error arrives as
      // program_output with status 255 while compiler_error and program_error
      // stay empty. The UI must not present that as a normal run.
      const { restore } = stubCompile(() => ({
        __status: 200,
        __json: {
          status: '255',
          program_output: 'Parse error: syntax error, unexpected token ";"',
          program_error: '',
          compiler_error: '',
          compiler_output: '',
        },
      }));
      try {
        const r = await executeCode({ language: lang.key, sourceCode: 'broken', stdin: '' });
        assert.equal(r.success, false);
        assert.equal(r.status, 'runtime_error');
        assert.equal(r.exitCode, 255);
        const visible = `${r.compileMessage}${r.stderr}${r.stdout}`.trim();
        assert.match(visible, /error/i, `${lang.key}: failure carried no diagnosable text`);
      } finally {
        restore();
      }
    });

    test('a program that runs past the provider limit is reported as a timeout', async () => {
      // Verified live: Wandbox answers an over-limit program with HTTP 504 and
      // the plain-text body "error code: 504" — not JSON.
      const { restore } = stubCompile(() => ({ __status: 504, __raw: 'error code: 504' }));
      try {
        await assert.rejects(() => executeCode({ language: lang.key, sourceCode: 'while True: pass', stdin: '' }), (err) => {
          assert.equal(err.code, 'UPSTREAM_TIMEOUT');
          assert.equal(err.status, 504);
          assert.match(err.message, /time limit/i);
          return true;
        });
      } finally {
        restore();
      }
    });

    test('provider outage is reported as unavailable, not as a compiler error', async () => {
      const { restore } = stubCompile(() => ({ __status: 500, __json: { message: 'boom' } }));
      try {
        await assert.rejects(() => executeCode({ language: lang.key, sourceCode: 'x', stdin: '' }), (err) => {
          assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
          assert.equal(err.status, 502);
          return true;
        });
      } finally {
        restore();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Cross-cutting transport behaviour.
// ---------------------------------------------------------------------------
describe('provider transport', () => {
  test('aborted outbound request becomes an UPSTREAM_TIMEOUT', async () => {
    const { restore } = stubCompile(() => ({ __network: true }));
    try {
      await assert.rejects(() => executeCode({ language: 'python', sourceCode: 'print(1)', stdin: '' }), (err) => {
        assert.equal(err.code, 'UPSTREAM_TIMEOUT');
        assert.equal(err.status, 504);
        return true;
      });
    } finally {
      restore();
    }
  });

  test('provider throttling (429) is reported as quota pressure', async () => {
    const { restore } = stubCompile(() => ({ __status: 429, __json: { message: 'slow down' } }));
    try {
      await assert.rejects(() => executeCode({ language: 'python', sourceCode: 'print(1)', stdin: '' }), (err) => {
        assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
        assert.match(err.message, /rate-limiting/i);
        return true;
      });
    } finally {
      restore();
    }
  });

  test('a 200 response that is not JSON is reported as unavailable', async () => {
    const { restore } = stubCompile(() => ({ __status: 200, __raw: '<html>proxy blocked</html>' }));
    try {
      await assert.rejects(() => executeCode({ language: 'python', sourceCode: 'print(1)', stdin: '' }), (err) => {
        assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
        assert.equal(err.status, 502);
        return true;
      });
    } finally {
      restore();
    }
  });

  test('oversized program output is truncated, not silently dropped', async () => {
    const { restore } = stubCompile(() => ok('x'.repeat(70000)));
    try {
      const r = await executeCode({ language: 'python', sourceCode: 'print(1)', stdin: '' });
      assert.equal(r.status, 'completed');
      assert.ok(r.stdout.length < 70000, 'output was not capped');
      assert.match(r.stdout, /truncated at 65536 bytes by StackAmit-IDE/);
    } finally {
      restore();
    }
  });

  test('empty output stays an empty, successful result', async () => {
    const { restore } = stubCompile(() => ok(''));
    try {
      const r = await executeCode({ language: 'python', sourceCode: 'pass', stdin: '' });
      assert.equal(r.status, 'completed');
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, '');
    } finally {
      restore();
    }
  });

  test('provider health check tolerates an unreachable service', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND wandbox.org'), { code: 'ENOTFOUND' });
    };
    try {
      const health = await resolveProvider('wandbox').health();
      assert.equal(health.available, false);
      assert.ok(health.reason, 'reports a reason');
    } finally {
      globalThis.fetch = original;
    }
  });
});

// ---------------------------------------------------------------------------
// The Piston adapter stays honest about what it can and cannot run.
// ---------------------------------------------------------------------------
describe('piston adapter', () => {
  test('builds a v2 /execute request for languages with a verified runtime', async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url: String(url), body: JSON.parse(opts.body) });
      const body = {
        language: 'python',
        version: '3.10.0',
        compile: {},
        run: { stdout: '42\n', stderr: '', code: 0, signal: null, time: 0.12 },
      };
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) };
    };
    try {
      const piston = resolveProvider('piston');
      const r = await piston.run({ lang: getLanguage('python'), sourceCode: 'print(6*7)', stdin: '' });
      assert.equal(calls[0].url.endsWith('/execute'), true);
      assert.equal(calls[0].body.language, 'python');
      assert.equal(calls[0].body.version, '3.10.0');
      assert.equal(calls[0].body.files[0].name, 'main.py');
      assert.equal(r.status, 'completed');
      assert.equal(r.stdout, '42\n');
      assert.equal(r.executionTimeMs, 120);
      assert.equal(r.runtime, 'python@3.10.0');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('reports the languages it cannot run as unverified instead of faking them', () => {
    // Wandbox-verified runners that have no confirmed Piston id.
    const noPiston = LANGUAGES.filter((l) => !l.piston).map((l) => l.key);
    for (const key of ['go', 'rust', 'csharp', 'php', 'ruby', 'perl', 'lua', 'julia', 'haskell', 'sql', 'shell', 'pascal']) {
      assert.ok(noPiston.includes(key), `${key} unexpectedly claims a Piston runtime`);
    }
    assert.equal(noPiston.length, 12);
  });

  test('a compile failure and a SIGTERM are mapped to distinct statuses', async () => {
    const original = globalThis.fetch;
    const responses = [
      { language: 'c', version: '10.2.0', compile: { output: 'gcc: error', code: 1 }, run: {} },
      { language: 'c', version: '10.2.0', compile: {}, run: { stdout: '', stderr: '', code: 0, signal: 'SIGTERM', time: 5 } },
    ];
    let i = 0;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(responses[i++]),
    });
    try {
      const piston = resolveProvider('piston');
      const compile = await piston.run({ lang: getLanguage('c'), sourceCode: 'int main(){@@@}', stdin: '' });
      assert.equal(compile.status, 'compile_error');
      assert.equal(compile.success, false);
      const timedOut = await piston.run({ lang: getLanguage('c'), sourceCode: 'int main(){for(;;);}', stdin: '' });
      assert.equal(timedOut.status, 'timeout');
    } finally {
      globalThis.fetch = original;
    }
  });
});
