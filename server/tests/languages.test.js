import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadApp, stubFetch } from './helpers.js';
import { LANGUAGES, LANGUAGE_KEYS, getLanguage, listLanguageMetadata } from '../src/config/languages.js';
import { runSchema } from '../src/validators/code.validator.js';

/**
 * Registry integrity for the expanded (Oct 2026) language set. These checks
 * keep the single source of truth honest: no half-registered languages, no
 * provider entries that would crash an adapter on a null id.
 */
describe('language registry shape', () => {
  test('keys are unique and metadata is complete', () => {
    assert.equal(new Set(LANGUAGE_KEYS).size, LANGUAGE_KEYS.length);
    for (const l of LANGUAGES) {
      assert.ok(l.key && l.label && l.monaco && l.fileName, `incomplete entry: ${JSON.stringify(l)}`);
      assert.ok(l.starter && l.starter.trim().length > 0, `${l.key} has no starter program`);
      assert.ok(l.wandbox || l.piston, `${l.key} must be runnable on at least one configured provider`);
    }
  });

  test('wandbox compiler ids are non-empty strings', () => {
    for (const l of LANGUAGES) {
      if (l.wandbox) assert.equal(typeof l.wandbox.compiler, 'string');
    }
  });

  test('fileName extension matches the provider language family', () => {
    // The file name is what providers write to disk; a mismatch silently
    // breaks shebang-less interpreters like PHP or Rust.
    const expectedExt = {
      python: '.py', c: '.c', cpp: '.cpp', java: '.java', javascript: '.js', typescript: '.ts',
      go: '.go', rust: '.rs', csharp: '.cs', php: '.php', ruby: '.rb', perl: '.pl', lua: '.lua',
      julia: '.jl', haskell: '.hs', sql: '.sql', shell: '.sh', pascal: '.pas',
    };
    for (const [key, ext] of Object.entries(expectedExt)) {
      assert.ok(getLanguage(key).fileName.endsWith(ext), `${key} fileName should end with ${ext}`);
    }
  });

  test('metadata exposes no provider secrets and flags missing runtimes', () => {
    const meta = listLanguageMetadata('piston');
    for (const m of meta) {
      assert.ok(!('wandbox' in m) && !('piston' in m));
      const lang = getLanguage(m.key);
      if (!lang.piston) {
        assert.equal(m.version, null);
        assert.equal(m.runtimeId, null);
      }
    }
  });
});

describe('GET /api/languages — provider catalog cross-check', () => {
  let app;
  let restore;

  before(async () => {
    // A minimal catalog: only a handful of the registered ids exist.
    restore = stubFetch([
      ['/list.json', () => [200, [
        { name: 'cpython-3.11.10' },
        { name: 'go-1.23.2' },
        { name: 'nodejs-20.17.0' },
      ]]],
    ]);
    app = await loadApp('wandbox');
  });
  after(() => restore());

  test('marks languages the live catalog cannot run as unsupported', async () => {
    const res = await request(app).get('/api/languages');
    assert.equal(res.status, 200);
    const byKey = Object.fromEntries(res.body.languages.map((l) => [l.key, l]));
    assert.equal(byKey.python.supported, true);
    assert.equal(byKey.go.supported, true);
    // rust/php/... are registered but absent from the stub catalog.
    assert.equal(byKey.rust.supported, false);
    assert.equal(byKey.php.supported, false);
  });
});

describe('POST /api/code/run — expanded runners (mocked provider)', () => {
  let app;
  let restore;

  before(async () => {
    restore = stubFetch([
      ['/list.json', () => [200, [{ name: 'go-1.23.2' }, { name: 'sqlite-3.46.1' }, { name: 'dotnetcore-6.0.425' }]]],
      ['/compile.json', ({ opts }) => {
        const body = JSON.parse(opts.body);
        const out = {
          'go-1.23.2': 'go hello\n',
          'sqlite-3.46.1': '1\n',
          'dotnetcore-6.0.425': 'csharp hello\n',
        }[body.compiler];
        return [200, { status: '0', program_output: out, program_error: '', compiler_error: '', compiler: body.compiler }];
      }],
    ]);
    app = await loadApp('wandbox');
  });
  after(() => restore());

  test('accepts newly registered language keys', () => {
    // Schema level (no HTTP): keeps inside the endpoint's rate limit while
    // still proving every new key is wired through validation.
    for (const key of ['go', 'rust', 'csharp', 'php', 'ruby', 'perl', 'lua', 'julia', 'haskell', 'sql', 'shell', 'pascal']) {
      const parsed = runSchema.safeParse({ language: key, sourceCode: 'x' });
      assert.ok(parsed.success, `${key} rejected by runSchema: ${JSON.stringify(parsed.error?.issues)}`);
    }
  });

  test('returns real parsed output for the go runner', async () => {
    const res = await request(app).post('/api/code/run').send({ language: 'go', sourceCode: 'package main' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.stdout, 'go hello\n');
    assert.equal(res.body.runtime, 'go-1.23.2');
  });

  test('unknown languages are still rejected', async () => {
    const res = await request(app).post('/api/code/run').send({ language: 'brainfuck', sourceCode: '+' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });
});
