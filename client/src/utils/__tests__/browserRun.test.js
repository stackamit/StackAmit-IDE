import { describe, it, expect } from 'vitest';
import {
  BROWSER_RUNNABLE,
  isBrowserRunnable,
  nodeApiUsage,
  bareImportSpecifiers,
  unawaitedDialogUsage,
  RUNNER_HTML,
  newRunToken,
} from '../browserRun.js';

/**
 * The pure decision helpers behind Web Mode's in-browser JavaScript run. The
 * iframe execution itself needs a real browser engine (blob: module URLs,
 * postMessage) and is exercised end-to-end through the app; these are the parts
 * that must be right before anything runs and can be checked with no DOM.
 */
describe('browserRun — what is genuinely runnable in a page', () => {
  it('claims only JavaScript, never a native language', () => {
    expect(BROWSER_RUNNABLE).toEqual(['javascript']);
    expect(isBrowserRunnable('javascript')).toBe(true);
    // The dangerous claim: C++/Java/Python have no in-page engine.
    for (const lang of ['cpp', 'c', 'java', 'python', 'typescript', 'php', 'go']) {
      expect(isBrowserRunnable(lang), lang).toBe(false);
    }
  });

  it('treats null/undefined source as pure browser code, not a crash', () => {
    expect(nodeApiUsage(undefined)).toEqual([]);
    expect(bareImportSpecifiers(null)).toEqual([]);
  });
});

describe('browserRun — Node-only API detection', () => {
  it('is quiet for ordinary browser JavaScript', () => {
    expect(nodeApiUsage('const x = [1,2,3].map(n => n*2);')).toEqual([]);
  });

  it('names every Node-only surface a program reaches for', () => {
    expect(nodeApiUsage("const fs = require('fs');")).toContain('require() (CommonJS)');
    expect(nodeApiUsage("import fs from 'node:fs';")).toContain('a node: built-in module');
    expect(nodeApiUsage('console.log(__dirname);')).toContain('__dirname / __filename');
    expect(nodeApiUsage('process.exit(1);')).toContain('the process object');
    expect(nodeApiUsage('new Buffer(10);')).toContain('Buffer');
  });

  it('does not flag a browser global that merely shares a word', () => {
    // `process` as a user variable is not `process.env`/`.exit`; only the known
    // Node properties are reported, so a false accusation never blocks a run.
    expect(nodeApiUsage('const process = 5; console.log(process);')).toEqual([]);
  });
});

describe('browserRun — bare (npm) import detection', () => {
  it('ignores relative and URL specifiers a browser can resolve', () => {
    expect(bareImportSpecifiers("import x from './local.js';")).toEqual([]);
    expect(bareImportSpecifiers("import y from '/root.js';")).toEqual([]);
    expect(bareImportSpecifiers("import z from 'https://cdn/_mod.js';")).toEqual([]);
    expect(bareImportSpecifiers("import 'node:fs';")).toEqual([]);
  });

  it('reports a bare package name, deduplicated', () => {
    const src = "import _ from 'lodash';\nimport { pick } from 'lodash';\nimport axios from 'axios';";
    const found = bareImportSpecifiers(src).sort();
    expect(found).toEqual(['axios', 'lodash']);
  });

  it('catches a bare side-effect import too', () => {
    expect(bareImportSpecifiers("import 'regenerator-runtime/runtime';")).toEqual([
      'regenerator-runtime/runtime',
    ]);
  });
});

describe('browserRun — the runner harness', () => {
  it('contains no user content placeholder (source travels by message)', () => {
    // Nothing is interpolated into the runner markup, so `</script>` in program
    // text cannot break out of the sandbox document.
    expect(RUNNER_HTML).not.toMatch(/<%=|\$\{|__SOURCE__/);
    expect(RUNNER_HTML).toContain('__stackamitRun');
    expect(RUNNER_HTML).toContain('postMessage');
  });

  it('bridges prompt/confirm/alert with token + promptId correlation', () => {
    // The interactive input channel: requests tagged with the run token, replies
    // matched on that token and the specific promptId — never a bare resolve.
    expect(RUNNER_HTML).toContain('window.prompt');
    expect(RUNNER_HTML).toContain('window.confirm');
    expect(RUNNER_HTML).toContain('input-request');
    expect(RUNNER_HTML).toContain('__stackamitInput');
    expect(RUNNER_HTML).toContain('promptId');
    expect(RUNNER_HTML).toContain('interactive');
  });

  it('resolves an un-bridged prompt as an immediate EOF rather than hanging', () => {
    // Without the Output-panel bridge prompt() must not block the sandbox.
    expect(RUNNER_HTML).toMatch(/if \(!INTERACTIVE\)[\s\S]*?resolve\(coerce\(kind, null\)\)/);
  });
});

describe('browserRun — per-run correlation token', () => {
  it('mints a distinct, prefixed token per call', () => {
    const a = newRunToken();
    const b = newRunToken();
    expect(a).toMatch(/^r/);
    expect(a).not.toBe(b);
  });
});

describe('browserRun — un-awaited dialog detection (basis for the honest hint)', () => {
  it('flags a prompt() that is not awaited', () => {
    expect(unawaitedDialogUsage('const name = prompt("x");')).toEqual(['prompt']);
    expect(unawaitedDialogUsage('window.alert("hi");')).toEqual(['alert']);
    expect(unawaitedDialogUsage('if (confirm("ok?")) {}')).toEqual(['confirm']);
  });

  it('does not flag an awaited dialog (window. and globalThis. forms included)', () => {
    expect(unawaitedDialogUsage('const name = await prompt("x");')).toEqual([]);
    expect(unawaitedDialogUsage('const ok = await window.confirm("x");')).toEqual([]);
    expect(unawaitedDialogUsage('await globalThis.alert("x");')).toEqual([]);
  });

  it('flags only the un-awaited call when a program mixes both', () => {
    expect(unawaitedDialogUsage('await prompt("a"); confirm("b");')).toEqual(['confirm']);
  });

  it('says nothing when the program never reads input', () => {
    expect(unawaitedDialogUsage('console.log(2 + 2);')).toEqual([]);
  });
});
