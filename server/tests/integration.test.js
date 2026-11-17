import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Integration tests run against the REAL configured execution provider and are
 * skipped unless explicitly enabled (they need network + a live provider):
 *
 *   RUN_INTEGRATION=1 node --test tests/integration.test.js
 *
 * They are intentionally the only place that touches the network, so the
 * default `npm test` suite stays fast and deterministic.
 *
 * The provider is a shared public service: GHC/rustc/dotnet cold compiles
 * routinely take 60–120s, and bursts of requests get refused outright. This
 * file therefore raises the wall-clock budget for the whole suite, spaces the
 * expanded runs, and retries only *transport-level* failures — a compile error
 * or wrong output is a real failure and is never retried away.
 */
const enabled = process.env.RUN_INTEGRATION === '1';
const t = enabled ? test : test.skip;

// env.js caches EXECUTION_TIMEOUT_MS at import time, so it must be set first.
if (process.env.EXECUTION_TIMEOUT_MS === undefined) {
  process.env.EXECUTION_TIMEOUT_MS = '180000';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function execute(language, sourceCode, stdin = '') {
  process.env.EXECUTION_PROVIDER = 'wandbox';
  const { executeCode } = await import('../src/services/execution.service.js');
  return executeCode({ language, sourceCode, stdin });
}

/** Retry only transport-level provider failures (unreachable / throttled). */
async function executeTransientAware(language, sourceCode, stdin = '', tries = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await execute(language, sourceCode, stdin);
    } catch (err) {
      if (err.code !== 'PROVIDER_UNAVAILABLE' || attempt >= tries) throw err;
      await sleep(5000 * attempt);
    }
  }
}

t('real Python execution returns actual output and honors stdin', async () => {
  const r = await execute('python', 'name = input()\nprint("Hello, " + name)', 'World');
  assert.equal(r.status, 'completed');
  assert.equal(r.stdout.trim(), 'Hello, World');
});

t('real C compilation + execution', async () => {
  const r = await execute('c', '#include <stdio.h>\nint main(){printf("%d",6*7);return 0;}', '');
  assert.equal(r.status, 'completed');
  assert.equal(r.stdout.trim(), '42');
});

t('real C++ compilation + execution', async () => {
  const r = await execute('cpp', '#include <iostream>\nint main(){std::cout<<10+20;}', '');
  assert.equal(r.stdout.trim(), '30');
});

t('real Java compilation + execution', async () => {
  const r = await execute('java', 'class Main{public static void main(String[] a){System.out.print("J"+(1+1));}}', '');
  assert.equal(r.stdout.trim(), 'J2');
});

t('real Node.js execution reads stdin', async () => {
  const r = await execute('javascript', 'const s=require("fs").readFileSync(0,"utf8").trim();console.log("got:"+s);', 'abc');
  assert.equal(r.stdout.trim(), 'got:abc');
});

t('compilation failure is reported as compile_error, not success', async () => {
  const r = await execute('c', 'int main(){ @@@ }', '');
  assert.equal(r.success, false);
  assert.equal(r.status, 'compile_error');
  assert.ok(r.compileMessage.length > 0);
});

// ---------------------------------------------------------------------------
// Runners registered during the Oct 2026 language expansion. Each was probed
// live once at authoring time; these tests re-verify against the real provider
// whenever RUN_INTEGRATION=1 is set, so a stale compiler id or a broken
// provider image shows up as a failing test rather than a false claim.
// ---------------------------------------------------------------------------
const expanded = [
  ['go', 'package main\nimport "fmt"\nfunc main(){fmt.Print(6*7)}', '42'],
  ['rust', 'fn main(){print!("{}", 6*7);}', '42'],
  ['csharp', 'using System;class P{static void Main(){Console.Write(6*7);}}', '42'],
  ['php', '<?php echo 6*7;', '42'],
  ['ruby', 'print 6*7', '42'],
  ['perl', 'print 6*7;', '42'],
  ['lua', 'print(6*7)', '42'],
  ['julia', 'print(6*7)', '42'],
  ['haskell', 'main = print (6*7 :: Int)', '42'],
  ['sql', 'SELECT 6*7 + 0;', '42'],
  ['shell', 'echo $((6*7))', '42'],
  ['pascal', 'program M; begin write(6*7) end.', '42'],
];

for (const [language, sourceCode, expected] of expanded) {
  t(`real ${language} execution via the live provider`, async () => {
    await sleep(2000); // stay inside the public provider's rate limits
    const r = await executeTransientAware(language, sourceCode, '');
    assert.equal(r.status, 'completed', `${language}: ${r.status} / ${r.compileMessage || r.stderr || ''}`);
    assert.equal(String(r.stdout).trim(), expected);
  });
}

