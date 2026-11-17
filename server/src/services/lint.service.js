/**
 * Live syntax checking (as-you-type error highlighting).
 *
 * Monaco already validates JavaScript/TypeScript in the browser, but for the
 * compiled / interpreted languages it only tokenizes — no real errors. For
 * those we run the *local* toolchain in syntax-only mode (`gcc -fsyntax-only`,
 * `javac`, `python -m py_compile`) on a throwaway temp file, parse its
 * diagnostics into editor markers, and let the client paint red squiggles at
 * the exact spot.
 *
 * It reuses the same runtime detection as interactive runs, so once a missing
 * toolchain is installed through the consent popup, live linting starts
 * working for that language automatically. No provider/network cost.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { env } from '../config/env.js';
import { getLanguage } from '../config/languages.js';
import { detectRuntimes, resolveCommand } from './runtimes.js';
import { executionEnv } from './executionEnv.js';

// Languages we can syntax-check locally when their toolchain is installed.
// JavaScript/TypeScript are handled natively by Monaco, so they're not here.
const LINTABLE = new Set(['python', 'c', 'cpp', 'java', 'go', 'php', 'ruby', 'shell']);

/** Build the syntax-only command for a language.
 *
 * Where the lint tool IS the command `detectRuntimes()` probed, its resolved
 * `cmd` is used — the fallbacks mirror RUNTIME_PROBES exactly, so lint can
 * never spawn a tool the availability check did not prove. Java (`javac`) and
 * Go (`gofmt`) keep their own names on purpose: the probe verifies `java` and
 * `go`, which are related but different executables. */
function commandFor(languageKey, sourceName, runtimes) {
  switch (languageKey) {
    case 'python':
      return { cmd: runtimes.python?.cmd || 'python', args: ['-m', 'py_compile', sourceName] };
    case 'c':
      return { cmd: runtimes.c?.cmd || 'gcc', args: ['-fsyntax-only', '-Wall', sourceName] };
    case 'cpp':
      return { cmd: runtimes.cpp?.cmd || 'g++', args: ['-fsyntax-only', '-Wall', sourceName] };
    case 'java':
      return { cmd: 'javac', args: ['-proc:none', sourceName] };
    case 'go':
      // `gofmt -e` reports parse errors as `main.go:5:2: expected ...` and
      // prints the formatted file (harmlessly) when the syntax is valid.
      return { cmd: 'gofmt', args: ['-e', sourceName] };
    case 'php':
      return { cmd: runtimes.php?.cmd || 'php', args: ['-l', sourceName] };
    case 'ruby':
      return { cmd: runtimes.ruby?.cmd || 'ruby', args: ['-c', sourceName] };
    case 'shell':
      return { cmd: runtimes.shell?.cmd || 'bash', args: ['-n', sourceName] };
    default:
      return null;
  }
}

