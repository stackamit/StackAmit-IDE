import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  JAVAC_UTF8_FLAGS,
  JAVA_UTF8_FLAGS,
  javaBufferFileName,
  javacPathOf,
  parseJavaUnit,
  planJavaRun,
  sourceRootFor,
  stripJavaCommentsAndLiterals,
} from '../services/javaRun';
import type { JdkInfo } from '../services/runtimeProbe';

/**
 * Java run planning — pure decisions, no spawning.
 *
 * `localRun.test.ts` proves the strategies really execute against a JDK; this
 * file pins the *choices*, including the ones a machine without Java could never
 * reach (a JDK 8, a runtime-only JRE, an unreadable version, a project folder
 * whose name the JVM's command-line encoding would mangle).
 */

const IS_WIN = process.platform === 'win32';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'java-run-plan-'));

/** A fixture JDK home: `planJavaRun` only needs the layout to be believable. */
function fixtureJdk({ major = 21, version = '21.0.2', javac = true }: { major?: number | null; version?: string | null; javac?: boolean } = {}): JdkInfo {
  const home = fs.mkdtempSync(path.join(tempRoot, 'jdk-'));
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'), '');
  if (javac) fs.writeFileSync(path.join(home, 'bin', IS_WIN ? 'javac.exe' : 'javac'), '');
  return {
    home,
    javaExe: path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'),
    version,
    major,
    source: 'custom',
  };
}

