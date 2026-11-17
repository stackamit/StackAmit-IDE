import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * Real-tool Java verification (no mocks, no language server download).
 *
 * The reported bug is "every Java import is an error". This suite answers the
 * part of that question that can be settled with the machine alone: does a
 * properly discovered JDK compile and run standard-library imports? It uses the
 * JDK that `runtimeProbe` discovers (JAVA_HOME / PATH / the well-known install
 * roots), so it is honest evidence about *this* machine, and it self-skips —
 * with a loud line in the report — when no JDK is installed.
 *
 * Deliberately out of scope here: resolving Maven/Gradle dependencies. That
 * needs the JDT.LS server plus a build tool, which is covered by
 * languageServer.integration.test.ts and reported BLOCKED when absent.
 */
const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';

// Imported through the module namespace so the synchronous candidate scan below
// uses exactly the same discovery the app uses.
import { isJdkHome, javaMajorOf, jdkCandidateHomes, readJdkReleaseVersion, type JdkInfo } from '../services/runtimeProbe';
import { childEnvironment, redactServerLog } from '../services/languageServer';
import { planJavaRun } from '../services/javaRun';

function discoverLocalJdk(): { home: string; javaExe: string; javacExe: string; major: number | null } | null {
  const candidates = jdkCandidateHomes()
    .filter(isJdkHome)
    .map((home) => {
      const version = readJdkReleaseVersion(home);
      return {
        home,
        javaExe: path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'),
        javacExe: path.join(home, 'bin', IS_WIN ? 'javac.exe' : 'javac'),
        major: javaMajorOf(version),
      };
    })
    // Newest first, same rule the app uses: a leftover 1.8 must not win.
    .sort((a, b) => (b.major ?? -1) - (a.major ?? -1));
  return candidates[0] || null;
}

const JDK = discoverLocalJdk();
const HAS_JDK = !!JDK && (JDK.major === null || JDK.major >= 11);

console.log(
  `[javaToolchain] ${HAS_JDK ? `real JDK found: ${JDK!.home} (major ${JDK!.major ?? 'unknown'})` : 'BLOCKED: no JDK on this machine — real compile tests skipped'}`,
);

const tempDirs: string[] = [];
function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'java-toolchain-'));
  tempDirs.push(dir);
  return dir;
}

function writeJava(dir: string, name: string, text: string): string {
  const file = path.join(dir, `${name}.java`);
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

const STDLIB_COLLECTIONS = `import java.util.ArrayList;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        List<String> names = new ArrayList<>();
        names.add("Amit");
        System.out.println(names);
    }
}
`;

const STDLIB_TIME = `import java.time.LocalDate;

public class Main {
    public static void main(String[] args) {
        System.out.println(LocalDate.now());
    }
}
`;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp noise must not fail a test */
    }
  }
});

describe('machine JDK discovery (shared with the app)', () => {
  it('either finds a real development kit or says so, without throwing', () => {
    // The contract, not the machine: discovery must never invent a JDK.
    if (!JDK) return;
    expect(isJdkHome(JDK.home)).toBe(true);
    expect(fs.existsSync(JDK.javaExe)).toBe(true);
    expect(fs.existsSync(JDK.javacExe)).toBe(true);
  });
});