/** Run a command to completion, capturing capped stdout/stderr. */
function runCheck(cmd, args, cwd) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(resolveCommand(cmd), args, {
        cwd,
        windowsHide: true,
        env: executionEnv(process.env, { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return resolve({ stdout: '', stderr: String(err?.message || err), code: -1 });
    }
    let stdout = '';
    let stderr = '';
    const cap = env.maxOutputBytes;
    proc.stdout.on('data', (d) => {
      if (stdout.length < cap) stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      if (stderr.length < cap) stderr += d.toString();
    });
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, env.lintTimeoutMs);
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${err?.message || err}`, code: -1 });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/**
 * Parse gcc/clang/javac style diagnostics:
 *   main.c:6:5: error: expected ';' before '}' token
 *   Main.java:9: error: cannot find symbol      (Java has no column)
 */
function parseColonDiagnostics(output) {
  const markers = [];
  const lineRe = /[\w./\\-]+\.(?:c|cpp|cc|cxx|h|hpp|java|go|rb):(\d+):(?:(\d+):)?\s*(error|warning|fatal error|note|syntax error)[,:]?\s*(.+)$/i;
  for (const raw of output.split(/\r?\n/)) {
    const m = lineRe.exec(raw.trim());
    if (!m) continue;
    markers.push({
      line: Number(m[1]),
      column: Number(m[2] || 1),
      severity: /error|fatal/i.test(m[3]) ? 'error' : 'warning',
      message: m[4].trim(),
    });
  }
  return markers;
}

/**
 * Parse Python's py_compile SyntaxError block:
 *   File "main.py", line 3
 *       printt("hi")
 *       ^
 *   SyntaxError: invalid syntax
 */
function parsePython(output) {
  const fileRe = /\bFile "[^"]+", line (\d+)/;
  const fm = fileRe.exec(output);
  if (!fm) return [];
  const line = Number(fm[1]);

  // The caret line under the offending source indicates the column.
  let column = 1;
  const after = output.slice(output.indexOf(fm[0]));
  const blockLines = after.split(/\r?\n/).slice(1);
  for (const t of blockLines) {
    const caret = t.indexOf('^');
    if (caret >= 0) {
      column = caret + 1;
      break;
    }
    if (/Error:/.test(t)) break;
  }

  const msgMatch = /(\w*Error):\s*(.+)/.exec(output);
  const message = msgMatch ? `${msgMatch[1]}: ${msgMatch[2].trim()}` : 'Syntax error';
  return [{ line, column, severity: 'error', message }];
}

/**
 * Parse PHP's lint output:
 *   PHP Parse error:  syntax error, unexpected ... in /tmp/x/main.php on line 3
 */
function parsePhp(output) {
  const markers = [];
  const re = /PHP (\w+ error):\s*(.+?) in .*? on line (\d+)/g;
  let m;
  while ((m = re.exec(output))) {
    markers.push({
      line: Number(m[3]),
      column: 1,
      severity: /parse|fatal|compile/i.test(m[1]) ? 'error' : 'warning',
      message: `${m[1]}: ${m[2].trim()}`,
    });
  }
  return markers;
}

/**
 * Parse `bash -n` output:
 *   main.sh: line 3: syntax error near unexpected token `)'
 */
function parseShell(output) {
  const markers = [];
  const re = /[\w./\\-]+\.sh: line (\d+):\s*(.+)$/g;
  let m;
  while ((m = re.exec(output))) {
    markers.push({ line: Number(m[1]), column: 1, severity: 'error', message: m[2].trim() });
  }
  return markers;
}

const PARSERS = {
  python: parsePython,
  php: parsePhp,
  shell: parseShell,
};

/**
 * Lint a snippet for the given language. Returns:
 *   { linted, available, markers, message? }
 * `linted` is true only when a local check actually ran. When disabled or no
 * runtime is present we return an empty marker list (Monaco keeps JS/TS native
 * diagnostics regardless).
 */
export async function lintCode(languageKey, sourceCode) {
  if (!env.localRunEnabled) {
    return { linted: false, available: false, markers: [] };
  }
  if (!LINTABLE.has(languageKey)) {
    return { linted: false, available: true, markers: [] };
  }
  const lang = getLanguage(languageKey);
  if (!lang) return { linted: false, available: false, markers: [] };

  const runtimes = await detectRuntimes();
  const rt = runtimes[languageKey];
  if (!rt || !rt.available) {
    return {
      linted: false,
      available: false,
      markers: [],
      message: `No local ${lang.label} runtime — install it to enable live error checking.`,
    };
  }

  const check = commandFor(languageKey, lang.fileName, runtimes);
  if (!check) return { linted: false, available: true, markers: [] };

  let tempDir = null;
  try {
    tempDir = await mkdtemp(path.join(tmpdir(), 'stackamit-lint-'));
    await writeFile(path.join(tempDir, lang.fileName), String(sourceCode).slice(0, env.maxSourceBytes), 'utf8');
    const { stdout, stderr } = await runCheck(check.cmd, check.args, tempDir);
    const output = `${stderr}\n${stdout}`;
    const parse = PARSERS[languageKey] || parseColonDiagnostics;
    const markers = parse(output)
      // Ignore bogus positions so the editor never throws on a bad marker.
      .filter((m) => Number.isFinite(m.line) && m.line >= 1)
      .slice(0, 40);
    return { linted: true, available: true, markers };
  } catch (err) {
    return { linted: false, available: true, markers: [], message: err?.message || 'Lint failed.' };
  } finally {
    if (tempDir) rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Exported for the registry-drift test: (languageKey, sourceName, runtimes). */
export { LINTABLE, commandFor };