// ---------------------------------------------------------------------------
// Failure-path verification against the live provider. A broken program must
// never come back as a success, and the compiler/runtime text must survive
// parsing so the user can act on it. Which bucket a language reports in
// (compile_error vs runtime_error) is provider- and language-specific, so the
// assertion is the honest invariant rather than a guessed category.
//
// The diagnostic text may legitimately arrive on stdout: interpreted languages
// write parse/runtime errors to whatever stream the provider's image configures
// (verified for php-8.3.12 on 2026-10-21: `Parse error: syntax error ...`
// arrives in program_output with exit status 255, so compileMessage and stderr
// are both empty). Every channel the UI actually renders is therefore in scope.
// ---------------------------------------------------------------------------
const invalidPrograms = [
  ['python', 'print("unclosed'],
  ['c', 'int main(){ @@@ }'],
  ['cpp', 'int main(){ @@@ }'],
  ['java', 'class Main { void x( { }'],
  ['javascript', 'const x = ;'],
  ['typescript', 'const a: number = "s"; console.log(a);'],
  ['go', 'package main\nfunc main(){ @@@ }'],
  ['rust', 'fn main(){ let x: i32 = "s"; }'],
  ['csharp', 'class P{ static void Main(){ @@@ } }'],
  ['php', '<?php $x = ;'],
  ['ruby', 'def'],
  ['perl', 'print "unclosed;'],
  ['lua', 'local x = = 1'],
  ['julia', 'f(=1)'],
  ['haskell', 'main = let x in'],
  ['sql', 'SELECT FROM WHERE;'],
  ['shell', 'if then fi'],
  ['pascal', 'program M; begin @@@ end.'],
];

for (const [language, sourceCode] of invalidPrograms) {
  t(`live provider rejects broken ${language} code with a real message`, async () => {
    await sleep(2000);
    const r = await executeTransientAware(language, sourceCode, '');
    assert.notEqual(r.status, 'completed', `${language}: broken code was reported as success`);
    assert.equal(r.success, false);
    const message = `${r.compileMessage || ''}${r.stderr || ''}${r.stdout || ''}`.trim();
    assert.ok(message.length > 0, `${language}: failure carried no compiler/runtime output`);
    // A failure whose only text is stdout must still say what went wrong, not
    // look like a successful run that printed something.
    if (!r.compileMessage && !r.stderr) {
      assert.notEqual(r.status, 'completed');
      assert.ok(r.exitCode !== 0, `${language}: stdout-only failure exited 0`);
    }
  });
}

// stdin is plumbed for every runner (asserted offline in runner-matrix.test.js);
// these live runs prove the provider actually delivers it for the languages the
// UI advertises stdin for.
const stdinPrograms = [
  ['python', 'import sys\nprint("got:"+sys.stdin.read().strip())'],
  ['java', 'class Main{public static void main(String[] a)throws Exception{java.io.InputStream in=System.in;StringBuilder s=new StringBuilder();int c;while((c=in.read())>0&&c!=10)s.append((char)c);System.out.print("got:"+s);}}'],
  ['javascript', 'const s=require("fs").readFileSync(0,"utf8").trim();console.log("got:"+s);'],
  ['ruby', 'print "got:"+STDIN.gets.to_s.strip'],
  ['perl', 'my $n = <STDIN>; chomp $n; print "got:$n";'],
  ['shell', 'read -r n; echo "got:$n"'],
];

for (const [language, sourceCode] of stdinPrograms) {
  t(`live ${language} run receives stdin`, async () => {
    await sleep(2000);
    const r = await executeTransientAware(language, sourceCode, 'phase1-stdin');
    assert.equal(r.status, 'completed', `${language}: ${r.status} / ${r.compileMessage || r.stderr || ''}`);
    assert.match(String(r.stdout), /got:phase1-stdin/, `${language} stdout: ${r.stdout}`);
  });
}

t('live provider timeout is surfaced as UPSTREAM_TIMEOUT (not an outage)', async () => {
  await sleep(2000);
  // Wandbox kills a program that outruns its CPU/wall budget with an HTTP 504
  // and a non-JSON body — see .e2e-preview/wandbox-raw-probe.mjs.
  await assert.rejects(
    () => execute('python', 'import time\ntime.sleep(120)\n', ''),
    (err) => {
      assert.equal(err.code, 'UPSTREAM_TIMEOUT', `got ${err.code}: ${err.message}`);
      assert.equal(err.status, 504);
      return true;
    },
  );
});

t('live run with no output completes with empty stdout', async () => {
  const r = await executeTransientAware('python', 'pass\n', '');
  assert.equal(r.status, 'completed');
  assert.equal(r.stdout, '');
});

t('live run exiting non-zero is reported as a runtime error with that code', async () => {
  const r = await executeTransientAware('python', 'import sys\nsys.exit(2)\n', '');
  assert.equal(r.success, false);
  assert.equal(r.status, 'runtime_error');
  assert.equal(r.exitCode, 2);
});

t('live provider catalog still lists every registered wandbox compiler id', async () => {
  const provider = (await import('../src/config/executionProvider.js')).resolveProvider('wandbox');
  const { LANGUAGES } = await import('../src/config/languages.js');
  const catalog = await provider.listSupported();
  assert.ok(Array.isArray(catalog) && catalog.length > 0, 'catalog unavailable — provider down');
  const names = new Set(catalog.map((c) => c.name || c.id));
  const missing = LANGUAGES.filter((l) => l.wandbox && !names.has(l.wandbox.compiler)).map((l) => l.key);
  assert.deepEqual(missing, [], `compiler ids no longer in the live catalog: ${missing.join(', ')}`);
});