describe.runIf(HAS_JDK)('standard library resolves with the discovered JDK', () => {
  it('compiles the reported failing example (java.util.ArrayList / List) with no errors', async () => {
    const dir = workspace();
    const file = writeJava(dir, 'Main', STDLIB_COLLECTIONS);
    const out = path.join(dir, 'classes');
    const res = await execFileAsync(JDK!.javacExe, ['-d', out, file], { encoding: 'utf8' });
    expect(String(res.stderr).trim()).toBe('');
    expect(fs.existsSync(path.join(out, 'Main.class'))).toBe(true);
  }, 120000);

  it('compiles and runs java.time.LocalDate (the second reported example)', async () => {
    const dir = workspace();
    const file = writeJava(dir, 'Main', STDLIB_TIME);
    const out = path.join(dir, 'classes');
    await execFileAsync(JDK!.javacExe, ['-d', out, file], { encoding: 'utf8' });
    const run = await execFileAsync(JDK!.javaExe, ['-cp', out, 'Main'], { encoding: 'utf8' });
    expect(run.stdout.trim()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 120000);

  it('runs a standalone file with no build tool at all (source-file mode)', async () => {
    // Why this matters: a lone .java in a folder must work without pom.xml.
    const dir = workspace();
    const file = writeJava(dir, 'Main', STDLIB_COLLECTIONS);
    const run = await execFileAsync(JDK!.javaExe, [file], { encoding: 'utf8' });
    expect(run.stdout.trim()).toBe('[Amit]');
  }, 120000);

  it('executes the exact argv the app builds, in a folder with spaces and non-ASCII names', async () => {
    // The bridge between the planner's unit tests and `localRun`'s real runs:
    // `planJavaRun`'s own steps, spawned verbatim the way the main process
    // spawns them (cwd per step, no shell). A packaged project is the case that
    // needs javac, and javac rejects an absolute non-ASCII path — so the plan
    // must be, and here proves to be, addressable entirely relatively.
    if (!JDK) return;
    const dir = path.join(workspace(), 'my projects ünïcødē 测试');
    const pkgDir = path.join(dir, 'src', 'main', 'java', 'com', 'demo');
    fs.mkdirSync(pkgDir, { recursive: true });
    writeJava(pkgDir, 'App', 'package com.demo;\n\npublic class App {\n  public static void main(String[] args) {\n    System.out.println(new Greeter().hi());\n  }\n}\n');
    writeJava(pkgDir, 'Greeter', 'package com.demo;\n\npublic class Greeter {\n  public String hi() {\n    return "packaged ünïcødē 测试";\n  }\n}\n');
    const jdk: JdkInfo = {
      home: JDK.home,
      javaExe: JDK.javaExe,
      version: readJdkReleaseVersion(JDK.home),
      major: JDK.major,
      source: 'test',
    };
    const outDir = path.join(workspace(), 'classes');
    const res = planJavaRun({ jdk, sourceFile: path.join(pkgDir, 'App.java'), cwd: pkgDir, outDir, buildDescriptor: false });
    expect(res.ok, 'the discovered JDK must be able to plan this run').toBe(true);
    if (!res.ok) return;
    expect(res.plan.strategy).toBe('compile-and-run');
    for (const step of res.plan.steps) {
      // execFile takes argv as an array, exactly as `localRun` does.
      // eslint-disable-next-line no-await-in-loop
      await execFileAsync(step.file, step.args, { cwd: step.cwd, encoding: 'utf8' });
    }
    const run = await execFileAsync(res.plan.steps[1].file, res.plan.steps[1].args, { cwd: res.plan.steps[1].cwd, encoding: 'utf8' });
    expect(run.stdout.trim()).toBe('packaged ünïcødē 测试');
    // The user's source tree stayed a source tree.
    expect(fs.readdirSync(pkgDir).sort()).toEqual(['App.java', 'Greeter.java']);
    expect(fs.existsSync(path.join(outDir, 'com', 'demo', 'App.class'))).toBe(true);
  }, 180000);

  it('compiles multiple source files that reference each other', async () => {
    const dir = workspace();
    const greeter = writeJava(
      dir,
      'Greeter',
      `import java.util.List;

public class Greeter {
    public String greet(String name) {
        return String.join(", ", List.of("Hello", name));
    }
}
`,
    );
    const main = writeJava(
      dir,
      'Main',
      `public class Main {
    public static void main(String[] args) {
        System.out.println(new Greeter().greet("Amit"));
    }
}
`,
    );
    const out = path.join(dir, 'classes');
    await execFileAsync(JDK!.javacExe, ['-d', out, greeter, main], { encoding: 'utf8' });
    const run = await execFileAsync(JDK!.javaExe, ['-cp', out, 'Main'], { encoding: 'utf8' });
    expect(run.stdout.trim()).toBe('Hello, Amit');
  }, 120000);

  it('reports a genuinely missing third-party library instead of hiding it', async () => {
    // The other half of the bug report: an import that *should* stay red.
    const dir = workspace();
    const file = writeJava(
      dir,
      'Main',
      `import org.apache.commons.lang3.StringUtils;

public class Main {
    public static void main(String[] args) {
        System.out.println(StringUtils.join(new String[]{"a"}, "-"));
    }
}
`,
    );
    const p = execFileAsync(JDK!.javacExe, ['-d', path.join(dir, 'classes'), file], { encoding: 'utf8' });
    await expect(p).rejects.toBeTruthy();
    try {
      await p;
    } catch (err: any) {
      expect(String(err.stderr || err.message)).toMatch(/package org\.apache\.commons\.lang3 does not exist/);
    }
  }, 120000);

  it('makes `java` usable for a child process once JAVA_HOME/PATH are set for the verified JDK', async () => {
    // This is precisely what the bridge now does for JDT.LS. On a machine where
    // `java` is not on PATH at all, the child environment must still resolve it
    // to the verified JDK — so the shell is started with an empty inherited PATH.
    if (!JDK) return;
    const env = childEnvironment({ jdkHome: JDK.home }, { PATH: '' } as any);
    expect(env.JAVA_HOME).toBe(JDK.home);
    expect(env.PATH!.startsWith(path.join(JDK.home, 'bin'))).toBe(true);
    const shell = IS_WIN ? process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh';
    const argv = IS_WIN ? ['/d', '/c', 'java -version'] : ['-c', 'java -version'];
    expect(fs.existsSync(shell), `${shell} must exist to probe a child PATH`).toBe(true);
    const res = await execFileAsync(shell, argv, { encoding: 'utf8', env: env as any });
    const printed = String((res as any).stderr || res.stdout);
    expect(printed).toMatch(/version "?\d+/);
    expect(javaMajorOf(printed)).not.toBe(8);
  }, 120000);
});

describe('log hygiene is independent of the toolchain', () => {
  it('keeps actionable JDK failure text but drops credentials in it', () => {
    const line =
      'ERROR: the JAVA_HOME environment variable is not defined correctly, PASSWORD=s3cr3t-token and Maven settings token=abcd1234';
    const redacted = redactServerLog(line);
    expect(redacted).toContain('JAVA_HOME environment variable is not defined correctly');
    expect(redacted).toContain('PASSWORD=[redacted]');
    expect(redacted).toContain('token=[redacted]');
    expect(redacted).not.toContain('s3cr3t');
    expect(redacted).not.toContain('abcd1234');
  });
});
