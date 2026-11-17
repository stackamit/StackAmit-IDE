import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * Real end-to-end dependency proof (requirements 5, 6, 15) — OFF by default.
 *
 * This is the only suite that touches the actual network and a real JDK, so it is
 * gated behind `RUN_JAVA_DEPS_INTEGRATION=1`. When the flag is absent it prints a
 * loud BLOCKED line and skips, exactly like the other integration suites, so the
 * default `npm test` run stays deterministic and offline.
 *
 * What it proves, together: Commons Lang really resolves from Maven Central into a
 * throwaway repository (req 5), a program that calls `StringUtils` compiles and
 * runs against that classpath (req 6), and it is a genuine local JDK run (req 15).
 */
const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';
const RUN = process.env.RUN_JAVA_DEPS_INTEGRATION === '1';

import { isJdkHome, javaMajorOf, jdkCandidateHomes, readJdkReleaseVersion } from '../services/runtimeProbe';
import { planJavaRun } from '../services/javaRun';
import { resolveJavaDependencies } from '../services/javaDeps';

function discoverJdk(): { home: string; javaExe: string; major: number | null } | null {
  for (const home of jdkCandidateHomes()) {
    if (!isJdkHome(home)) continue;
    const javaExe = path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java');
    if (!fs.existsSync(javaExe)) continue;
    return { home, javaExe, major: javaMajorOf(readJdkReleaseVersion(home)) };
  }
  return null;
}

const JDK = discoverJdk();
console.log(
  `[javaDeps.integration] ${
    !RUN
      ? 'BLOCKED: set RUN_JAVA_DEPS_INTEGRATION=1 (needs network + JDK) — skipped'
      : JDK
        ? `real JDK found: ${JDK.home} (major ${JDK.major ?? '?'})`
        : 'BLOCKED: no JDK on this machine — skipped'
  }`,
);

const tempDirs: string[] = [];
function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

const USES_LANG = `import org.apache.commons.lang3.StringUtils;

public class DepsDemo {
    public static void main(String[] args) {
        System.out.println(StringUtils.reverse("abc"));
        System.out.println(StringUtils.capitalize("hello"));
    }
}
`;

describe.runIf(RUN && JDK)('resolve + compile + run Commons Lang (reqs 5, 6, 15)', () => {
  it('downloads the JAR, compiles against it, and runs successfully', async () => {
    const repo = temp('java-deps-it-repo-');
    const srcDir = temp('java-deps-it-src-');
    const sourceFile = path.join(srcDir, 'DepsDemo.java');
    fs.writeFileSync(sourceFile, USES_LANG, 'utf8');

    // 1) Resolve for real (network + ~/.m2-shaped cache in a temp repository).
    const resolved = await resolveJavaDependencies({
      coordinates: ['org.apache.commons:commons-lang3:3.17.0'],
      repositoryRoot: repo,
    });
    expect(resolved.ok, `resolve errors: ${JSON.stringify(resolved.errors)}`).toBe(true);
    expect(resolved.classpath.length).toBeGreaterThan(0);
    expect(resolved.classpath.some((p) => p.endsWith('commons-lang3-3.17.0.jar'))).toBe(true);

    // 2) Plan a real run that places the resolved JAR on the classpath.
    const jdk = JDK!;
    const outDir = path.join(srcDir, 'out');
    const plan = planJavaRun({
      jdk: { home: jdk.home, javaExe: jdk.javaExe, version: String(jdk.major ?? '17'), major: jdk.major, source: 'integration' },
      sourceFile,
      cwd: srcDir,
      outDir,
      buildDescriptor: false,
      classpath: resolved.classpath,
    });
    expect(plan.ok, `plan failed: ${(plan as any).message}`).toBe(true);
    if (!plan.ok) return;

    // 3) Execute every planned step for real, in order, feeding the classpath.
    let stdout = '';
    for (const step of plan.plan.steps) {
      const { stdout: out } = await execFileAsync(step.file, step.args, { cwd: step.cwd, encoding: 'utf8' });
      if (step.cmd === 'java') stdout = out;
    }
    expect(stdout).toContain('cba');
    expect(stdout).toContain('Hello');
  }, 120_000);

  it('serves a second resolve entirely from the cache with no network (req 12, 13)', async () => {
    const repo = temp('java-deps-it-cache-');
    const first = await resolveJavaDependencies({ coordinates: ['org.apache.commons:commons-lang3:3.17.0'], repositoryRoot: repo });
    expect(first.ok).toBe(true);
    expect(first.fromCacheOnly).toBe(false);

    const again = await resolveJavaDependencies({ coordinates: ['org.apache.commons:commons-lang3:3.17.0'], repositoryRoot: repo, offline: true });
    expect(again.ok).toBe(true);
    expect(again.fromCacheOnly).toBe(true);
    expect(again.classpath).toEqual(first.classpath);
  }, 120_000);
});