/** Write a source file under `rel` (POSIX-ish relative path) and return its absolute path. */
function writeSource(rel: string, text: string): string {
  const file = path.join(tempRoot, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

const MAIN = 'import java.util.ArrayList;\nimport java.util.List;\n\npublic class Main {\n  public static void main(String[] args) {\n    List<String> names = new ArrayList<>();\n    names.add("Amit");\n    System.out.println(names);\n  }\n}\n';
const PACKAGED = 'package com.demo;\n\npublic class App {\n  public static void main(String[] args) {\n    System.out.println("app");\n  }\n}\n';

describe('java source scanning', () => {
  it('removes comments and literals so they cannot be read as code', () => {
    const src = [
      '// package not.real; class NotEither {}',
      '/* package second.fake;',
      '   class AlsoFake {} */',
      'String s = "package in.a.string; class InAString {}";',
      'char c = \'\\\'\'; // escaped quote survives',
      'String t = """',
      '  package inside.text.block;',
      '  class InsideTextBlock {}',
      '  """;',
      'package real.pkg;',
      'public class Real {}',
    ].join('\n');
    const clean = stripJavaCommentsAndLiterals(src);
    expect(clean).not.toMatch(/not\.real|AlsoFake|InAString|second\.fake|inside\.text\.block|InsideTextBlock/);
    expect(clean).toMatch(/package real\.pkg;/);
    expect(clean).toMatch(/class Real/);
  });

  it('reads the package and the class that owns main', () => {
    expect(parseJavaUnit(MAIN, 'Main.java')).toEqual({ pkg: null, className: 'Main' });
    expect(parseJavaUnit(PACKAGED, 'App.java')).toEqual({ pkg: 'com.demo', className: 'App' });
    // The class matching the file name wins over another public class listed first.
    expect(parseJavaUnit('public class Helper { }\npublic class Main { }', 'Main.java').className).toBe('Main');
    // No public class at all: the first declared type is the one that was run.
    expect(parseJavaUnit('class Other { }\nclass Main { }', 'Main.java').className).toBe('Main');
    // Not a type declaration: `new Runnable() {}` must not become the class.
    expect(parseJavaUnit('public class Runner { Runnable r = new Runnable() { public void run() { } }; }', 'Runner.java')).toEqual({
      pkg: null,
      className: 'Runner',
    });
    // interfaces, enums and records are types too.
    expect(parseJavaUnit('public interface Contract { }', 'Contract.java').className).toBe('Contract');
    // Nothing recognizable: the file's own base name is still the answer.
    expect(parseJavaUnit('', 'Blank.java')).toEqual({ pkg: null, className: 'Blank' });
  });

  it('names an unsaved buffer after the class it contains', () => {
    expect(javaBufferFileName('public class Widget { }')).toBe('Widget.java');
    expect(javaBufferFileName(PACKAGED)).toBe('App.java');
    expect(javaBufferFileName('// class Fake in a comment\npublic class Main { }')).toBe('Main.java');
  });
});

describe('source root for a package', () => {
  it('walks the package segments out of the layout', () => {
    const file = path.join(tempRoot, 'proj', 'src', 'main', 'java', 'com', 'demo', 'App.java');
    expect(sourceRootFor(file, 'com.demo')).toBe(path.join(tempRoot, 'proj', 'src', 'main', 'java'));
  });

  it('falls back to the file folder when the layout does not match the package', () => {
    // A flat folder holding `package com.demo;` files is normal in small
    // projects: inventing a source root would point javac at nothing.
    const file = path.join(tempRoot, 'flat', 'App.java');
    expect(sourceRootFor(file, 'com.demo')).toBe(path.join(tempRoot, 'flat'));
    expect(sourceRootFor(file, null)).toBe(path.join(tempRoot, 'flat'));
  });

  it('stops at the first segment that does not match', () => {
    const file = path.join(tempRoot, 'x', 'demo', 'App.java');
    expect(sourceRootFor(file, 'com.demo')).toBe(path.join(tempRoot, 'x', 'demo'));
  });
});

describe('run strategy', () => {
  const base = { buildDescriptor: false };

  it('refuses a Java install that has no compiler instead of failing later', () => {
    const file = writeSource('jre/Main.java', MAIN);
    const res = planJavaRun({ jdk: fixtureJdk({ javac: false }), sourceFile: file, cwd: path.dirname(file), outDir: path.join(tempRoot, 'out-jre'), ...base });
    expect('steps' in res).toBe(false);
    expect((res as any).code).toBe('JRE_ONLY');
    expect((res as any).message).toMatch(/has no compiler \(javac\)/i);
    expect((res as any).message).toMatch(/winget install/i);
  });

  it('uses source-file mode for an unpackaged file on a modern JDK', () => {
    const file = writeSource('sf/Main.java', MAIN);
    const res = planJavaRun({ jdk: fixtureJdk({ major: 21 }), sourceFile: file, cwd: path.dirname(file), outDir: path.join(tempRoot, 'out-sf'), ...base });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.strategy).toBe('source-file');
    expect(res.plan.steps).toHaveLength(1);
    const [step] = res.plan.steps;
    expect(step.cmd).toBe('java');
    expect(step.file).toBe(res.plan.steps[0].file);
    expect(step.args).toEqual([...JAVA_UTF8_FLAGS, 'Main.java']);
    expect(step.cwd).toBe(path.dirname(file));
    expect(step.stdin).toBe(true);
    expect(res.plan.notes[0]).toMatch(/source-file mode · JDK 21/);
  });

  it('compiles and runs when the file declares a package', () => {
    const file = writeSource('pkg/src/main/java/com/demo/App.java', PACKAGED);
    const outDir = path.join(tempRoot, 'out-pkg');
    const res = planJavaRun({ jdk: fixtureJdk({ major: 27 }), sourceFile: file, cwd: path.dirname(file), outDir, ...base });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.strategy).toBe('compile-and-run');
    expect(res.plan.mainClass).toBe('com.demo.App');
    const [compile, run] = res.plan.steps;
    expect(compile.cmd).toBe('javac');
    // cwd is the folder above the package path, and every project path in argv
    // is relative to it — an absolute non-ASCII path does not survive the JVM's
    // command-line decoding (measured: `error: Invalid filename`).
    expect(compile.cwd).toBe(path.join(tempRoot, 'pkg', 'src', 'main', 'java'));
    expect(compile.args).toEqual(['-encoding', 'UTF-8', ...JAVAC_UTF8_FLAGS, '-d', outDir, '-sourcepath', '.', path.join('com', 'demo', 'App.java')]);
    // Only the scratch output folder is absolute; the project's own path is not
    // handed to the JVM as an argument at all.
    expect(compile.args.filter((a) => a.startsWith(compile.cwd))).toEqual([]);
    expect(compile.stdin).toBe(false);
    // The program itself runs in the file's own folder, like Python and Node.
    expect(run.args).toEqual([...JAVA_UTF8_FLAGS, '-cp', outDir, 'com.demo.App']);
    expect(run.cwd).toBe(path.dirname(file));
    expect(run.stdin).toBe(true);
  });

  it('compiles and runs on a JDK without source-file mode (JDK 8) and on an unknown version', () => {
    const file = writeSource('old/Main.java', MAIN);
    for (const jdk of [fixtureJdk({ major: 8, version: '1.8.0_452' }), fixtureJdk({ major: null, version: null })]) {
      const outDir = path.join(tempRoot, 'out-old');
      const res = planJavaRun({ jdk, sourceFile: file, cwd: path.dirname(file), outDir, ...base });
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      expect(res.plan.strategy).toBe('compile-and-run');
      expect(res.plan.steps.map((s) => s.cmd)).toEqual(['javac', 'java']);
      // Default package: the source root is the file's own folder.
      expect(res.plan.steps[0].cwd).toBe(path.dirname(file));
      expect(res.plan.steps[0].args).toContain('Main.java');
      // The program is launched by class name with the scratch dir as its path.
      expect(res.plan.steps[1].args.slice(-3)).toEqual(['-cp', outDir, 'Main']);
    }
  });

  it('warns about declared-but-unresolved dependencies instead of claiming support', () => {
    const file = writeSource('maven/Main.java', MAIN);
    const res = planJavaRun({
      jdk: fixtureJdk(),
      sourceFile: file,
      cwd: path.dirname(file),
      outDir: path.join(tempRoot, 'out-mvn'),
      buildDescriptor: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.notes.join(' ')).toMatch(/Maven\/Gradle descriptor/);
    expect(res.plan.notes.join(' ')).toMatch(/not on the classpath/);
  });

  it('keeps argv free of shell syntax, so paths with spaces need no quoting', () => {
    const jdk = fixtureJdk();
    const dir = path.join(tempRoot, 'a folder with spaces ünïcødē 测试');
    const file = path.join(dir, 'Main.java');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, MAIN, 'utf8');
    const res = planJavaRun({ jdk, sourceFile: file, cwd: dir, outDir: path.join(tempRoot, 'out spaces'), ...base });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const step of res.plan.steps) {
      expect(['cmd', 'cmd.exe', 'sh', 'bash', '/bin/sh'], step.cmd).not.toContain(step.cmd);
      expect(step.args.join(' ')).not.toMatch(/[&|><^%]/);
      // The executable is the JDK this app verified, never a bare name that
      // PATH would resolve to whatever happens to be first.
      expect(path.isAbsolute(step.file)).toBe(true);
      expect(step.file.startsWith(jdk.home), `${step.cmd} -> ${step.file}`).toBe(true);
    }
    // No project path is passed absolutely, so a non-ASCII folder name never
    // reaches the JVM's command-line decoder. The program still *runs* in it.
    const javacStep = res.plan.steps.find((s) => s.cmd === 'javac');
    expect(javacStep).toBeUndefined(); // JDK 21 + default package => source-file mode
    const javaStep = res.plan.steps[res.plan.steps.length - 1];
    expect(javaStep.args.filter((a) => a.includes(dir)).length).toBe(0);
    expect(javaStep.cwd).toBe(dir);
    expect(javaStep.args).toEqual([...JAVA_UTF8_FLAGS, 'Main.java']);
  });

  it('names the JDK binaries it verified', () => {
    const jdk = fixtureJdk();
    expect(javacPathOf(jdk)).toBe(path.join(jdk.home, 'bin', IS_WIN ? 'javac.exe' : 'javac'));
  });
});
