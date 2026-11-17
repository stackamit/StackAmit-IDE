import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';

import { LANGUAGES } from '../src/config/languages.js';
import { env } from '../src/config/env.js';
import { RUNTIME_PROBES, detectRuntimes } from '../src/services/runtimes.js';
import { INTERACTIVE_PLANS, LOCAL_ONLY_LABELS, attachInteractiveServer, analyzeJavaSource, buildJavaRunPlan, getInteractiveActiveSessionCount } from '../src/services/interactive.service.js';

/**
 * Local interactive runner: registry parity + honest failure messages.
 *
 * Nothing here executes a real toolchain (that would depend on what the machine
 * has installed) — it proves the wiring and the messages. Real local runs are
 * covered by the manual smoke path documented in the README.
 */

/** Boot the interactive WS server on an ephemeral port. Returns { url, close }. */
async function serveInteractive() {
  const server = http.createServer();
  const detach = attachInteractiveServer(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `ws://127.0.0.1:${server.address().port}/api/interactive`,
    close: () => { detach(); server.close(); },
  };
}

/** Send one message and collect the replies until the first `exit` event. */
function collectExchange(url, message, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const events = [];
    const done = () => { try { ws.close(); } catch { /* closed */ } resolve(events); };
    const timer = setTimeout(() => done(), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(message)));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      events.push(msg);
      if (msg.type === 'exit') { clearTimeout(timer); done(); }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

describe('interactive plan registry parity', () => {
  test('every plan key resolves to a human label and a runtime probe', () => {
    const runnerKeys = new Set(LANGUAGES.map((l) => l.key));
    for (const key of Object.keys(INTERACTIVE_PLANS)) {
      assert.ok(
        runnerKeys.has(key) || LOCAL_ONLY_LABELS[key],
        `${key} has an interactive plan but no registry label (add it to LOCAL_ONLY_LABELS if it is local-only)`,
      );
      assert.ok(RUNTIME_PROBES[key], `${key} has an interactive plan but no runtime probe`);
    }
  });

  test('LOCAL_ONLY_LABELS only lists languages the batch registry does not have', () => {
    const runnerKeys = new Set(LANGUAGES.map((l) => l.key));
    for (const key of Object.keys(LOCAL_ONLY_LABELS)) {
      assert.equal(runnerKeys.has(key), false, `${key} is a batch runner — it belongs in the registry, not the local-only list`);
      assert.ok(INTERACTIVE_PLANS[key], `${key} is labelled local-only but has no plan`);
    }
  });

  test('batch runners without an interactive plan are the documented single-file exceptions', () => {
    // TypeScript needs a tsc-then-node flow, C# needs a project scaffold and
    // SQL needs a database server — those stay batch/remote only.
    const noPlan = LANGUAGES.map((l) => l.key).filter((k) => !INTERACTIVE_PLANS[k]).sort();
    assert.deepEqual(noPlan, ['csharp', 'sql', 'typescript']);
  });

  test('every plan builds a fixed argv from allow-listed commands', () => {
    for (const [key, plan] of Object.entries(INTERACTIVE_PLANS)) {
      assert.ok(plan.sourceName && !plan.sourceName.includes('..'), `${key} source name must be a plain file name`);
      const spec = plan.run({ cmd: plan.sourceName });
      assert.ok(Array.isArray(spec.args), `${key} run args must be an argv array`);
      assert.ok(spec.args.every((a) => typeof a === 'string'), `${key} argv must be strings`);
    }
  });

  test('compile steps run the command detectRuntimes() resolved, not a re-guess', () => {
    for (const [key, plan] of Object.entries(INTERACTIVE_PLANS)) {
      if (!plan.compile) continue;
      if (key === 'java') {
        // Deliberate exception: rt.cmd is the `java` launcher; compilation
        // needs `javac`, whose presence detectRuntimes() verifies separately.
        assert.equal(plan.compile({ cmd: 'whatever-java' }).cmd, 'javac');
        continue;
      }
      assert.equal(
        plan.compile({ cmd: 'detected-tool' }).cmd,
        'detected-tool',
        `${key}: compile must honour the detected runtime command`,
      );
    }
  });

  test('every plan command with no detected runtime matches a probe candidate (no table drift)', () => {
    // The `|| '<name>'` fallbacks may only ever name a command that
    // RUNTIME_PROBES actually probes for that language — otherwise an
    // available-check could pass while the run spawns an unprobed tool.
    const BUILT_BINARY = new Set(['c', 'cpp', 'rust', 'pascal']); // run the .\main.exe they just built
    for (const [key, plan] of Object.entries(INTERACTIVE_PLANS)) {
      const probed = RUNTIME_PROBES[key].cmds;
      const fallbacks = [];
      if (!BUILT_BINARY.has(key)) fallbacks.push(plan.run({}).cmd);
      if (plan.compile && key !== 'java') fallbacks.push(plan.compile({}).cmd);
      for (const cmd of fallbacks) {
        assert.ok(
          probed.includes(cmd) || (key === 'kotlin' && cmd === 'java'), // kotlin's jar needs the JRE
          `${key}: plan fallback '${cmd}' is not in its probe list [${probed.join(', ')}]`,
        );
      }
    }
  });
});

