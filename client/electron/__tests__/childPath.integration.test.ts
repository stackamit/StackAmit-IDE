import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { start, type RunEvent } from '../services/localRun';
import {
  detectLocalRuntimes,
  invalidateLocalRuntimes,
  invalidatePathCache,
  locateOnPath,
  mergePathDirs,
  pathSearchDirs,
  refreshPathFromRegistry,
} from '../services/runtimeProbe';

/**
 * Real-machine check that a *run child* can resolve a tool this process cannot
 * see — the reported failure class ("works in a Command Prompt, is 'not
 * recognized' in the app"), tested for every interpreted language installed here
 * instead of only for the C++ example that surfaced it.
 *
 * The scenario: runtime lookup searches the inherited PATH *plus* the registry
 * PATH, so it can honestly report a tool as available; a child process used to
 * receive only the older inherited snapshot, so anything that program runs by
 * name — `git`, `npm`, a compiler, a helper script — was missing. Each test here
 * starts a real Python/Node/PowerShell program through the same `start()` the Run
 * button calls and asks it to resolve such a tool.
 *
 * It self-skips, with a loud BLOCKED line, where the machine cannot produce the
 * situation (no directory that is both registry-known and missing here, or none
 * of the interpreters installed).
 */

const IS_WIN = process.platform === 'win32';
const systemRoot = String(process.env.SystemRoot || 'C:\\Windows').toLowerCase();
const isSystemDir = (d: string) => d.toLowerCase() === systemRoot || d.toLowerCase().startsWith(systemRoot + path.sep);
const exeIn = (dir: string): string | null => {
  try {
    const f = fs.readdirSync(dir).find((n) => /\.(exe|cmd|bat)$/i.test(n));
    return f ? f.replace(/\.(exe|cmd|bat)$/i, '') : null;
  } catch {
    return null;
  }
};

const savedPath = process.env.PATH;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-childpath-'));

type Setup = { tool: string; dir: string; simulated: boolean } | null;
let setup: Setup = null;
let setupNote = '';

async function prepare(): Promise<Setup> {
  if (!IS_WIN) {
    setupNote = 'the stale environment block is a Windows-process phenomenon';
    return null;
  }
  await refreshPathFromRegistry(true);
  const own = new Set(mergePathDirs(process.env.PATH).map((d) => d.toLowerCase()));
  const candidates = pathSearchDirs().filter((d) => !isSystemDir(d));
  // Best case: a directory the registry lists and this process never had — the
  // real thing, with nothing simulated.
  for (const d of candidates) {
    const tool = exeIn(d);
    if (tool && !own.has(d.toLowerCase())) return { tool, dir: d, simulated: false };
  }
  // Otherwise stand in for it: take a directory this process has out of its PATH
  // and re-read the registry, which still lists it.
  for (const d of [...candidates].reverse()) {
    const tool = exeIn(d);
    if (!tool) continue;
    process.env.PATH = mergePathDirs(process.env.PATH)
      .filter((x) => x.toLowerCase() !== d.toLowerCase())
      .join(path.delimiter);
    invalidatePathCache();
    await refreshPathFromRegistry(true);
    if (!pathSearchDirs().some((x) => x.toLowerCase() === d.toLowerCase())) {
      setupNote = `${d} is not in the registry PATH either, so no repair could restore it`;
      return null;
    }
    return { tool, dir: d, simulated: true };
  }
  setupNote = 'no non-system PATH directory holding an executable to hide';
  return null;
}

/** One run through the app's real execution path; resolves when it exits. */
function run(language: string, sourceCode: string) {
  return new Promise<{ stdout: string; stderr: string; code: number | null; message: string }>((resolve) => {
    const col = { stdout: '', stderr: '', code: null as number | null, message: '' };
    start(
      { language, sourceCode, filePath: null, tempRoot },
      (event: RunEvent) => {
        if (event.type === 'stdout') col.stdout += event.data;
        else if (event.type === 'stderr') col.stderr += event.data;
        else if (event.type === 'error') col.message += event.data;
        else if (event.type === 'exit') {
          col.code = event.code ?? null;
          resolve(col);
        }
      },
    ).then((res) => {
      if (res && !res.ok && 'message' in res) col.message += res.message;
    });
  });
}

describe('run children see the tools the app detected', () => {
  afterAll(() => {
    process.env.PATH = savedPath;
    invalidatePathCache();
    invalidateLocalRuntimes();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const LANGUAGES: { key: string; source: (tool: string) => string }[] = [
    {
      key: 'javascript',
      // A Node program reaching for another CLI is the commonest case: an npm
      // script, a `child_process` call, a build tool.
      source: (tool) =>
        `const { spawnSync } = require('child_process');\n` +
        `const r = spawnSync('where.exe', ['${tool}'], { encoding: 'utf8' });\n` +
        `console.log(r.status === 0 ? 'RESOLVED' : 'NOTRESOLVED');\n`,
    },
    {
      key: 'powershell',
      source: (tool) => `$c = Get-Command ${tool} -ErrorAction SilentlyContinue\nif ($c) { 'RESOLVED' } else { 'NOTRESOLVED' }\n`,
    },
    {
      key: 'python',
      // `subprocess` resolves against PATH through Windows, like `git` would.
      source: (tool) =>
        `import subprocess\n` +
        `r = subprocess.run(['where.exe', '${tool}'], capture_output=True, text=True)\n` +
        `print('RESOLVED' if r.returncode == 0 else 'NOTRESOLVED')\n`,
    },
    {
      key: 'java',
      // `ProcessBuilder` resolves a bare command name against the child PATH —
      // the same call a real project uses to shell out to a tool.
      source: (tool) =>
        `public class Main {\n` +
        `  public static void main(String[] a) throws Exception {\n` +
        `    Process p = new ProcessBuilder("where.exe", "${tool}").redirectErrorStream(true).start();\n` +
        `    p.getInputStream().readAllBytes();\n` +
        `    System.out.println(p.waitFor() == 0 ? "RESOLVED" : "NOTRESOLVED");\n` +
        `  }\n` +
        `}\n`,
    },
  ];

  for (const { key, source } of LANGUAGES) {
    it(`${key}: a child resolves a tool this process was never given`, async () => {
      setup ??= await prepare();
      if (!setup) {
        console.log(`[childPath] BLOCKED: ${setupNote} — real child-PATH tests skipped`);
        return;
      }
      const runtimes = await detectLocalRuntimes();
      if (!runtimes[key]?.available) {
        console.log(`[childPath] BLOCKED: ${key} is not installed here — skipped`);
        return;
      }
      // The app itself can find it (this is what the status bar reports).
      expect(locateOnPath(setup.tool), `${setup.dir} was hidden but ${setup.tool} should still be locatable`).toBeTruthy();

      const res = await run(key, source(setup.tool));
      const verdict = (res.stdout + res.stderr).trim();
      expect(res.message, 'the run itself must not report a spawn failure').not.toMatch(/not recognized|Could not run|ENOENT/);
      expect(verdict, `${setup.tool} lives in ${setup.dir}${setup.simulated ? ' (removed from this process PATH)' : ''}`,
      ).toContain('RESOLVED');
      expect(verdict).not.toContain('NOTRESOLVED');
    }, 120000);
  }
});
