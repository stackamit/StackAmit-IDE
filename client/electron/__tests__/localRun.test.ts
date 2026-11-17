import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  LOCAL_PLANS,
  MAX_OUTPUT_CHARS,
  MAX_SESSIONS,
  activeSessionIds,
  buildTerminalCommand,
  cleanupScratch,
  disposeAll,
  linkNodeModulesInto,
  moduleKindIsEsm,
  sanitizeEnv,
  start,
  stop,
  writeStdin,
  typescriptModuleFormatHint,
  type RunEvent,
  type StartOptions,
} from '../services/localRun';
import { LOCAL_RUNTIMES, detectLocalRuntimes, findTypescriptPackage, invalidateLocalRuntimes, isJdkHome, jdkCandidateHomes, locateOnPath, mergePathDirs, mergedPathEnv, pathSearchDirs, refreshPathFromRegistry, typescriptTscEntry, type DetectedRuntime, type TypeScriptCompiler } from '../services/runtimeProbe';

/**
 * Local (offline) desktop execution — Phase 2 + Phase 7 regression coverage.
 *
 * These are real spawns of real runtimes, deliberately: the point of the
 * desktop run path is that it works on a Windows machine with spaces and
 * non-ASCII in the project path, that stdout/stderr/exit codes survive
 * streaming, that Stop actually kills the child, and that nothing is left
 * behind. A runtime that is not installed makes its block `skip`, which the
 * suite reports honestly as skipped rather than silently passing.
 */

const IS_WIN = process.platform === 'win32';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-run-test-'));

// Skip decisions must be made at collection time, i.e. before any async hook
// runs, so they use the synchronous PATH lookup. The tests themselves then
// assert the real spawn behaviour, and `detectLocalRuntimes()` below re-checks
// the same runtimes by actually running them.
const found: Record<string, boolean> = {};
for (const [key, probe] of Object.entries(LOCAL_RUNTIMES)) {
  found[key] = probe.cmds.some((cmd) => Boolean(locateOnPath(cmd)));
}

beforeAll(async () => {
  invalidateLocalRuntimes();
  const runtimes = await detectLocalRuntimes(true);
  for (const rt of Object.values(runtimes)) {
    console.log(`[localRun] ${rt.key} available=${rt.available} -> ${rt.path} (${rt.version})`);
  }
}, 30000);

afterEach(() => {
  disposeAll();
});

type Collected = {
  result: { ok: boolean; sessionId?: string; code?: string; message?: string };
  events: RunEvent[];
  stdout: string;
  stderr: string;
  info: string;
  errors: string;
  exit: Extract<RunEvent, { type: 'exit' }> | null;
};

/** Run to completion (or failure to start) and collect every streamed event. */
async function runToCompletion(
  opts: Partial<StartOptions> & { language: string },
  waitMs = 25000,
): Promise<Collected> {
  const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
  let finish: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    finish = resolve;
  });
  // Detection is *not* stubbed: the same cached discovery the packaged app uses
  // decides what gets spawned here.
  const res = await start({ tempRoot, timeoutMs: 20000, ...opts } as StartOptions, (e) => {
    col.events.push(e);
    if (e.type === 'exit') col.exit = e;
    else if (e.type === 'stdout') col.stdout += e.data;
    else if (e.type === 'stderr') col.stderr += e.data;
    else if (e.type === 'info') col.info += e.data;
    else if (e.type === 'error') col.errors += e.data;
    if (e.type === 'exit') finish();
  });
  col.result = res as Collected['result'];
  if (!res.ok) return col;
  // The exit event is the only guaranteed end of a stream.
  await Promise.race([exited, new Promise((r) => setTimeout(r, waitMs))]);
  return col;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitFor(predicate: () => boolean, ms = 4000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}

