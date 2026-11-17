import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { classpathSeparator, planJavaRun, JAVA_UTF8_FLAGS } from '../services/javaRun';
import type { JdkInfo } from '../services/runtimeProbe';
import { analyzeJavaImports } from '../../src/utils/javaImports';

/**
 * Classpath wiring for resolved Java dependencies (the payoff of the resolver).
 *
 * The invariant that matters most: the JARs javac compiles against are the very
 * same JARs the program runs against, so a type that compiles can never fail at
 * runtime with NoClassDefFound. These tests pin that equality, keep the
 * dependency-free path byte-for-byte unchanged, and prove a multi-file project
 * shares one classpath decision.
 */

const IS_WIN = process.platform === 'win32';
const CP = classpathSeparator();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'java-cp-'));

function fixtureJdk({ major = 21 }: { major?: number } = {}): JdkInfo {
  const home = fs.mkdtempSync(path.join(tempRoot, 'jdk-'));
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'), '');
  fs.writeFileSync(path.join(home, 'bin', IS_WIN ? 'javac.exe' : 'javac'), '');
  return { home, javaExe: path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'), version: `${major}.0.1`, major, source: 'custom' };
}

function writeSource(rel: string, text: string): string {
  const file = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

const DEPS = ['/home/user/.m2/repository/org/apache/commons/commons-lang3/3.17.0/commons-lang3-3.17.0.jar'];

describe('planJavaRun + classpath', () => {
  it('leaves the argv untouched when no dependencies are supplied (req 18)', () => {
    const file = writeSource('plain/Main.java', 'import java.util.List;\npublic class Main {}\n');
    const outDir = path.join(tempRoot, 'out-plain');
    const res = planJavaRun({ jdk: fixtureJdk(), sourceFile: file, cwd: path.dirname(file), outDir, buildDescriptor: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.strategy).toBe('source-file');
    // No -cp / --class-path flag appears at all — dependency-free runs are unchanged.
    expect(res.plan.steps[0].args).toEqual([...JAVA_UTF8_FLAGS, 'Main.java']);
    expect(res.plan.steps[0].args.join(' ')).not.toMatch(/class-?path|(^|\s)-cp(\s|$)/i);
  });

  it('puts the same JARs on the compile AND runtime classpath for a packaged run (req 9)', () => {
    const file = writeSource('cpr/src/main/java/com/demo/App.java', 'package com.demo;\nimport org.apache.commons.lang3.StringUtils;\npublic class App {}\n');
    const outDir = path.join(tempRoot, 'out-cpr');
    const res = planJavaRun({ jdk: fixtureJdk({ major: 17 }), sourceFile: file, cwd: path.dirname(file), outDir, buildDescriptor: false, classpath: DEPS });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.strategy).toBe('compile-and-run');
    const [compile, run] = res.plan.steps;

    // javac -cp <deps>
    const cpIdx = compile.args.indexOf('-cp');
    expect(cpIdx).toBeGreaterThan(-1);
    expect(compile.args[cpIdx + 1]).toBe(DEPS.join(CP));

    // java -cp <outDir>:<deps>  → outDir first, then the identical dependency jars
    const runCpIdx = run.args.indexOf('-cp');
    expect(runCpIdx).toBeGreaterThan(-1);
    const runCp: string = run.args[runCpIdx + 1];
    const entries = runCp.split(CP);
    expect(entries[0]).toBe(outDir);
    // Every compile-time dependency is also a runtime entry (equality, req 9).
    for (const dep of DEPS) expect(entries).toContain(dep);

    expect(res.plan.notes.join(' ')).toMatch(/dependencies on the classpath: 1 JAR/);
  });

  it('feeds source-file mode a --class-path carrying the deps', () => {
    const file = writeSource('sfcp/Main.java', 'import org.apache.commons.lang3.StringUtils;\npublic class Main {}\n');
    const res = planJavaRun({ jdk: fixtureJdk({ major: 21 }), sourceFile: file, cwd: path.dirname(file), outDir: path.join(tempRoot, 'out-sfcp'), buildDescriptor: false, classpath: DEPS });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.strategy).toBe('source-file');
    const args = res.plan.steps[0].args;
    const idx = args.indexOf('--class-path');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(DEPS.join(CP));
    // The source file is still the last argument.
    expect(args[args.length - 1]).toBe('Main.java');
  });

  it('drops empty/non-string classpath entries defensively', () => {
    const file = writeSource('dirty/Main.java', 'package p;\npublic class Main {}\n');
    const res = planJavaRun({ jdk: fixtureJdk(), sourceFile: file, cwd: path.dirname(file), outDir: path.join(tempRoot, 'out-dirty'), buildDescriptor: false, classpath: ['', DEPS[0], ''] as string[] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [compile] = res.plan.steps;
    expect(compile.args[compile.args.indexOf('-cp') + 1]).toBe(DEPS[0]);
  });

  it('a multi-file project resolves one shared classpath decision (req 10)', () => {
    // Two files import the same library; detection yields ONE catalog requirement,
    // and the plan carries the single resolved JAR for the whole project. A
    // package declaration forces the compile-and-run path (a real javac + java).
    const a = writeSource('multi/p/A.java', 'package p;\nimport org.apache.commons.lang3.StringUtils;\npublic class A {}\n');
    const b = writeSource('multi/p/B.java', 'package p;\nimport org.apache.commons.lang3.StringUtils;\npublic class B {}\n');
    const analysis = analyzeJavaImports([
      { path: a, content: fs.readFileSync(a, 'utf8') },
      { path: b, content: fs.readFileSync(b, 'utf8') },
    ]);
    expect(analysis.catalog.map((r) => r.fqn)).toEqual(['org.apache.commons.lang3.StringUtils']);

    const outDir = path.join(tempRoot, 'out-multi');
    const res = planJavaRun({ jdk: fixtureJdk({ major: 17 }), sourceFile: a, cwd: path.dirname(a), outDir, buildDescriptor: false, classpath: DEPS });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.strategy).toBe('compile-and-run');
    const [compile, run] = res.plan.steps;
    expect(compile.args[compile.args.indexOf('-cp') + 1]).toBe(DEPS.join(CP));
    expect(run.args[run.args.indexOf('-cp') + 1].split(CP)).toContain(DEPS[0]);
  });

  it('always compiles into a fresh scratch outDir, never the project tree (req 11)', () => {
    // A stale .class left in the project must not be reused: javac writes classes
    // only under -d <outDir>, and the run reads exactly that outDir first.
    const file = writeSource('stale/src/main/java/com/demo/App.java', 'package com.demo;\npublic class App {}\n');
    const outDir = path.join(tempRoot, 'out-stale');
    const res = planJavaRun({ jdk: fixtureJdk({ major: 17 }), sourceFile: file, cwd: path.dirname(file), outDir, buildDescriptor: false, classpath: DEPS });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [compile, run] = res.plan.steps;
    expect(compile.args[compile.args.indexOf('-d') + 1]).toBe(outDir);
    expect(run.args[run.args.indexOf('-cp') + 1].split(CP)[0]).toBe(outDir);
    // Nothing in argv points at the project's own source folder as an output.
    expect(compile.args).not.toContain(path.dirname(file));
  });
});