describe('interactive session guards (no toolchain required)', () => {
  test('socket teardown releases the active session exactly once', async () => {
    const { url, close } = await serveInteractive();
    try {
      assert.equal(getInteractiveActiveSessionCount(), 0);
      await collectExchange(url, { type: 'start', language: 'python', sourceCode: '   ' });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(getInteractiveActiveSessionCount(), 0);
    } finally {
      close();
    }
  });

  test('a language with no local plan is refused with an honest message', async () => {
    const { url, close } = await serveInteractive();
    try {
      const events = await collectExchange(url, { type: 'start', language: 'cobol', sourceCode: 'x' });
      const error = events.find((e) => e.type === 'error');
      assert.ok(error, 'expected an error event');
      assert.match(error.data, /cannot run interactively/);
      assert.equal(events.at(-1).type, 'exit');
    } finally {
      close();
    }
  });

  test('empty source never starts a process', async () => {
    const { url, close } = await serveInteractive();
    try {
      const events = await collectExchange(url, { type: 'start', language: 'python', sourceCode: '   ' });
      const error = events.find((e) => e.type === 'error');
      assert.ok(error && /empty/i.test(error.data), `expected an empty-source error, got ${JSON.stringify(events)}`);
    } finally {
      close();
    }
  });

  test('a planned language without an installed runtime reports it instead of failing silently', async () => {
    const runtimes = await detectRuntimes();
    const missing = Object.keys(INTERACTIVE_PLANS).find((k) => runtimes[k] && !runtimes[k].available);
    if (!missing) {
      // Every probed toolchain is installed on this machine: nothing to assert.
      return;
    }
    const { url, close } = await serveInteractive();
    try {
      const events = await collectExchange(url, { type: 'start', language: missing, sourceCode: 'x' });
      const error = events.find((e) => e.type === 'error');
      assert.ok(error && /No local .* runtime/i.test(error.data), `expected a missing-runtime message for ${missing}`);
    } finally {
      close();
    }
  });
});

/**
 * Java entry-point resolution is a pure function, so command construction is
 * verified deterministically (no JVM). The bug was that PLANS.java hardcoded
 * writing to Main.java and launching `java Main`; when the real class differed
 * the program compiled but the JVM threw ClassNotFoundException. These tests
 * pin that the class to run and the file to write are now taken from the code.
 */