// ---------------------------------------------------------------------------
// Plan contract
// ---------------------------------------------------------------------------
describe('local run plans', () => {
  it('has exactly one plan per locally supported runtime', () => {
    expect(Object.keys(LOCAL_PLANS).sort()).toEqual(Object.keys(LOCAL_RUNTIMES).sort());
  });

  it('names the file each runtime expects and spawns it directly, never via a shell', () => {
    const stub: DetectedRuntime = { cmd: '', key: '', label: '', available: true, path: null, version: null, installHint: '' };
    // Java is not in this loop on purpose: it is a multi-step `prepare` plan
    // (javac → java), and its argv is asserted against a real JDK below.
    for (const key of ['python', 'javascript', 'powershell']) {
      const plan = LOCAL_PLANS[key];
      expect(plan.sourceName, key).toMatch(/^main\./);
      const { cmd, args } = plan.run!({ ...stub, cmd: LOCAL_RUNTIMES[key].cmds[0] }, plan.sourceName);
      // No cmd/powershell -Command wrapper and no sh/bash: the argv array goes
      // straight to the runtime, which is what makes spaces and non-ASCII paths
      // safe without quoting tricks.
      expect(['cmd', 'cmd.exe', 'sh', 'bash', '/bin/sh'], key).not.toContain(cmd);
      expect(args.join(' '), key).not.toMatch(/[&|><^]/);
      expect(args, key).toContain(plan.sourceName);
    }
  });

  it('plans Java as explicit argv steps instead of a single shell command', () => {
    const plan = LOCAL_PLANS.java;
    expect(plan.run, 'java must not use the one-spawn path').toBeUndefined();
    expect(typeof plan.prepare, 'java needs a compile/run plan').toBe('function');
    expect(plan.sourceName).toBe('Main.java');
    // An unsaved buffer is written under the name its public class demands,
    // otherwise javac rejects the file before the program ever starts.
    expect(plan.sourceNameFor?.('public class Widget { }')).toBe('Widget.java');
    expect(plan.sourceNameFor?.('package a.b;\npublic class App { }')).toBe('App.java');
    expect(plan.sourceNameFor?.('public class Main { }')).toBe('Main.java');
  });

  it('runs PowerShell with a per-process execution-policy bypass only', () => {
    const args = LOCAL_PLANS.powershell.run!({ cmd: 'powershell', key: 'powershell', label: '', available: true, path: null, version: null, installHint: '' }, 'main.ps1').args;
    expect(args).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'main.ps1']);
    expect(args.join(' ')).not.toMatch(/Set-ExecutionPolicy|-Command\s/);
  });

  it('executes whatever file name it is given, not a hardcoded main.* entry point', () => {
    // The bug this guards against: a saved `a.py` was spawned as `python -u
    // main.py`, so the runtime looked for a file that did not exist. The plan
    // must place the *target* argument into argv verbatim for every runtime.
    const stub: DetectedRuntime = { cmd: '', key: '', label: '', available: true, path: null, version: null, installHint: '' };
    const cases: Array<[string, string]> = [
      ['python', 'a.py'],
      ['python', 'hello world.py'],
      ['javascript', 'index.js'],
      ['powershell', 'script.ps1'],
    ];
    for (const [key, target] of cases) {
      const { args } = LOCAL_PLANS[key].run!({ ...stub, cmd: LOCAL_RUNTIMES[key].cmds[0] }, target);
      expect(args, key).toContain(target);
      expect(args.join(' '), key).not.toMatch(/\bmain\./);
    }
  });

  it('refuses a selected file that is missing on disk instead of running a temp main.*', async () => {
    const missing = path.join(tempRoot, 'deleted-by-someone-else', 'a.py');
    const col = await runToCompletion({ language: 'python', sourceCode: 'print(1)', filePath: missing });
    expect(col.result.ok).toBe(false);
    expect(col.result.code).toBe('FILE_NOT_FOUND');
    expect(col.result.message).toMatch(/could not be found/i);
    // Nothing was streamed: the wrong program must never be launched.
    expect(col.stdout).toBe('');
    expect(col.exit).toBeNull();
  });

  it('refuses a language with no local plan instead of falling back to the network', async () => {
    const col = await runToCompletion({ language: 'c', sourceCode: 'int main(){}' });
    expect(col.result.ok).toBe(false);
    expect(col.result.code).toBe('NO_LOCAL_PLAN');
    expect(col.result.message).toMatch(/no local runner/i);
  });

  it('refuses an empty buffer', async () => {
    const col = await runToCompletion({ language: 'python', sourceCode: '   \n  ' });
    expect(col.result.ok).toBe(false);
    expect(col.result.code).toBe('EMPTY_SOURCE');
  });

  it('reports a missing runtime with the install hint, not a fake success', async () => {
    const none: Record<string, any> = {};
    for (const key of Object.keys(LOCAL_PLANS)) {
      none[key] = {
        key,
        label: LOCAL_RUNTIMES[key].label,
        available: false,
        cmd: null,
        path: null,
        version: null,
        installHint: LOCAL_RUNTIMES[key].installHint,
      };
    }
    const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
    const res = await start({ language: 'python', sourceCode: 'print(1)', tempRoot }, () => undefined, async () => none);
    col.result = res as any;
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('RUNTIME_MISSING');
    expect((res as any).message).toContain(LOCAL_RUNTIMES.python.installHint.slice(0, 20));
  });

  it('stops and writes stdin only against sessions that exist', () => {
    expect(stop('no-such-session')).toBe(false);
    expect(writeStdin('no-such-session', 'x')).toBe(false);
    expect(activeSessionIds()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TypeScript compile + run (offline desktop). Real `tsc` + real `node`: the
// compiler is located through the injectable seam (pointed at this repo's own
// node_modules/typescript), but the compile and the emitted program are genuinely
// spawned, so a type error really stops the run and a runtime error really shows
// up distinct from a build error. No compiler/node → the block reports skipped.
// ---------------------------------------------------------------------------
function realTsCompiler(): TypeScriptCompiler | null {
  const nodeExe = locateOnPath('node');
  const pkgRoot = path.join(process.cwd(), 'node_modules', 'typescript');
  const tscJs = typescriptTscEntry(pkgRoot);
  if (!nodeExe || !tscJs) return null;
  return { tscJs, packageRoot: pkgRoot, nodeExe, version: 'test-compiler', source: 'project' };
}
const tsCompiler = realTsCompiler();
const describeTs = tsCompiler ? describe : describe.skip;

/**
 * A `start` that skips the global runtime probe (TypeScript marks itself
 * available only with a global `tsc`) and hands the plan the real compiler found
 * above. The compile and the run are still real spawns.
 */
async function runTs(
  opts: Partial<StartOptions> & { language: string },
  deps: Parameters<typeof start>[3],
  waitMs = 25000,
): Promise<Collected> {
  const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
  let finish: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => (finish = resolve));
  const detect = (async () => ({})) as unknown as typeof detectLocalRuntimes;
  const res = await start({ tempRoot, timeoutMs: 20000, ...opts } as StartOptions, (e) => {
    col.events.push(e);
    if (e.type === 'exit') col.exit = e;
    else if (e.type === 'stdout') col.stdout += e.data;
    else if (e.type === 'stderr') col.stderr += e.data;
    else if (e.type === 'info') col.info += e.data;
    else if (e.type === 'error') col.errors += e.data;
    if (e.type === 'exit') finish();
  }, detect, deps);
  col.result = res as Collected['result'];
  if (!res.ok) return col;
  await Promise.race([exited, new Promise((r) => setTimeout(r, waitMs))]);
  return col;
}

function mkProjectDir(name: string): string {
  const dir = path.join(tempRoot, `ts-${name}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const okCompiler = { discoverTypeScript: async () => ({ compiler: tsCompiler, rejected: [] }) };
const noCompiler = { discoverTypeScript: async () => ({ compiler: null, rejected: [] }) };

describeTs('typescript local run', () => {
  it('compiles a valid .ts buffer and runs the emitted JavaScript', async () => {
    const col = await runTs({ language: 'typescript', sourceCode: `console.log('ts-ok:' + (1 + 2));` }, okCompiler);
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('ts-ok:3');
    expect(col.exit?.code).toBe(0);
    // A real `tsc` + Node spawn, cold under full-suite parallel load, can pass
    // the 5s default; the other TS cases raise the same budget.
  }, 20000);

  it('stops on a type error and shows real diagnostics instead of running a stale build', async () => {
    const col = await runTs({ language: 'typescript', sourceCode: `const n: number = "not a number";\nconsole.log("SHOULD NOT RUN");` }, okCompiler);
    expect(col.result.ok).toBe(true);
    // tsc reports diagnostics on stdout; --noEmitOnError means the build failed.
    expect(col.stdout + col.stderr).toMatch(/error TS/);
    expect(col.exit?.code).not.toBe(0);
    // The run step never launched, so the program itself did not execute.
    expect(col.info).toMatch(/nothing was run|stopped/i);
  }, 20000);

  it('reports a syntax error as a compile failure that runs nothing', async () => {
    const col = await runTs({ language: 'typescript', sourceCode: `function { broken syntax` }, okCompiler);
    expect(col.stdout + col.stderr).toMatch(/error TS/);
    expect(col.exit?.code).not.toBe(0);
    expect(col.info).toMatch(/nothing was run|stopped/i);
  }, 20000);

  it('explains a CommonJS + verbatimModuleSyntax + ESM-import conflict (TS1295) with an actionable hint', async () => {
    // Reproduces the reported ts-calculator failure generically: package.json
    // says "type": "commonjs", tsconfig turns on verbatimModuleSyntax, and the
    // source uses ES import syntax. Plain `tsc -p` rejects that with TS1295, so
    // the IDE must NOT override it — it must run tsc faithfully and explain the
    // conflict in plain language. Nothing here edits the fixture's config.
    const dir = mkProjectDir('ts1295');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'conflict', type: 'commonjs' }), 'utf8');
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', verbatimModuleSyntax: true, strict: false }, include: ['*.ts'] }),
      'utf8',
    );
    // A resolvable relative import (like the real project's installed `mathjs`)
    // so tsc gets past module resolution and reports the verbatimModuleSyntax
    // conflict itself — TS1295 — rather than TS2307.
    fs.writeFileSync(path.join(dir, 'dep.ts'), 'export function twice(n: number): number { return n * 2; }', 'utf8');
    const file = path.join(dir, 'main.ts');
    fs.writeFileSync(file, 'import { twice } from "./dep";\nconsole.log(twice(21));', 'utf8');
    const col = await runTs({ language: 'typescript', sourceCode: '', filePath: file, workspaceRoot: dir }, okCompiler);
    // tsc really failed and nothing ran (config honoured, not overridden). The
    // exact code varies by TypeScript version (TS1295 on newer, TS1286/TS1287 on
    // older), so accept the whole verbatimModuleSyntax-in-CommonJS family.
    expect(col.stdout + col.stderr).toMatch(/TS(?:1295|1286|1287)/);
    expect(col.exit?.code).not.toBe(0);
    // The Output got a plain-language, actionable explanation of the conflict.
    expect(col.info).toMatch(/configuration conflict/i);
    expect(col.info).toMatch(/"type": "module"|verbatimModuleSyntax|\.mts/);
    // And it never claims an API server is needed for a desktop TypeScript run.
    expect(col.info + col.stdout + col.stderr).not.toMatch(/needs an API server/i);
  }, 30000);

  it('refuses a .tsx module honestly, without compiling or faking a run', async () => {
    const dir = mkProjectDir('tsx');
    const file = path.join(dir, 'App.tsx');
    fs.writeFileSync(file, `export default function App(){ return <div/>; }`, 'utf8');
    const col = await runTs({ language: 'typescript', sourceCode: '', filePath: file }, okCompiler);
    expect(col.result.ok).toBe(false);
    expect(col.result.code).toBe('TSX_UNSUPPORTED_LOCAL');
    // Nothing was spawned: no exit event, no stdout.
    expect(col.exit).toBeNull();
    expect(col.stdout).toBe('');
  });

  it('reports a missing compiler instead of pretending the build succeeded', async () => {
    const col = await runTs({ language: 'typescript', sourceCode: `console.log(1);` }, noCompiler);
    expect(col.result.ok).toBe(false);
    expect(col.result.code).toBe('TS_COMPILER_MISSING');
    expect(col.exit).toBeNull();
  });

  it('compiles with the project\'s tsconfig.json when one is present', async () => {
    const dir = mkProjectDir('cfg');
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', strict: false }, include: ['*.ts'] }), 'utf8');
    const file = path.join(dir, 'main.ts');
    fs.writeFileSync(file, `const x: number = 5;\nconsole.log('cfg:' + x);`, 'utf8');
    const col = await runTs({ language: 'typescript', sourceCode: '', filePath: file, workspaceRoot: dir }, okCompiler);
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('cfg:5');
    expect(col.info).toMatch(/tsconfig\.json/);
    expect(col.exit?.code).toBe(0);
    // A real `tsc` project compile (not a stub) under parallel suite load can
    // exceed the 5s default; this spawn is legitimately the heaviest one here.
  }, 20000);

  it('honours a NodeNext project and runs import.meta.url (TS1343 / TS5110 regression)', async () => {
    // Reproduces the reported failure exactly: a project whose tsconfig sets
    // module + moduleResolution to NodeNext and whose source uses import.meta.
    // The old unconditional `--module CommonJS` override made tsc reject it with
    // TS1343 (import.meta not allowed under CommonJS) and TS5110 (module must be
    // NodeNext when moduleResolution is NodeNext). Now the project config wins.
    const dir = mkProjectDir('nodenext');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'nn', type: 'module' }), 'utf8');
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: false },
        include: ['src/**/*.ts'],
      }),
      'utf8',
    );
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const file = path.join(srcDir, 'main.ts');
    fs.writeFileSync(
      file,
      ['const url = (import.meta as any).url as string;', 'console.log("nodenext-ok:" + (url.startsWith("file:") ? "file" : "other"));'].join('\n'),
      'utf8',
    );
    const col = await runTs({ language: 'typescript', sourceCode: '', filePath: file, workspaceRoot: dir }, okCompiler);
    expect(col.result.ok, col.result.message).toBe(true);
    // Neither of the two override-induced errors may appear.
    expect(col.stdout + col.stderr).not.toMatch(/TS1343|TS5110/);
    // The emitted ES module really ran under Node's ESM loader.
    expect(col.stdout).toContain('nodenext-ok:file');
    expect(col.exit?.code).toBe(0);
  }, 30000);

  it('still honours a CommonJS project (module preserved, output runs as CJS)', async () => {
    // Guards requirement 5: removing the override must not flip a genuinely
    // CommonJS project into ESM. `require` is a function only under CJS, so the
    // program printing "req" proves the output was emitted and run as CommonJS.
    const dir = mkProjectDir('cjsproj');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'cj', type: 'commonjs' }), 'utf8');
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { target: 'ES2020', module: 'CommonJS', moduleResolution: 'Node', strict: false },
        include: ['*.ts'],
      }),
      'utf8',
    );
    const file = path.join(dir, 'main.ts');
    fs.writeFileSync(
      file,
      ['declare const require: any;', 'console.log("cjs-ok:" + (typeof require === "function" ? "req" : "no"));'].join('\n'),
      'utf8',
    );
    const col = await runTs({ language: 'typescript', sourceCode: '', filePath: file, workspaceRoot: dir }, okCompiler);
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('cjs-ok:req');
    expect(col.exit?.code).toBe(0);
  }, 30000);

  it('compiles a relative import across two files and runs them together', async () => {
    const dir = mkProjectDir('multi');
    fs.writeFileSync(path.join(dir, 'b.ts'), `export function greet(n: string): string { return 'hi ' + n; }`, 'utf8');
    const a = path.join(dir, 'a.ts');
    fs.writeFileSync(a, `import { greet } from './b';\nconsole.log(greet('Ada'));`, 'utf8');
    const col = await runTs({ language: 'typescript', sourceCode: '', filePath: a, workspaceRoot: dir }, okCompiler);
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('hi Ada');
    expect(col.exit?.code).toBe(0);
  }, 20000);

  it('resolves an installed npm dependency (mathjs) from the scratch output dir under ESM', async () => {
    // The reported scenario, generically: an ES-module TypeScript project that
    // imports a third-party package. The compiled file runs from a temp output
    // folder OUTSIDE the project, where Node's ESM loader ignores NODE_PATH, so
    // the dependency must resolve through the scratch node_modules link. A
    // faithful `mathjs` fixture stands in for the real package so the test does
    // not depend on anything installed on this machine.
    const dir = mkProjectDir('deps');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'tsdep', type: 'module' }), 'utf8');
    fs.writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: false, skipLibCheck: true }, include: ['*.ts'] }),
      'utf8',
    );
    const pkg = path.join(dir, 'node_modules', 'mathjs');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(
      path.join(pkg, 'package.json'),
      JSON.stringify({
        name: 'mathjs',
        version: '0.0.0',
        type: 'module',
        main: './index.js',
        types: './index.d.ts',
        exports: { '.': { types: './index.d.ts', import: './index.js', default: './index.js' } },
      }),
      'utf8',
    );
    fs.writeFileSync(path.join(pkg, 'index.js'), 'export function evaluate(s) { return "RESULT:" + s; }', 'utf8');
    fs.writeFileSync(path.join(pkg, 'index.d.ts'), 'export declare function evaluate(s: string): string;', 'utf8');
    const file = path.join(dir, 'main.ts');
    fs.writeFileSync(file, 'import { evaluate } from "mathjs";\nconsole.log(evaluate("2 + 3"));', 'utf8');

    const col = await runTs({ language: 'typescript', sourceCode: '', filePath: file, workspaceRoot: dir }, okCompiler);
    expect(col.result.ok, col.result.message).toBe(true);
    // The dependency really loaded and its export ran under Node's ESM loader.
    expect(col.stdout).toContain('RESULT:2 + 3');
    expect(col.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package 'mathjs'/);
    expect(col.exit?.code).toBe(0);
  }, 30000);

  it('distinguishes a runtime error in the program from a compile error', async () => {
    const col = await runTs({ language: 'typescript', sourceCode: `throw new Error('boom-at-runtime');` }, okCompiler);
    // The compile itself was clean (no TS diagnostics) but the program failed.
    expect(col.stderr).not.toMatch(/error TS/);
    expect(col.stderr).toMatch(/boom-at-runtime/);
    expect(col.exit?.code).not.toBe(0);
  }, 20000);

  it('delivers stdin to the running TypeScript program', async () => {
    const source = [
      'declare const process: any;',
      'process.stdin.setEncoding("utf8");',
      'let buf = "";',
      'process.stdin.on("data", (d: string) => { buf += d; if (buf.indexOf("\\n") >= 0) { console.log("GOT:" + buf.trim()); process.exit(0); } });',
    ].join('\n');
    const col = await runTs({ language: 'typescript', sourceCode: source, stdin: 'typed-line\n' }, okCompiler);
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('GOT:typed-line');
  }, 20000);

  it('renders the identical two-step command for Run in Terminal', async () => {
    const dir = mkProjectDir('term');
    const file = path.join(dir, 'x.ts');
    fs.writeFileSync(file, `console.log('term');`, 'utf8');
    const detect = (async () => ({})) as unknown as typeof detectLocalRuntimes;
    const res = await buildTerminalCommand({ language: 'typescript', filePath: file, workspaceRoot: dir }, detect, okCompiler);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.commands.length).toBe(2);
      expect(res.commands[0]).toMatch(/tsc/);
      expect(res.commands[1]).toMatch(/\.js/);
      expect(res.notes.join(' ')).toMatch(/TypeScript/);
    }
  });

  it('keeps the build output folder available to the terminal command and reports it for later cleanup', async () => {
    const dir = mkProjectDir('termscratch');
    const file = path.join(dir, 'y.ts');
    fs.writeFileSync(file, `console.log('keep');`, 'utf8');
    const detect = (async () => ({})) as unknown as typeof detectLocalRuntimes;
    const res = await buildTerminalCommand({ language: 'typescript', filePath: file, workspaceRoot: dir }, detect, okCompiler);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The command writes/reads inside a folder this run owns; it must exist now
    // (so the typed build works) and be handed back so the window can release it.
    expect(res.scratch.length).toBeGreaterThanOrEqual(1);
    for (const d of res.scratch) expect(fs.existsSync(d)).toBe(true);
    // The run command points at a file under that scratch folder.
    expect(res.commands[1]).toContain(res.scratch[0]);
    // Clean-up primitive removes exactly the folders it is handed.
    await cleanupScratch(res.scratch);
    for (const d of res.scratch) expect(fs.existsSync(d)).toBe(false);
  });

  it('cleanupScratch safely removes a throwaway folder and ignores an empty list', async () => {
    const dir = mkProjectDir('cleanup');
    fs.writeFileSync(path.join(dir, 'out.txt'), 'x', 'utf8');
    expect(fs.existsSync(dir)).toBe(true);
    await cleanupScratch([dir]);
    expect(fs.existsSync(dir)).toBe(false);
    // Never throws on nothing to do or an already-gone path.
    await cleanupScratch([]);
    await cleanupScratch([path.join(tempRoot, 'does-not-exist-' + Math.random())]);
  });

  it('locates a project-local typescript package and its runnable entry', () => {
    const dir = mkProjectDir('pkg');
    const lib = path.join(dir, 'node_modules', 'typescript', 'lib');
    fs.mkdirSync(lib, { recursive: true });
    const entry = path.join(lib, 'tsc.js');
    fs.writeFileSync(entry, '', 'utf8');
    // Discovery walks up from the source folder to find node_modules/typescript.
    const srcDir = path.join(dir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const pkg = findTypescriptPackage(srcDir, dir);
    expect(pkg && path.basename(pkg)).toBe('typescript');
    expect(typescriptTscEntry(path.join(dir, 'node_modules', 'typescript'))).toBe(entry);
  });
});

// ---------------------------------------------------------------------------
// Environment hygiene
// ---------------------------------------------------------------------------
describe('child environment', () => {
  it('passes an allow-list instead of the inherited environment', () => {
    const out = sanitizeEnv({ PATH: 'C:\\bin', PATHEXT: '.COM;.EXE', SECRET_TOKEN: 'leak', MONGODB_URI: 'mongodb://x', AWS_SECRET_ACCESS_KEY: 'z', JAVA_HOME: 'C:\\jdk-21', MAVEN_OPTS: '-Dmaven.repo.local=C:\\m2' } as any);
    // The caller's own entry stays first: sanitising must not shuffle what the
    // base environment already resolved. What may be appended is only what this
    // process's snapshot is missing (see the merge test below).
    expect(out.PATH.split(path.delimiter)[0]).toBe('C:\\bin');
    expect(out.PATH).toBe(mergedPathEnv('C:\\bin'));
    expect(out.SECRET_TOKEN).toBeUndefined();
    expect(out.MONGODB_URI).toBeUndefined();
    expect(out.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    // JAVA_HOME has to survive the allow-list: Java tooling (the JDT.LS bridge,
    // javac-based checks) reads it from the child environment. Build-tool knobs
    // stay out — nothing here needs them, and MAVEN_OPTS can carry credentials.
    expect(out.JAVA_HOME).toBe('C:\\jdk-21');
    expect(out.MAVEN_OPTS).toBeUndefined();
    // Unbuffered UTF-8 output is what makes streaming work.
    expect(out.PYTHONUNBUFFERED).toBe('1');
    expect(out.PYTHONIOENCODING).toBe('utf-8');
  });

  it('does not leak a secret that is present in the parent process', async () => {
    if (!found.python) return;
    process.env.STACKAMIT_CANARY_SECRET = 'must-not-leak';
    const col = await runToCompletion({
      language: 'python',
      sourceCode: 'import os\nprint(os.environ.get("STACKAMIT_CANARY_SECRET", "ABSENT"))\nprint("PATH" in os.environ)\n',
    });
    delete process.env.STACKAMIT_CANARY_SECRET;
    expect(col.stdout).toContain('ABSENT');
    expect(col.stdout).toContain('True'); // PATH itself still has to be there
    expect(col.stdout).not.toContain('must-not-leak');
  });

  it('gives the child the directories the tool lookup searched but this process never had', async () => {
    // The reported failure class: the app *finds* a tool through the recovered
    // registry PATH, then hands the program the older snapshot, so anything the
    // program runs by name (`git`, `npm`, a compiler) is "not recognized".
    if (process.platform !== 'win32') return;
    await refreshPathFromRegistry(true);
    const own = new Set(mergePathDirs(process.env.PATH).map((d) => d.toLowerCase()));
    const recovered = pathSearchDirs().filter((d) => !own.has(d.toLowerCase()));
    if (!recovered.length) {
      console.log('[localRun] BLOCKED: this process already has the whole registry PATH — nothing to recover');
      return;
    }
    // Stand in for a base environment that is missing the recovered directory.
    const base = { PATH: mergePathDirs(process.env.PATH).join(path.delimiter) } as any;
    const out = sanitizeEnv(base);
    const given = mergePathDirs(out.PATH).map((d) => d.toLowerCase());
    for (const dir of recovered) expect(given, dir).toContain(dir.toLowerCase());
    // Additive only: the snapshot's own entries keep their original order.
    expect(given.slice(0, mergePathDirs(process.env.PATH).length)).toEqual(
      mergePathDirs(process.env.PATH).map((d) => d.toLowerCase()),
    );
  });
});

// ---------------------------------------------------------------------------
// Real execution per runtime
// ---------------------------------------------------------------------------
describe('python local run', () => {
  it.skipIf(!found.python)('runs an unsaved buffer and cleans up its temp folder', async () => {
    const col = await runToCompletion({ language: 'python', sourceCode: 'print("hello from python")\n' });
    expect(col.result.ok).toBe(true);
    expect(col.stdout).toContain('hello from python');
    expect(col.exit?.code).toBe(0);
    expect(col.info).toMatch(/Running an unsaved copy from /);
    const scratch = /Running an unsaved copy from (.+)\n/.exec(col.info)?.[1];
    expect(scratch).toBeTruthy();
    expect(await waitFor(() => !fs.existsSync(scratch!)), `temp dir ${scratch} left behind`).toBe(true);
  });

  it.skipIf(!found.python)('runs the saved file in its own folder, including spaces and non-ASCII', async () => {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'folder with space ünïcødē 测试-'));
    fs.writeFileSync(path.join(dir, 'data.txt'), 'next-to-me');
    const file = path.join(dir, 'main.py');
    fs.writeFileSync(file, 'import os\nprint(os.path.basename(os.getcwd()))\nprint(open("data.txt").read().strip())\n', 'utf8');
    const col = await runToCompletion({ language: 'python', sourceCode: 'ignored()', filePath: file });
    expect(col.result.ok).toBe(true);
    expect(col.stdout).toContain('next-to-me'); // cwd is the project folder, not a temp dir
    expect(col.info).not.toMatch(/unsaved copy/);
    expect(col.exit?.code).toBe(0);
    // The user's own folder must be left completely alone.
    expect(fs.existsSync(path.join(dir, 'data.txt'))).toBe(true);
    expect(fs.readdirSync(dir)).toContain('main.py');
  });

  it.skipIf(!found.python)('streams stdout and stderr on separate channels', async () => {
    const col = await runToCompletion({
      language: 'python',
      sourceCode: 'import sys\nprint("to-stdout")\nsys.stderr.write("to-stderr\\n")\n',
    });
    expect(col.stdout).toContain('to-stdout');
    expect(col.stdout).not.toContain('to-stderr');
    expect(col.stderr).toContain('to-stderr');
  });

  it.skipIf(!found.python)('reports the real exit code of a failing program', async () => {
    const col = await runToCompletion({ language: 'python', sourceCode: 'import sys\nsys.exit(3)\n' });
    expect(col.exit?.code).toBe(3);
    expect(col.exit?.timedOut).toBeFalsy();
  });

  it.skipIf(!found.python)('surfaces a traceback as runtime output rather than swallowing it', async () => {
    const col = await runToCompletion({ language: 'python', sourceCode: 'print(1/0)\n' });
    expect(col.exit?.code).not.toBe(0);
    expect(col.stderr).toMatch(/ZeroDivisionError/);
  });

  it.skipIf(!found.python)('delivers stdin to the running program', async () => {
    const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
    const res = await start({ language: 'python', sourceCode: 'import sys\nprint("got:"+sys.stdin.readline().strip())\n', tempRoot, timeoutMs: 20000 }, (e) => {
      if (e.type === 'stdout') col.stdout += e.data;
      if (e.type === 'info') col.info += e.data;
      if (e.type === 'exit') col.exit = e;
    });
    expect(res.ok).toBe(true);
    const id = (res as any).sessionId as string;
    // Feed a line, then close stdin so a `read()`-style program can finish too.
    expect(writeStdin(id, 'phase2-input\n')).toBe(true);
    await waitFor(() => col.exit !== null, 15000);
    expect(col.stdout).toContain('got:phase2-input');
  });

  it.skipIf(!found.python)('streamlines long output into a bounded, labelled result', async () => {
    const col = await runToCompletion({
      language: 'python',
      sourceCode: `import sys\nsys.stdout.write("x" * ${MAX_OUTPUT_CHARS + 50000})\n`,
    });
    expect(col.stdout.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(col.info).toMatch(/output truncated/);
    expect(col.exit?.code).toBe(0);
  });

  it.skipIf(!found.python)('kills a program that outruns the local time limit', async () => {
    const col = await runToCompletion({
      language: 'python',
      sourceCode: 'import os,time\nprint("pid:"+str(os.getpid()))\nimport sys\nsys.stdout.flush()\ntime.sleep(120)\n',
      timeoutMs: 1500,
    }, 20000);
    expect(col.exit?.timedOut).toBe(true);
    expect(col.info).toMatch(/time limit/);
    const pid = Number(/pid:(\d+)/.exec(col.stdout)?.[1]);
    expect(Number.isFinite(pid)).toBe(true);
    expect(await waitFor(() => !isAlive(pid), 5000), `python pid ${pid} survived the timeout`).toBe(true);
    expect(activeSessionIds()).not.toContain(col.result.sessionId as string);
  });

  it.skipIf(!found.python)('Stop terminates the child process', async () => {
    const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
    const res = await start(
      { language: 'python', sourceCode: 'import os,time\nprint("pid:"+str(os.getpid()))\nimport sys\nsys.stdout.flush()\ntime.sleep(120)\n', tempRoot, timeoutMs: 60000 },
      (e) => {
        if (e.type === 'stdout') col.stdout += e.data;
        if (e.type === 'info') col.info += e.data;
        if (e.type === 'exit') col.exit = e;
      },
    );
    expect(res.ok).toBe(true);
    const id = (res as any).sessionId as string;
    await waitFor(() => /pid:\d+/.test(col.stdout), 10000);
    const pid = Number(/pid:(\d+)/.exec(col.stdout)![1]);
    expect(stop(id)).toBe(true);
    expect(await waitFor(() => col.exit !== null, 5000)).toBe(true);
    expect(col.exit?.stopped).toBe(true);
    expect(col.info).toMatch(/Stopped by user/);
    expect(await waitFor(() => !isAlive(pid), 5000), `python pid ${pid} survived Stop`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Active-file execution (regression: the old code always ran `main.*`)
// ---------------------------------------------------------------------------
describe('selected-file execution (active tab, not a hardcoded entry point)', () => {
  it.skipIf(!found.python)('runs a.py and prints its own value, not main.py', async () => {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'active-a-'));
    const file = path.join(dir, 'a.py');
    fs.writeFileSync(file, 'a = 5\nprint(a)\n', 'utf8');
    const col = await runToCompletion({ language: 'python', sourceCode: '', filePath: file });
    expect(col.result.ok).toBe(true);
    expect(col.stdout.trim()).toBe('5');
    expect(col.exit?.code).toBe(0);
    // The command line shown to the user must name the real file.
    expect(col.info).toMatch(/python -u a\.py/);
    expect(col.info).not.toMatch(/main\.py/);
  });

  it.skipIf(!found.python)('prefers the selected hello.py over a main.py sitting beside it', async () => {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'active-hello-'));
    fs.writeFileSync(path.join(dir, 'main.py'), 'print("WRONG: main ran")\n', 'utf8');
    const hello = path.join(dir, 'hello.py');
    fs.writeFileSync(hello, 'print("hello ran")\n', 'utf8');
    const col = await runToCompletion({ language: 'python', sourceCode: '', filePath: hello });
    expect(col.stdout).toContain('hello ran');
    expect(col.stdout).not.toContain('WRONG');
    expect(col.exit?.code).toBe(0);
  });

  it.skipIf(!found.python)('runs a selected file whose folder contains spaces', async () => {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'my projects folder-'));
    const file = path.join(dir, 'a.py');
    fs.writeFileSync(file, 'print("spaces ok")\n', 'utf8');
    const col = await runToCompletion({ language: 'python', sourceCode: '', filePath: file });
    expect(col.stdout).toContain('spaces ok');
    expect(col.exit?.code).toBe(0);
  });

  it.skipIf(!found.python)('runs each of two different files with its own contents', async () => {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'active-two-'));
    const one = path.join(dir, 'one.py');
    const two = path.join(dir, 'two.py');
    fs.writeFileSync(one, 'print("from one")\n', 'utf8');
    fs.writeFileSync(two, 'print("from two")\n', 'utf8');
    const colOne = await runToCompletion({ language: 'python', sourceCode: '', filePath: one });
    expect(colOne.stdout).toContain('from one');
    expect(colOne.stdout).not.toContain('from two');
    const colTwo = await runToCompletion({ language: 'python', sourceCode: '', filePath: two });
    expect(colTwo.stdout).toContain('from two');
    expect(colTwo.stdout).not.toContain('from one');
  });

  it.skipIf(!found.python)('runs the current buffer contents when the file has unsaved edits', async () => {
    // Mirrors the renderer's dirty-buffer path: no filePath is sent, so the
    // editor text is written to a temp copy and executed as-is.
    const col = await runToCompletion({ language: 'python', sourceCode: 'print("unsaved buffer")\n' });
    expect(col.stdout).toContain('unsaved buffer');
    expect(col.info).toMatch(/unsaved copy/);
    expect(col.exit?.code).toBe(0);
  });

  it.skipIf(!found.javascript)('runs the selected .js file, not main.js', async () => {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'active-node-'));
    fs.writeFileSync(path.join(dir, 'main.js'), 'console.log("WRONG"),', 'utf8');
    const app = path.join(dir, 'app.js');
    fs.writeFileSync(app, 'console.log("app ran");\n', 'utf8');
    const col = await runToCompletion({ language: 'javascript', sourceCode: '', filePath: app });
    expect(col.stdout).toContain('app ran');
    expect(col.stdout).not.toContain('WRONG');
    expect(col.exit?.code).toBe(0);
  });

  it.skipIf(!found.powershell)('runs the selected .ps1 file, not main.ps1', async () => {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'active-ps-'));
    fs.writeFileSync(path.join(dir, 'main.ps1'), 'Write-Output "WRONG"\n', 'utf8');
    const script = path.join(dir, 'task.ps1');
    fs.writeFileSync(script, 'Write-Output "task ran"\n', 'utf8');
    const col = await runToCompletion({ language: 'powershell', sourceCode: '', filePath: script });
    expect(col.stdout).toContain('task ran');
    expect(col.stdout).not.toContain('WRONG');
    expect(col.exit?.code).toBe(0);
  });
});

describe('node.js local run', () => {
  it.skipIf(!found.javascript)('runs an unsaved buffer and separates stdout from stderr', async () => {
    const col = await runToCompletion({
      language: 'javascript',
      sourceCode: 'console.log("to-stdout");console.error("to-stderr");\n',
    });
    expect(col.stdout).toContain('to-stdout');
    expect(col.stderr).toContain('to-stderr');
    expect(col.exit?.code).toBe(0);
  });

  it.skipIf(!found.javascript)('reports a non-zero exit code', async () => {
    const col = await runToCompletion({ language: 'javascript', sourceCode: 'process.exit(7);\n' });
    expect(col.exit?.code).toBe(7);
  });

  it.skipIf(!found.javascript)('surfaces an unhandled exception with its stack', async () => {
    const col = await runToCompletion({ language: 'javascript', sourceCode: 'null.foo;\n' });
    expect(col.exit?.code).not.toBe(0);
    expect(col.stderr).toMatch(/TypeError/);
  });

  it.skipIf(!found.javascript)('runs a saved file from a path with spaces and non-ASCII', async () => {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'a b ünïcødē 测试-'));
    const file = path.join(dir, 'main.js');
    fs.writeFileSync(file, "const fs=require('fs');console.log(fs.readFileSync('sibling.txt','utf8').trim());console.log(process.cwd()===__dirname);\n", 'utf8');
    fs.writeFileSync(path.join(dir, 'sibling.txt'), 'sibling-read-ok', 'utf8');
    const col = await runToCompletion({ language: 'javascript', sourceCode: 'throw new Error("wrong")', filePath: file });
    expect(col.stdout).toContain('sibling-read-ok');
    expect(col.stdout).toContain('true');
    expect(col.exit?.code).toBe(0);
  });

  it.skipIf(!found.javascript)('reads stdin from the running process', async () => {
    const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
    const res = await start(
      { language: 'javascript', sourceCode: 'process.stdin.setEncoding("utf8");process.stdin.once("data",d=>console.log("got:"+d.trim()));\n', tempRoot, timeoutMs: 20000 },
      (e) => {
        if (e.type === 'stdout') col.stdout += e.data;
        if (e.type === 'exit') col.exit = e;
      },
    );
    const id = (res as any).sessionId as string;
    writeStdin(id, 'node-stdin\n');
    // The program keeps its stdin open, so stopping it is what ends the run.
    await waitFor(() => /got:node-stdin/.test(col.stdout), 12000);
    stop(id);
    expect(col.stdout).toContain('got:node-stdin');
  });
});

describe('powershell local run', () => {
  it.skipIf(!found.powershell)('runs a buffer written with the Bypass policy', async () => {
    const col = await runToCompletion({
      language: 'powershell',
      sourceCode: 'Write-Output "to-stdout"\n[Console]::Error.WriteLine("to-stderr")\n',
    });
    expect(col.stdout).toContain('to-stdout');
    expect(col.stderr).toContain('to-stderr');
    expect(col.exit?.code).toBe(0);
  });

  it.skipIf(!found.powershell)('reports the exit code of a failing script', async () => {
    const col = await runToCompletion({ language: 'powershell', sourceCode: 'exit 42\n' });
    expect(col.exit?.code).toBe(42);
  });

  it.skipIf(!found.powershell)('handles spaces and non-ASCII in the project path', async () => {
    const dir = fs.mkdtempSync(path.join(tempRoot, 'ps folder üñï 測試-'));
    const file = path.join(dir, 'main.ps1');
    fs.writeFileSync(file, "Get-Content './data.txt' | Write-Output\n", 'utf8');
    fs.writeFileSync(path.join(dir, 'data.txt'), 'ps-sibling-ok 测试', 'utf8');
    const col = await runToCompletion({ language: 'powershell', sourceCode: 'Write-Output "ignored"', filePath: file });
    expect(col.stdout).toContain('ps-sibling-ok');
  });

  it.skipIf(!found.powershell)('is killed by the local timeout', async () => {
    const col = await runToCompletion({ language: 'powershell', sourceCode: 'Start-Sleep -Seconds 120\n', timeoutMs: 1500 }, 20000);
    expect(col.exit?.timedOut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Java local run — the one language whose availability comes from a JDK
// ---------------------------------------------------------------------------

/**
 * Java cannot reuse the PATH lookup the other runtimes are skipped on: a JDK is
 * normally *not* on PATH on Windows, and the runner validates a home directory
 * instead. So the skip decision re-runs the app's own candidate scan,
 * synchronously, at collection time.
 */
function jdkHomeAtCollectionTime(): string | null {
  for (const home of jdkCandidateHomes()) {
    if (!isJdkHome(home)) continue;
    if (fs.existsSync(path.join(home, 'bin', IS_WIN ? 'javac.exe' : 'javac'))) return home;
  }
  return null;
}

const JAVA_JDK_HOME = jdkHomeAtCollectionTime();
const hasJdk = Boolean(JAVA_JDK_HOME);
console.log(
  `[localRun] java: ${hasJdk ? `real JDK for execution tests at ${JAVA_JDK_HOME}` : 'NO JDK on this machine — the Java execution block below is skipped, not passed'}`,
);

/** The exact program the bug report was about. */
const JAVA_STDLIB = [
  'import java.util.ArrayList;',
  'import java.util.List;',
  '',
  'public class Main {',
  '  public static void main(String[] args) {',
  '    List<String> names = new ArrayList<>();',
  '    names.add("Amit");',
  '    System.out.println(names);',
  '  }',
  '}',
  '',
].join('\n');

/** Detection the runner would produce on a machine with no usable Java. */
function stubRuntimes(overrides: Record<string, Partial<DetectedRuntime>> = {}): Record<string, DetectedRuntime> {
  const base: Record<string, DetectedRuntime> = {};
  for (const [key, probe] of Object.entries(LOCAL_RUNTIMES)) {
    base[key] = { key, label: probe.label, available: false, cmd: null, path: null, version: null, installHint: probe.installHint };
  }
  for (const [key, patch] of Object.entries(overrides)) base[key] = { ...base[key], ...patch } as DetectedRuntime;
  return base;
}

describe('java local run', () => {
  it.skipIf(!hasJdk)(
    'runs the reported standard-library example and prints [Amit]',
    async () => {
      const col = await runToCompletion({ language: 'java', sourceCode: JAVA_STDLIB }, 60000);
      expect(col.result.ok, JSON.stringify(col.result)).toBe(true);
      expect(col.stdout).toContain('[Amit]');
      expect(col.exit?.code).toBe(0);
      // What was chosen has to be visible, not just the result.
      expect(col.info).toMatch(/Java · (source-file mode|javac → java)/);
      expect(col.info).toMatch(/\$ java /);
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'runs the second reported example (java.time.LocalDate)',
    async () => {
      const col = await runToCompletion({
        language: 'java',
        sourceCode: 'import java.time.LocalDate;\n\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(LocalDate.now());\n  }\n}\n',
      }, 60000);
      expect(col.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(col.exit?.code).toBe(0);
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'runs the selected saved file from a folder whose name has spaces and non-ASCII characters',
    async () => {
      const dir = fs.mkdtempSync(path.join(tempRoot, 'java my projects ünïcødē 测试-'));
      const file = path.join(dir, 'Main.java');
      fs.writeFileSync(file, JAVA_STDLIB, 'utf8');
      const col = await runToCompletion({ language: 'java', sourceCode: 'ignored()', filePath: file }, 60000);
      expect(col.result.ok, col.stdout + col.stderr + col.errors).toBe(true);
      expect(col.stdout).toContain('[Amit]');
      expect(col.exit?.code).toBe(0);
      // The real file ran, not a temp copy of the buffer.
      expect(col.info).not.toMatch(/unsaved copy/);
      // …and the project folder still holds nothing but the user's source.
      expect(fs.readdirSync(dir).filter((f) => f.endsWith('.class'))).toEqual([]);
      expect(fs.existsSync(file)).toBe(true);
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'separates a successful compile from a genuine missing-dependency error',
    async () => {
      const col = await runToCompletion(
        {
          language: 'java',
          sourceCode:
            'import org.apache.commons.lang3.StringUtils;\n\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(StringUtils.join(new String[] {"x"}, ","));\n  }\n}\n',
        },
        60000,
      );
      // The run itself started; the *compiler* is what refuses, and its real
      // diagnostics reach the user instead of a hidden fallback.
      expect(col.result.ok).toBe(true);
      expect(col.exit?.code).not.toBe(0);
      expect(col.stderr).toMatch(/package org\.apache\.commons\.lang3 does not exist/);
      expect(col.stdout).toBe('');
      // Nothing was left behind in the temp area either.
      expect(await waitFor(() => activeSessionIds().length === 0, 5000)).toBe(true);
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'reports javac syntax diagnostics and runs nothing when the build step fails',
    async () => {
      // A declared package forces the two-step plan, so the *build* step can
      // fail on its own: the compiler's real message must reach the Output
      // panel and the stale/absent class must never be executed.
      const col = await runToCompletion(
        {
          language: 'java',
          sourceCode: 'package com.demo;\n\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println("unreachable"\n}\n',
        },
        60000,
      );
      expect(col.result.ok).toBe(true); // the run started; javac is what refused
      expect(col.exit?.code, `exit was ${col.exit?.code}, stderr ${col.stderr}`).not.toBe(0);
      expect(col.stderr).toMatch(/error:/);
      // javac's own wording, whatever it is: the diagnostics are real compiler
      // output with file:line positions, not a generic app error.
      expect(col.stderr).toMatch(/^Main\.java:\d+: error: /m);
      expect(col.stderr).toMatch(/expected/i);
      expect(col.stderr).toMatch(/\d+ errors?/);
      expect(col.stdout).not.toContain('unreachable');
      expect(col.info).toMatch(/stopped: javac failed/);
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'compiles the dependent source files a multi-file project references',
    async () => {
      const dir = fs.mkdtempSync(path.join(tempRoot, 'java-multi-'));
      fs.writeFileSync(
        path.join(dir, 'Main.java'),
        'import java.util.ArrayList;\nimport java.util.List;\n\npublic class Main {\n  public static void main(String[] args) {\n    List<String> names = new ArrayList<>();\n    names.add("Amit");\n    System.out.println(new Greeter().greet(names.get(0)));\n  }\n}\n',
        'utf8',
      );
      fs.writeFileSync(path.join(dir, 'Greeter.java'), 'public class Greeter {\n  public String greet(String who) {\n    return "Hello, " + who;\n  }\n}\n', 'utf8');
      const col = await runToCompletion({ language: 'java', sourceCode: '', filePath: path.join(dir, 'Main.java') }, 60000);
      expect(col.stdout).toContain('Hello, Amit');
      expect(col.exit?.code).toBe(0);
      expect(fs.readdirSync(dir).filter((f) => f.endsWith('.class'))).toEqual([]);
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'handles a package declaration: qualified main class, sources compiled outside the project folder',
    async () => {
      const srcRoot = path.join(fs.mkdtempSync(path.join(tempRoot, 'java-pkg-')), 'src', 'main', 'java');
      const pkgDir = path.join(srcRoot, 'com', 'demo');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, 'App.java'),
        'package com.demo;\n\npublic class App {\n  public static void main(String[] args) {\n    System.out.println(new Greeter().hi());\n  }\n}\n',
        'utf8',
      );
      fs.writeFileSync(path.join(pkgDir, 'Greeter.java'), 'package com.demo;\n\npublic class Greeter {\n  public String hi() {\n    return "packaged-run-ok";\n  }\n}\n', 'utf8');
      const col = await runToCompletion({ language: 'java', sourceCode: '', filePath: path.join(pkgDir, 'App.java') }, 60000);
      expect(col.result.ok, JSON.stringify(col.result)).toBe(true);
      // A declared package rules source-file mode out, so this is the two-step
      // path and the main class is named with its package.
      expect(col.info).toMatch(/javac → java · main class com\.demo\.App/);
      expect(col.stdout).toContain('packaged-run-ok');
      expect(col.exit?.code).toBe(0);
      expect(fs.readdirSync(pkgDir)).toEqual(['App.java', 'Greeter.java']);
      // The scratch class folder this run created is cleaned up again.
      const outDir = /-d (\S*classes)/.exec(col.info)?.[1];
      expect(outDir).toBeTruthy();
      expect(await waitFor(() => !fs.existsSync(outDir as string), 8000), `scratch ${outDir} left behind`).toBe(true);
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'names an unsaved buffer after its public class so javac accepts it',
    async () => {
      const col = await runToCompletion({
        language: 'java',
        sourceCode: '// the file is untitled, the class is Widget\npublic class Widget {\n  public static void main(String[] a) {\n    System.out.println("widget ran");\n  }\n}\n',
      }, 60000);
      expect(col.info).toMatch(/Widget\.java/);
      expect(col.stdout).toContain('widget ran');
      expect(col.exit?.code).toBe(0);
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'delivers stdin to the running Java program',
    async () => {
      const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
      const res = await start(
        {
          language: 'java',
          sourceCode: 'import java.util.Scanner;\n\npublic class Main {\n  public static void main(String[] a) {\n    Scanner s = new Scanner(System.in);\n    System.out.println("got:" + s.nextLine());\n  }\n}\n',
          tempRoot,
          timeoutMs: 30000,
        },
        (e) => {
          if (e.type === 'stdout') col.stdout += e.data;
          if (e.type === 'info') col.info += e.data;
          if (e.type === 'exit') col.exit = e;
        },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      writeStdin(res.sessionId, 'unicode 测试 line\n');
      expect(await waitFor(() => col.exit !== null, 45000)).toBe(true);
      expect(col.stdout).toContain('got:unicode 测试 line');
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'kills a Java program that outruns the local time limit',
    async () => {
      const col = await runToCompletion(
        {
          language: 'java',
          sourceCode:
            'public class Main {\n  public static void main(String[] a) throws Exception {\n    System.out.println("pid:" + ProcessHandle.current().pid());\n    System.out.flush();\n    Thread.sleep(120000);\n  }\n}\n',
          timeoutMs: 12000,
        },
        40000,
      );
      expect(col.exit?.timedOut).toBe(true);
      expect(col.info).toMatch(/time limit/);
      const pid = Number(/pid:(\d+)/.exec(col.stdout)?.[1]);
      expect(Number.isFinite(pid)).toBe(true);
      expect(await waitFor(() => !isAlive(pid), 8000), `java pid ${pid} survived the timeout`).toBe(true);
    },
    90000,
  );

  it.skipIf(!hasJdk)(
    'Stop terminates a running Java program',
    async () => {
      const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
      const res = await start(
        {
          language: 'java',
          sourceCode:
            'public class Main {\n  public static void main(String[] a) throws Exception {\n    System.out.println("pid:" + ProcessHandle.current().pid());\n    System.out.flush();\n    Thread.sleep(120000);\n  }\n}\n',
          tempRoot,
          timeoutMs: 60000,
        },
        (e) => {
          if (e.type === 'stdout') col.stdout += e.data;
          if (e.type === 'info') col.info += e.data;
          if (e.type === 'exit') col.exit = e;
        },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(await waitFor(() => /pid:\d+/.test(col.stdout), 30000)).toBe(true);
      const pid = Number(/pid:(\d+)/.exec(col.stdout)![1]);
      expect(stop(res.sessionId)).toBe(true);
      expect(await waitFor(() => col.exit !== null, 8000)).toBe(true);
      expect(col.exit?.stopped).toBe(true);
      expect(await waitFor(() => !isAlive(pid), 8000), `java pid ${pid} survived Stop`).toBe(true);
    },
    90000,
  );

  it('refuses to run Java when no JDK can be validated, and names what to install', async () => {
    // The detection answer a JDK-less machine produces (a launcher alone is not
    // enough), so this path is asserted everywhere, including here.
    const res = await start({ language: 'java', sourceCode: JAVA_STDLIB, tempRoot }, () => undefined, async () => stubRuntimes());
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('RUNTIME_MISSING');
    expect((res as any).message).toMatch(/JDK|development kit/i);
  });

  it('refuses to spawn anything when the plan itself cannot find a JDK', async () => {
    // A runtime record that claims Java without carrying a validated home is
    // re-checked with the injected finder; when that finds nothing, the run
    // stops before a process is spawned and cleans up its temp copy.
    let sawStart = false;
    const res = await start(
      { language: 'java', sourceCode: JAVA_STDLIB, tempRoot },
      (e) => {
        if (e.type === 'info' && /Running an unsaved copy/.test(e.data)) sawStart = true;
      },
      async () =>
        stubRuntimes({
          java: { available: true, cmd: 'java', path: JAVA_JDK_HOME ? path.join(JAVA_JDK_HOME, 'bin', 'java.exe') : null, version: 'claimed by the caller', jdk: null },
        }),
      { findJdk: async () => null },
    );
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('JDK_MISSING');
    expect((res as any).message).toMatch(/No Java development kit/i);
    expect(sawStart).toBe(false);
  });

  it('reports a runtime-only Java install (no javac) instead of pretending', async () => {
    // `isJdkHome` accepts an install that carries a launcher plus a module
    // image, which is exactly a JRE with `lib/modules`. Compiling needs javac.
    const home = fs.mkdtempSync(path.join(tempRoot, 'jre-only-'));
    fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'), '');
    fs.writeFileSync(path.join(home, 'release'), 'JAVA_VERSION="21.0.2"\n', 'utf8');
    const res = await LOCAL_PLANS.java.prepare!({
      rt: { key: 'java', label: 'Java', available: true, cmd: 'java', path: null, version: null, installHint: '', jdk: { home, javaExe: path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'), version: '21.0.2', major: 21, source: 'custom' } },
      target: 'Main.java',
      cwd: home,
      sourceFile: path.join(home, 'Main.java'),
      tempDir: null,
      tempRoot,
      usingSavedFile: true,
      jdkPath: null,
      compilerPath: null,
      projectPath: null,
      workspaceRoot: null,
      discoverCpp: async () => ({ compiler: null, rejected: [] }),
      discoverTypeScript: async () => ({ compiler: null, rejected: [] }),
      findJdk: async () => null,
    });
    expect('steps' in res).toBe(false);
    expect((res as any).code).toBe('JRE_ONLY');
    expect((res as any).message).toMatch(/has no compiler \(javac\)/i);
  });
});

// ---------------------------------------------------------------------------
// Unicode output and concurrency guard
// ---------------------------------------------------------------------------
describe('output fidelity and session limits', () => {
  it.skipIf(!found.python)('preserves non-ASCII and emoji in program output', async () => {
    const col = await runToCompletion({
      language: 'python',
      sourceCode: 'print("ünïcødē 测试 🧪")\n',
    });
    expect(col.stdout.trim()).toBe('ünïcødē 测试 🧪');
  });

  it.skipIf(!found.python)(`caps simultaneous runs at ${MAX_SESSIONS}`, async () => {
    const started: string[] = [];
    const noop = () => undefined;
    for (let i = 0; i < MAX_SESSIONS; i += 1) {
      const res = await start({ language: 'python', sourceCode: 'import time\ntime.sleep(10)\n', tempRoot, timeoutMs: 60000 }, noop);
      if (res.ok) started.push(res.sessionId);
    }
    expect(started.length).toBe(MAX_SESSIONS);
    const overflow = await start({ language: 'python', sourceCode: 'print(1)\n', tempRoot, timeoutMs: 60000 }, noop);
    expect(overflow.ok).toBe(false);
    expect((overflow as any).code).toBe('TOO_MANY_RUNS');
    disposeAll();
    expect(await waitFor(() => activeSessionIds().length === 0, 8000)).toBe(true);
  });

  it('never keeps a session record after the process is gone', async () => {
    if (!found.javascript) return;
    const col = await runToCompletion({ language: 'javascript', sourceCode: 'console.log("done");\n' });
    expect(col.exit?.code).toBe(0);
    expect(await waitFor(() => activeSessionIds().length === 0, 5000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TypeScript output-format decision (pure, no toolchain needed). This is the
// logic that replaced the unconditional `--module CommonJS` override, so it is
// pinned directly: a wrong answer here is what made NodeNext projects fail to
// compile and what could otherwise run ES-module output as CommonJS.
// ---------------------------------------------------------------------------
describe('moduleKindIsEsm — the emitted-format decision', () => {
  it('classifies NodeNext/Node16 per the package type (the reported bug)', () => {
    expect(moduleKindIsEsm('NodeNext', 'ES2022', 'module')).toBe(true);
    expect(moduleKindIsEsm('NodeNext', 'ES2022', 'commonjs')).toBe(false);
    expect(moduleKindIsEsm('NodeNext', 'ES2022', null)).toBe(false);
    expect(moduleKindIsEsm('Node16', undefined, 'module')).toBe(true);
    expect(moduleKindIsEsm('nodenext', 'esnext', 'module')).toBe(true);
  });

  it('keeps CommonJS/AMD/UMD/System as CommonJS even beside type: module', () => {
    expect(moduleKindIsEsm('CommonJS', 'ES2020', 'module')).toBe(false);
    expect(moduleKindIsEsm('commonjs', 'ES2022', null)).toBe(false);
    expect(moduleKindIsEsm('AMD', undefined, null)).toBe(false);
    expect(moduleKindIsEsm('UMD', 'ES2020', 'module')).toBe(false);
    expect(moduleKindIsEsm('System', 'ES2020', 'module')).toBe(false);
  });

  it('treats explicit ES module targets as ESM', () => {
    expect(moduleKindIsEsm('ES2020', undefined, null)).toBe(true);
    expect(moduleKindIsEsm('ESNext', 'ES2022', 'commonjs')).toBe(true);
    expect(moduleKindIsEsm('preserve', 'ES2022', null)).toBe(true);
  });

  it('mirrors tsc\'s default when module is unset (ES3/ES5 → CJS, else ESM)', () => {
    expect(moduleKindIsEsm(undefined, 'ES5', null)).toBe(false);
    expect(moduleKindIsEsm(undefined, 'ES3', 'module')).toBe(false);
    expect(moduleKindIsEsm(undefined, undefined, 'module')).toBe(false);
    expect(moduleKindIsEsm(undefined, 'ES2020', null)).toBe(true);
    expect(moduleKindIsEsm(undefined, 'ESNext', null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scratch `node_modules` link — the mechanism that lets a compiled program living
// in a temp output folder resolve the project's installed packages for BOTH the
// CommonJS require and the ES-module loader. Runs with no toolchain: it exercises
// the link and the deletion-safety guarantee directly.
// ---------------------------------------------------------------------------
describe('linkNodeModulesInto — dependency resolution from the scratch dir', () => {
  const mk = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `tslink-${name}-`));

  it('exposes the packages folder inside the output dir and resolves a package through it', () => {
    const out = mk('out');
    const pkgRoot = mk('pkgs');
    const mathjsDir = path.join(pkgRoot, 'mathjs');
    fs.mkdirSync(mathjsDir, { recursive: true });
    fs.writeFileSync(path.join(mathjsDir, 'package.json'), JSON.stringify({ name: 'mathjs', version: '0.0.0', main: 'index.js' }), 'utf8');
    fs.writeFileSync(path.join(mathjsDir, 'index.js'), 'module.exports = { evaluate: (s) => "[" + s + "]" };', 'utf8');

    expect(linkNodeModulesInto(out, pkgRoot)).toBe(true);
    // The linked path is visible inside the output folder and reaches the package.
    const linked = path.join(out, 'node_modules', 'mathjs', 'index.js');
    expect(fs.existsSync(linked)).toBe(true);
    // A bare specifier required from a file inside the output folder resolves
    // through the link — exactly what the compiled ES/CJS program needs at run.
    const req = createRequire(path.join(out, 'probe.cjs'));
    const loaded = req('mathjs');
    expect(loaded.evaluate('2 + 3')).toBe('[2 + 3]');

    // Deleting the scratch output (what cleanupScratch does) removes the link
    // but must NEVER traverse into the real packages folder.
    awaitlessRm(out);
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.existsSync(path.join(mathjsDir, 'index.js'))).toBe(true);
    fs.rmSync(pkgRoot, { recursive: true, force: true });
  });

  it('returns true when the output folder already has a node_modules to use', () => {
    const out = mk('existing');
    fs.mkdirSync(path.join(out, 'node_modules'), { recursive: true });
    expect(linkNodeModulesInto(out, path.join(out, 'node_modules'))).toBe(true);
    fs.rmSync(out, { recursive: true, force: true });
  });
});

/** Small sync helper so the deletion-safety test stays readable. */
function awaitlessRm(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('typescriptModuleFormatHint — actionable diagnostics for module-format conflicts', () => {
  it('explains TS1295 (ESM syntax in a verbatimModuleSyntax CommonJS file) with concrete fixes', () => {
    const out = 'main.ts(2,10): error TS1295: ECMAScript imports and exports cannot be written in a CommonJS file under \'verbatimModuleSyntax\'.';
    const hint = typescriptModuleFormatHint(out);
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/configuration conflict/i);
    expect(hint).toMatch(/"type": "module"/);
    expect(hint).toMatch(/verbatimModuleSyntax/);
    expect(hint).toMatch(/\.mts/);
    // It must never tell the user to start an API server for a desktop run.
    expect(hint).not.toMatch(/API server/i);
  });

  it('explains TS1479 (CommonJS importing an ES-module-only dependency)', () => {
    const out = 'main.ts(2,10): error TS1479: The current file is a CommonJS module whose imports will produce \'require\' calls; however, the referenced file is an ECMAScript module.';
    const hint = typescriptModuleFormatHint(out);
    expect(hint).not.toBeNull();
    expect(hint).toMatch(/configuration conflict/i);
  });

  it('recognises the older TS1286 / TS1287 spelling of the same verbatimModuleSyntax conflict', () => {
    // Bundled/older tsc splits what newer tsc folds into TS1295; the hint must
    // fire for those too so it works across projects on any TypeScript version.
    expect(typescriptModuleFormatHint('main.ts(1,10): error TS1286: ESM syntax is not allowed in a CommonJS module when \'verbatimModuleSyntax\' is enabled.')).toMatch(/configuration conflict/i);
    expect(typescriptModuleFormatHint('dep.ts(1,1): error TS1287: A top-level \'export\' modifier cannot be used on value declarations in a CommonJS module when \'verbatimModuleSyntax\' is enabled.')).toMatch(/configuration conflict/i);
  });

  it('stays silent for unrelated compile errors so they show exactly as tsc wrote them', () => {
    expect(typescriptModuleFormatHint('main.ts(1,7): error TS2322: Type \'string\' is not assignable to type \'number\'.')).toBeNull();
    expect(typescriptModuleFormatHint('')).toBeNull();
  });
});
