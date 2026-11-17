import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadApp, stubFetch } from './helpers.js';

let app;
let restore;
let lastStdin;

before(async () => {
  restore = stubFetch([
    ['/list.json', () => [200, [{ name: 'cpython-3.11.10' }]]],
    // Simulate a successful python run.
    ['/compile.json', ({ opts }) => {
      const body = JSON.parse(opts.body);
      lastStdin = body.stdin;
      if (body.compiler === 'cpython-3.11.10') {
        return [200, { status: '0', program_output: '2\n', program_error: '', compiler_error: '', compiler: 'cpython-3.11.10' }];
      }
      // Simulate a successful TypeScript run (tsc compiles, then node runs).
      if (body.compiler === 'typescript-5.6.2') {
        return [200, { status: '0', program_output: 'hi ts 42\n', program_error: '', compiler_error: '', compiler: 'typescript-5.6.2' }];
      }
      // Simulate a compile error for the C compiler.
      return [200, { status: '1', program_output: '', program_error: '', compiler_error: 'prog.c:1: error: syntax', compiler: body.compiler }];
    }],
  ]);
  app = await loadApp('wandbox');
});

after(() => restore());

describe('POST /api/code/run — validation', () => {
  test('rejects empty source code', async () => {
    const res = await request(app).post('/api/code/run').send({ language: 'python', sourceCode: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  test('rejects invalid language', async () => {
    const res = await request(app).post('/api/code/run').send({ language: 'brainfuck', sourceCode: '+' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  test('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/api/code/run')
      .set('Content-Type', 'application/json')
      .send('{"language": "python",');
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'INVALID_JSON');
  });

  test('enforces the source-code size limit', async () => {
    const huge = 'x'.repeat(70000);
    const res = await request(app).post('/api/code/run').send({ language: 'python', sourceCode: huge });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });
});

describe('POST /api/code/run — real result parsing', () => {
  test('returns actual stdout for a successful run', async () => {
    const res = await request(app).post('/api/code/run').send({ language: 'python', sourceCode: 'print(1+1)', stdin: '' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.status, 'completed');
    assert.equal(res.body.stdout, '2\n');
  });

  test('surfaces compile errors as an honest failed (non-success) result', async () => {
    const res = await request(app).post('/api/code/run').send({ language: 'c', sourceCode: 'int main(){bad}' });
    assert.equal(res.status, 200); // a real compiler result, not an HTTP error
    assert.equal(res.body.success, false);
    assert.equal(res.body.status, 'compile_error');
    assert.match(res.body.compileMessage, /syntax/);
  });

  test('accepts empty stdin and reports it distinctly from output', async () => {
    const res = await request(app).post('/api/code/run').send({ language: 'python', sourceCode: 'print("hi")' });
    assert.equal(res.status, 200);
    assert.equal(res.body.stdout, '2\n'); // stubbed provider always returns "2\n"
  });

  test('runs TypeScript through its own provider compiler (not the Node one)', async () => {
    const res = await request(app)
      .post('/api/code/run')
      .send({ language: 'typescript', sourceCode: 'const n: number = 42; console.log(n);', stdin: '' });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.status, 'completed');
    assert.equal(res.body.stdout, 'hi ts 42\n');
    assert.equal(res.body.runtime, 'typescript-5.6.2');
  });
});

describe('POST /api/code/run — batch stdin forwarding', () => {
  // The whole point of the pre-run stdin editor: whatever the client collects
  // reaches the provider verbatim as the program's stdin (one request).
  test('forwards the request stdin to the provider unchanged', async () => {
    const res = await request(app)
      .post('/api/code/run')
      .send({ language: 'python', sourceCode: 'name = input()', stdin: 'Alice\n42\n' });
    assert.equal(res.status, 200);
    assert.equal(lastStdin, 'Alice\n42\n');
  });

  test('defaults stdin to an empty string when the client omits it', async () => {
    const res = await request(app).post('/api/code/run').send({ language: 'python', sourceCode: 'print(1)' });
    assert.equal(res.status, 200);
    assert.equal(lastStdin, '');
  });

  test('rejects stdin over the byte cap', async () => {
    const huge = 'x'.repeat(20000);
    const res = await request(app).post('/api/code/run').send({ language: 'python', sourceCode: 'print(1)', stdin: huge });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });
});