describe('java entry-point resolution (deterministic, no JVM)', () => {
  test('public class Main → Main.java, launch Main', () => {
    const a = analyzeJavaSource('public class Main { public static void main(String[] args) { System.out.println(1); } }');
    assert.equal(a.ok, true);
    assert.equal(a.sourceName, 'Main.java');
    assert.equal(a.fqn, 'Main');
    assert.equal(a.runClass, 'Main');
  });

  test('repro: non-public class `a` → a.java, launch a (was ClassNotFoundException)', () => {
    const a = analyzeJavaSource('import java.util.Scanner;\nclass a { public static void main(String[] args) { new Scanner(System.in).nextLine(); } }');
    assert.equal(a.ok, true);
    assert.equal(a.sourceName, 'a.java');
    assert.equal(a.fqn, 'a');
    assert.equal(a.runClass, 'a');
  });

  test('public class named differently from the editor file → file follows the public class', () => {
    const a = analyzeJavaSource('public class Greeting { public static void main(String[] args) {} }');
    assert.equal(a.ok, true);
    assert.equal(a.sourceName, 'Greeting.java');
    assert.equal(a.fqn, 'Greeting');
  });

  test('package declaration → fully-qualified launch class', () => {
    const a = analyzeJavaSource('package com.demo;\npublic class App { public static void main(String... args) {} }');
    assert.equal(a.ok, true);
    assert.equal(a.fqn, 'com.demo.App');
    assert.equal(a.sourceName, 'App.java');
  });

  test('when the public class has no main, the entry class still drives the launch', () => {
    const a = analyzeJavaSource('public class Facade { static void helper() {} }\nclass Runner { public static void main(String[] args) {} }');
    assert.equal(a.ok, true);
    // filename follows the public class (javac rule); launch follows the main class.
    assert.equal(a.sourceName, 'Facade.java');
    assert.equal(a.fqn, 'Runner');
  });

  test('ambiguous entry (two main classes) is a clear diagnostic, never a guess', () => {
    const a = analyzeJavaSource('class One { public static void main(String[] x) {} }\nclass Two { public static void main(String[] y) {} }');
    assert.equal(a.ok, false);
    assert.match(a.error, /Multiple classes declare a main/);
  });

  test('a class with no main method is reported, not launched blindly', () => {
    const a = analyzeJavaSource('public class Lib { public int value() { return 1; } }');
    assert.equal(a.ok, false);
    assert.match(a.error, /main\(String\[\] args\)` entry point was found/);
  });

  test('class/main text inside comments and string literals is not mistaken for the entry', () => {
    const src = [
      'public class Real {',
      '  // class Decoy { public static void main(String[] a) {} }',
      '  /* class AlsoDecoy { void main(String[] a) {} } */',
      '  public static void main(String[] args) { System.out.println("class InString { static void main(String[] z) {} }"); }',
      '}',
    ].join('\n');
    const a = analyzeJavaSource(src);
    assert.equal(a.ok, true);
    assert.equal(a.runClass, 'Real');
    assert.equal(a.fqn, 'Real');
    assert.equal(a.sourceName, 'Real.java');
  });

  test('buildJavaRunPlan compiles with -d and runs with -cp against the temp dir, honouring the detected launcher', () => {
    const p = buildJavaRunPlan({ cmd: 'java' }, 'class Bot { public static void main(String[] a) {} }');
    assert.equal(p.ok, true);
    assert.equal(p.compile.cmd, 'javac');
    assert.deepEqual(p.compile.args, ['-d', '.', 'Bot.java']);
    assert.equal(p.run.cmd, 'java');
    assert.deepEqual(p.run.args, ['-cp', '.', 'Bot']);
  });

  test('buildJavaRunPlan falls back to the java launcher when no runtime cmd is resolved', () => {
    const p = buildJavaRunPlan(null, 'public class Main { public static void main(String[] a) {} }');
    assert.equal(p.run.cmd, 'java');
    assert.equal(p.fqn, 'Main');
  });

  test('buildJavaRunPlan surfaces an entry-point diagnostic with a distinct stage (not a runtime error)', () => {
    const p = buildJavaRunPlan({ cmd: 'java' }, 'public class NoMain {}');
    assert.equal(p.ok, false);
    assert.equal(p.stage, 'entry');
    assert.match(p.error, /entry point/);
  });

  test('successive runs of different sources resolve to different classes (no stale Main / class carry-over)', () => {
    const one = buildJavaRunPlan({ cmd: 'java' }, 'class Alpha { public static void main(String[] a) {} }');
    const two = buildJavaRunPlan({ cmd: 'java' }, 'public class Beta { public static void main(String[] a) {} }');
    assert.equal(one.fqn, 'Alpha');
    assert.equal(two.fqn, 'Beta');
    assert.notEqual(one.sourceName, two.sourceName);
  });

  test('b.java-style non-public class b launches b, never the placeholder Main', () => {
    const src = 'import java.util.Scanner;\nclass b {\n  public static void main(String[] args) {\n    new Scanner(System.in).nextLine();\n  }\n}';
    const p = buildJavaRunPlan({ cmd: 'java' }, src);
    assert.equal(p.ok, true);
    assert.equal(p.fqn, 'b');
    assert.deepEqual(p.run.args, ['-cp', '.', 'b']);
    // Pre-fix behaviour launched `java Main`; assert that regression cannot return.
    assert.ok(!p.run.args.includes('Main'), 'must never launch the placeholder Main class');
    assert.ok(!p.compile.args.includes('Main.java'), 'must never compile the placeholder Main.java');
  });

  test('a.java-style non-public class a resolves to a, matching the second failing repro', () => {
    const p = buildJavaRunPlan({ cmd: 'java' }, 'class a { public static void main(String[] args) {} }');
    assert.equal(p.ok, true);
    assert.equal(p.fqn, 'a');
    assert.deepEqual(p.compile.args, ['-d', '.', 'a.java']);
  });
});

/** Open a session, answer the first prompt with a stdin line, collect the exchange. */
function runInteractiveWithStdin(url, startMsg, responder, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const events = [];
    let stdout = '';
    let settled = false;
    let answered = false;
    const finish = () => { if (settled) return; settled = true; clearTimeout(timer); try { ws.close(); } catch { /* closed */ } resolve({ events, stdout }); };
    const timer = setTimeout(finish, timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify(startMsg)));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      events.push(m);
      if (m.type === 'stdout') stdout += m.data || '';
      if (!answered) {
        const line = responder(m, stdout);
        if (line) { answered = true; ws.send(JSON.stringify({ type: 'stdin', data: line })); }
      }
      if (m.type === 'exit') finish();
    });
    ws.on('error', (err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
  });
}

// Live runs need the real toolchain; gate exactly like the batch integration
// suite so deterministic CI is unaffected when a compiler is absent.
const liveEnabled = env.localRunEnabled;
const lt = liveEnabled ? test : test.skip;

describe('interactive live stdin (real toolchain, skipped when unavailable)', () => {
  lt('java Scanner reads a line typed through the interactive stdin transport', async () => {
    const rt = await detectRuntimes();
    if (!rt.java || !rt.java.available) return; // environment-dependent skip
    // A non-public entry class is the exact ClassNotFoundException repro shape.
    const src = 'import java.util.Scanner;\nclass solve { public static void main(String[] args) { Scanner sc = new Scanner(System.in); System.out.print("name: "); String n = sc.nextLine(); System.out.println("Hello " + n); } }\n';
    const { url, close } = await serveInteractive();
    try {
      const { events, stdout } = await runInteractiveWithStdin(
        url,
        { type: 'start', language: 'java', sourceCode: src },
        (m, out) => (m.type === 'stdout' && /name:/.test(out) ? 'Alice\n' : null),
      );
      const exit = events.at(-1);
      assert.ok(/Hello Alice/.test(stdout), `expected Scanner echo, got <${stdout}>`);
      assert.equal(exit.type, 'exit');
      assert.equal(exit.code, 0);
      // Proves "Compiled" is only reported after javac actually succeeded.
      assert.ok(events.some((e) => e.type === 'info' && /Compiled/.test(e.data)), 'expected a Compiled notice');
    } finally {
      close();
    }
  });

  lt('python input() stdin remains wired through the same transport (regression)', async () => {
    const rt = await detectRuntimes();
    if (!rt.python || !rt.python.available) return; // environment-dependent skip
    const { url, close } = await serveInteractive();
    try {
      const { events, stdout } = await runInteractiveWithStdin(
        url,
        { type: 'start', language: 'python', sourceCode: 'name = input("Enter your name: ")\nprint("Hello", name)\n' },
        (m, out) => (m.type === 'stdout' && /Enter your name/.test(out) ? 'Bob\n' : null),
      );
      assert.ok(/Hello Bob/.test(stdout), `expected python echo, got <${stdout}>`);
      assert.equal(events.at(-1).code, 0);
      const sequenced = events.filter((event) => Number.isInteger(event.sequence));
      assert.ok(sequenced.length >= 3, 'interactive frames should carry server sequence numbers');
      assert.deepEqual(
        sequenced.map((event) => event.sequence),
        sequenced.map((event) => event.sequence).slice().sort((a, b) => a - b),
        'server event sequence must be monotonic on one session',
      );
      assert.ok(events.some((event) => event.type === 'stdin' && event.data === 'Bob\n'), 'stdin should be acknowledged once by the server');
    } finally {
      close();
    }
  });

  lt('reproduces the exact b.java ClassNotFoundException shape, now passing through interactive stdin', async () => {
    const rt = await detectRuntimes();
    if (!rt.java || !rt.java.available) return; // environment-dependent skip
    const src = 'import java.util.Scanner;\nclass b { public static void main(String[] args) { Scanner sc = new Scanner(System.in); System.out.print("Enter your name: "); String n = sc.nextLine(); System.out.println("Hello, " + n); } }\n';
    const { url, close } = await serveInteractive();
    try {
      const { events, stdout } = await runInteractiveWithStdin(
        url,
        { type: 'start', language: 'java', sourceCode: src },
        (m, out) => (m.type === 'stdout' && /Enter your name/.test(out) ? 'Rahul\n' : null),
      );
      assert.match(stdout, /Hello, Rahul/);
      assert.equal(events.at(-1).code, 0);
      const wire = JSON.stringify(events);
      assert.ok(
        !/Could not find or load main class Main|ClassNotFoundException/.test(wire),
        'the pre-fix Main ClassNotFoundException must not recur',
      );
    } finally {
      close();
    }
  });
});
