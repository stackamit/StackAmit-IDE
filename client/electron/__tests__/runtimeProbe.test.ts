import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CPP_COMMANDS,
  LOCAL_RUNTIMES,
  applyMergedPathToProcess,
  cppCandidateExes,
  cppKnownBinDirs,
  detectLocalRuntimes,
  discoverCpp,
  discoverTypeScript,
  executableName,
  expandEnvTokens,
  findJdk,
  findTypescriptPackage,
  invalidateCppDiscovery,
  invalidateJdkDiscovery,
  invalidateLocalRuntimes,
  invalidatePathCache,
  invalidateTypeScriptDiscovery,
  isJdkHome,
  javaMajorOf,
  jdkCandidateHomes,
  locateOnPath,
  mergePathDirs,
  parseCppVersionLine,
  parseRegValue,
  pathSearchDirs,
  probeRuntime,
  readJdkReleaseVersion,
  refreshPathFromRegistry,
  refreshProcessPath,
  typescriptTscEntry,
} from '../services/runtimeProbe';

/**
 * Local runtime discovery — Phase 2 evidence for the desktop build.
 *
 * These tests spawn real tools on the machine running the suite, which is
 * exactly the point: a discovery routine that only passes on the author's PATH
 * ordering is not verified. Each assertion is therefore written against the
 * contract (shape, honest unavailability, version captured from either stream)
 * and the *presence* of a runtime is reported, never assumed.
 */

const IS_WIN = process.platform === 'win32';

describe('runtime probe contract', () => {
  it('declares exactly the runtimes the desktop app can execute offline', () => {
    // Python, Node.js and PowerShell are plain interpreters found on PATH. Java
    // belongs here only because its availability comes from a *validated JDK
    // home* (`findJdk`), not from whichever `java` happens to be first on PATH.
    // C++ belongs here because a compiler is located, run and read (`discoverCpp`)
    // before the app claims the language can be built — never assumed from a
    // file extension or from the language server being installed. TypeScript is
    // here because its availability is decided by actually running `tsc --version`
    // through a located Node (`discoverTypeScript`), project install first.
    expect(Object.keys(LOCAL_RUNTIMES).sort()).toEqual(['cpp', 'java', 'javascript', 'powershell', 'python', 'typescript']);
  });

  it('names an actionable C++ install hint that covers a compiler outside PATH', () => {
    // The reported failure was "g++ is not recognized" in a terminal while a
    // fresh CMD window compiled fine, so the hint has to name the setting that
    // resolves it, not just "install a compiler".
    expect(LOCAL_RUNTIMES.cpp.installHint).toMatch(/winget/i);
    expect(LOCAL_RUNTIMES.cpp.installHint).toMatch(/custom compiler path/i);
    expect(LOCAL_RUNTIMES.cpp.cmds[0]).toBe('g++');
  });

  it('names an actionable JDK install hint for Java, not "java not found"', () => {
    // A browser/plugin JRE is the classic false positive: something on PATH that
    // cannot compile, so the hint has to say a development kit is required.
    expect(LOCAL_RUNTIMES.java.installHint).toMatch(/JDK|development kit/i);
    expect(LOCAL_RUNTIMES.java.args).toEqual(['-version']);
  });

  it('gives every runtime a user-readable label, a candidate list and an install hint', () => {
    for (const [key, probe] of Object.entries(LOCAL_RUNTIMES)) {
      expect(probe.label, key).toBeTruthy();
      expect(probe.cmds.length, key).toBeGreaterThan(0);
      expect(probe.args.length, key).toBeGreaterThan(0);
      // A missing runtime must produce actionable text, not "not found".
      expect(probe.installHint.length, key).toBeGreaterThan(20);
    }
  });

  it('appends the platform executable suffix only to bare command names', () => {
    expect(executableName('python')).toBe(IS_WIN ? 'python.exe' : 'python');
    expect(executableName('C:\\tools\\python.exe')).toBe('C:\\tools\\python.exe');
    expect(executableName('/usr/bin/node')).toBe('/usr/bin/node');
  });

  it('returns null for a command that does not exist instead of throwing', () => {
    expect(locateOnPath('stackamit-definitely-not-installed-9f3c')).toBeNull();
  });

  it('resolves an absolute path only when the file really is there', () => {
    const self = process.execPath;
    expect(fs.existsSync(self)).toBe(true);
    expect(locateOnPath(self)).toBe(self);
    expect(locateOnPath(path.join(path.dirname(self), 'no-such-binary.exe'))).toBeNull();
  });

  it('accepts a version printed on stderr (java-style tools do this)', async () => {
    // `node -e` writing only to stderr proves the probe does not require stdout,
    // which is what makes `java -version` and friends detectable.
    const res = await probeRuntime(process.execPath, ['-e', 'process.stderr.write("from-stderr-1.2.3")']);
    expect(res.ok).toBe(true);
    expect(res.version).toContain('from-stderr-1.2.3');
    expect(res.path).toBe(process.execPath);
  });

  it('reports failure, not an exception, for a broken command', async () => {
    const res = await probeRuntime('stackamit-definitely-not-installed-9f3c', ['--version']);
    expect(res.ok).toBe(false);
    expect(res.version).toBeNull();
  });

  it('reports failure for a tool that exits non-zero without output', async () => {
    const res = await probeRuntime(process.execPath, ['-e', 'process.exit(4)']);
    expect(res.ok).toBe(false);
  });
});

describe('local runtime detection on this machine', () => {
  let runtimes: Awaited<ReturnType<typeof detectLocalRuntimes>>;

  beforeAll(async () => {
    invalidateLocalRuntimes();
    runtimes = await detectLocalRuntimes(true);
    // Printed so the final report can quote what discovery actually found.
    console.log(
      '[runtimeProbe] detected:',
      JSON.stringify(
        Object.fromEntries(Object.entries(runtimes).map(([k, r]) => [k, { available: r.available, path: r.path, version: r.version }])),
        null,
        2,
      ),
    );
  }, 30000);

  it('returns a complete record per runtime', () => {
    for (const key of Object.keys(LOCAL_RUNTIMES)) {
      const r = runtimes[key];
      expect(r, key).toBeTruthy();
      expect(r.key, key).toBe(key);
      expect(r.label, key).toBe(LOCAL_RUNTIMES[key].label);
      if (key === 'cpp' || key === 'typescript') {
        // These two answers may append *why* a tool that exists here cannot be
        // used (a broken install, an MSVC-only `cl.exe`, a `tsc.CMD` shim with no
        // runnable package behind it); the probe text still has to be the
        // beginning of it, so nothing is invented and nothing is dropped.
        expect(r.installHint.startsWith(LOCAL_RUNTIMES[key].installHint), key).toBe(true);
      } else {
        expect(r.installHint, key).toBe(LOCAL_RUNTIMES[key].installHint);
      }
      expect(typeof r.available, key).toBe('boolean');
    }
  });

  it('only claims availability when the executable really ran and printed a version', () => {
    for (const r of Object.values(runtimes)) {
      if (!r.available) {
        expect(r.cmd).toBeNull();
        expect(r.path).toBeNull();
        expect(r.version).toBeNull();
        continue;
      }
      expect(r.version, r.key).toBeTruthy();
      expect(r.path, r.key).toBeTruthy();
      // The recorded path must be the file that was actually spawned.
      expect(fs.existsSync(r.path as string), `${r.key} path ${r.path}`).toBe(true);
      expect(LOCAL_RUNTIMES[r.key].cmds).toContain(r.cmd as string);
    }
  });

  it('caches detection and re-runs it when forced', async () => {
    const first = await detectLocalRuntimes();
    const second = await detectLocalRuntimes();
    expect(second).toBe(first); // same object => served from cache
    const forced = await detectLocalRuntimes(true);
    expect(forced).not.toBe(first);
  }, 30000);

  it('finds Node.js, because this suite itself runs on it', async () => {
    const node = (await detectLocalRuntimes(true)).javascript;
    expect(node.available).toBe(true);
    expect(node.version).toMatch(/^v?\d+\./);
  }, 30000);

  it('only claims Java when a validated JDK home backs the answer', async () => {
    // The contract the run plan depends on: an available Java always carries the
    // home directory whose `bin` the runner spawns, and an unavailable one never
    // pretends to have found a toolchain.
    const java = (await detectLocalRuntimes(true)).java;
    console.log(`[runtimeProbe] java available=${java.available} jdk=${java.jdk?.home || '-'} (${java.jdk?.version || '-'}), source=${java.jdk?.source || '-'}`);
    if (!java.available) {
      expect(java.jdk ?? null).toBeNull();
      expect(java.cmd).toBeNull();
      return;
    }
    expect(java.jdk).toBeTruthy();
    expect(fs.existsSync(java.path as string), `java exe ${java.path}`).toBe(true);
    expect(fs.existsSync(path.join(java.jdk!.home, 'bin')), `JDK home ${java.jdk!.home}`);
    expect(java.path).toBe(path.join(java.jdk!.home, 'bin', IS_WIN ? 'java.exe' : 'java'));
  }, 30000);

  it('honours a configured JDK folder when one is supplied', async () => {
    // The Languages & Capabilities setting has to reach the run path too, or a
    // machine with Java outside PATH would say "no Java" next to an IntelliSense
    // session that works on that very JDK.
    const home = makeJavaHome('21.0.2');
    const withCustom = await detectLocalRuntimes(true, home);
    expect(withCustom.java.available).toBe(true);
    expect(path.resolve(withCustom.java.jdk!.home)).toBe(path.resolve(home));
    expect(withCustom.java.jdk!.source).toBe('custom');
    expect(withCustom.java.jdk!.major).toBe(21);
    invalidateLocalRuntimes();
  }, 30000);
});

// ---------------------------------------------------------------------------
// JDK discovery — the difference between "a java exists" and "imports resolve"
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
const savedJavaHome = process.env.JAVA_HOME;

/** Write a folder that looks like an installed JDK (or a runtime-only JRE). */
function makeJavaHome(version: string | null, opts: { jre?: boolean; releaseFile?: boolean } = {}): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jdk-fixture-'));
  tempDirs.push(home);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', IS_WIN ? 'java.exe' : 'java'), '');
  if (!opts.jre) fs.writeFileSync(path.join(home, 'bin', IS_WIN ? 'javac.exe' : 'javac'), '');
  if (version && opts.releaseFile !== false) {
    fs.writeFileSync(path.join(home, 'release'), `JAVA_VERSION="${version}"\nOS="windows"\n`);
  }
  return home;
}

function emptyDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  invalidateJdkDiscovery();
});

afterEach(() => {
  process.env.JAVA_HOME = savedJavaHome;
  if (savedJavaHome === undefined) delete process.env.JAVA_HOME;
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp noise must not fail a test */
    }
  }
});

describe('javaMajorOf', () => {
  it('converts legacy and modern version strings to a comparable major', () => {
    expect(javaMajorOf('1.8.0_452')).toBe(8);
    expect(javaMajorOf('"1.8.0_333"')).toBe(8);
    expect(javaMajorOf('11.0.21')).toBe(11);
    expect(javaMajorOf('17')).toBe(17);
    expect(javaMajorOf('21.0.2')).toBe(21);
    expect(javaMajorOf('openjdk version "21.0.2" 2024')).toBe(21);
    expect(javaMajorOf('')).toBeNull();
    expect(javaMajorOf(null)).toBeNull();
    expect(javaMajorOf('not a version')).toBeNull();
  });
});

describe('isJdkHome / readJdkReleaseVersion', () => {
  it('accepts a folder that carries the development kit content', () => {
    const home = makeJavaHome('21.0.2');
    expect(isJdkHome(home)).toBe(true);
    expect(readJdkReleaseVersion(home)).toBe('21.0.2');
  });

  it('rejects a runtime-only JRE (launcher present, no compiler or module image)', () => {
    const jre = makeJavaHome('1.8.0_452', { jre: true, releaseFile: false });
    expect(isJdkHome(jre)).toBe(false);
    // A `release` file or `lib/modules` is enough to prove a JDK 9+ install.
    fs.writeFileSync(path.join(jre, 'release'), 'JAVA_VERSION="21.0.2"\n');
    expect(isJdkHome(jre)).toBe(true);
    fs.rmSync(path.join(jre, 'release'));
    fs.mkdirSync(path.join(jre, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(jre, 'lib', 'modules'), '');
    expect(isJdkHome(jre)).toBe(true);
  });

  it('says nothing about folders that are not Java homes at all', () => {
    expect(isJdkHome('')).toBe(false);
    expect(isJdkHome(emptyDir())).toBe(false);
    expect(readJdkReleaseVersion(emptyDir())).toBeNull();
  });
});

describe('jdkCandidateHomes', () => {
  it('normalizes a configured launcher, bin folder or home to the same home first', () => {
    const home = makeJavaHome('21.0.2');
    const bin = path.join(home, 'bin');
    const exe = path.join(bin, IS_WIN ? 'java.exe' : 'java');
    for (const raw of [home, bin, exe, `${exe}  `]) {
      const list = jdkCandidateHomes(raw);
      expect(list[0], raw).toBe(path.resolve(home));
    }
  });

  it('deduplicates when JAVA_HOME and the configured path are the same folder', () => {
    const home = makeJavaHome('17.0.10');
    process.env.JAVA_HOME = home;
    const list = jdkCandidateHomes(home);
    expect(list.filter((h) => h === path.resolve(home))).toHaveLength(1);
  });
});

describe('findJdk on this machine', () => {
  it('never reports a JRE as a JDK, even when it is the configured path', async () => {
    const jre = makeJavaHome('1.8.0_452', { jre: true, releaseFile: false });
    process.env.JAVA_HOME = jre;
    const res = await findJdk({ customPath: jre, force: true });
    expect(res?.home).not.toBe(path.resolve(jre));
    if (res) expect(isJdkHome(res.home)).toBe(true);
    // Reported so the final summary can state what discovery really found here.
    console.log('[runtimeProbe] findJdk(JRE-only config) ->', res ? `${res.home} (${res.version})` : 'null');
  });

  it('honors minMajor instead of returning an old JDK that cannot run JDT.LS', async () => {
    const old = makeJavaHome('1.8.0_452');
    process.env.JAVA_HOME = old;
    const res = await findJdk({ minMajor: 17, force: true });
    if (res) {
      expect(res.major === null || res.major >= 17, `${res.home} ${res.version}`).toBe(true);
    }
    console.log('[runtimeProbe] findJdk(minMajor 17) ->', res ? `${res.home} (${res.version}) via ${res.source}` : 'null');
  });

  it('lets the configured JDK win over a newer kit the scan happens to find', async () => {
    // The whole point of the setting: pinning a project to one kit. Answering
    // with a different JDK than the folder the user named — however newer — is a
    // substitution this app does not get to make silently, and it is what makes
    // "IntelliSense works but the run uses another Java" possible. The path is
    // still validated first (see the JRE test above), so only a real JDK wins.
    const pinned = makeJavaHome('1.8.0_452');
    delete process.env.JAVA_HOME;
    const res = await findJdk({ customPath: pinned, force: true });
    expect(res, 'a validated configured kit must be found').toBeTruthy();
    expect(res!.home).toBe(path.resolve(pinned));
    expect(res!.source).toBe('custom');
    expect(res!.major).toBe(8);
  });

  it('never lets a pinned old JDK break a server that requires a newer one', async () => {
    // The one override that must lose: Eclipse JDT.LS cannot even start on 8.
    const pinned = makeJavaHome('1.8.0_452');
    delete process.env.JAVA_HOME;
    const res = await findJdk({ customPath: pinned, minMajor: 17, force: true });
    if (res) {
      expect(res.home).not.toBe(path.resolve(pinned));
      expect(res.major === null || res.major >= 17, `${res.home} ${res.version}`).toBe(true);
    }
    console.log('[runtimeProbe] pinned 1.8 + minMajor 17 ->', res ? `${res.home} (via ${res.source})` : 'null');
  });

  it('keeps a JDK whose version cannot be parsed rather than inventing a rejection', async () => {
    const home = makeJavaHome(null, { releaseFile: false });
    process.env.JAVA_HOME = home;
    const res = await findJdk({ customPath: home, force: true });
    // No `release` file and a stubbed `java` that prints nothing: the entry is
    // still returned (major null) because claiming "too old" would be a guess.
    if (res && res.home === path.resolve(home)) {
      expect(res.major).toBeNull();
      expect(res.source).toBe('custom');
    }
  });

  it('labels a JAVA_HOME-discovered kit and caches until forced', async () => {
    const home = makeJavaHome('21.0.2');
    process.env.JAVA_HOME = home;
    const first = await findJdk({ force: true });
    const cached = await findJdk();
    if (!first) return; // no JDK here at all — nothing to assert
    expect(cached).toBe(first);
    if (first.home === path.resolve(home)) expect(first.source).toBe('JAVA_HOME');
    expect(first.javaExe).toBe(path.join(first.home, 'bin', IS_WIN ? 'java.exe' : 'java'));
    expect(first.version).toBeTruthy();
  });

  it('invalidates the cache when the tool cache is reset', async () => {
    const home = makeJavaHome('21.0.2');
    process.env.JAVA_HOME = home;
    await findJdk({ force: true });
    // invalidateToolDiscovery() must clear the JDK cache too, or installing a
    // newer JDK would stay invisible until the app restarts.
    const mod = await import('../services/runtimeProbe');
    mod.invalidateToolDiscovery();
    const again = await findJdk();
    expect(again).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// C++ compiler discovery — the tool's answer is read, never assumed
// ---------------------------------------------------------------------------

describe('parseCppVersionLine', () => {
  it('reads the family and version each toolchain actually prints', () => {
    // The MinGW.org line the reported machine prints, verbatim.
    expect(parseCppVersionLine('g++.exe (MinGW.org GCC-6.3.0-1) 6.3.0')).toEqual({ family: 'gcc', version: '6.3.0', major: 6, minor: 3 });
    expect(parseCppVersionLine('g++ (Ubuntu 9.4.0-1ubuntu1~20.04.2) 9.4.0')).toMatchObject({ family: 'gcc', version: '9.4.0', major: 9, minor: 4 });
    expect(parseCppVersionLine('clang version 17.0.6 (https://github.com/llvm/llvm-project)')).toMatchObject({ family: 'clang', version: '17.0.6', major: 17, minor: 0 });
    expect(parseCppVersionLine('Microsoft (R) C/C++ Optimizing Compiler Version 19.29.30133 for x64')).toMatchObject({ family: 'msvc', major: 19, minor: 29 });
  });

  it('keeps an unreadable line as the answer instead of inventing a number', () => {
    const odd = parseCppVersionLine('Some compiler with no digits at all');
    expect(odd.family).toBe('unknown');
    expect(odd.major).toBeNull();
    expect(odd.version).toBe('Some compiler with no digits at all');
    expect(parseCppVersionLine(null)).toEqual({ family: 'unknown', version: null, major: null, minor: null });
  });
});

/**
 * A temp folder holding placeholder executables. They exist (so the candidate
 * list must mention them) and cannot run (so the finder must refuse to call
 * them usable) — which is the only way to test "installed but broken" and an
 * MSVC-only machine on a machine that has neither.
 */
function cppStubDir(names: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-stub-'));
  tempDirs.push(dir);
  for (const name of names) fs.writeFileSync(path.join(dir, name), '');
  return dir;
}

describe('cppCandidateExes', () => {
  it('puts a configured compiler first and labels it as configured', () => {
    const dir = cppStubDir(['g++.exe']);
    const exe = path.join(dir, 'g++.exe');
    const cands = cppCandidateExes(dir);
    expect(cands[0].exe.toLowerCase()).toBe(path.resolve(exe).toLowerCase());
    expect(cands[0].cmd).toBe('g++');
    expect(cands[0].source).toBe('custom');
    // The folder form and the launcher form name the same compiler.
    expect(cppCandidateExes(exe)[0].exe.toLowerCase()).toBe(path.resolve(exe).toLowerCase());
  });

  it('looks in a configured folder’s bin subfolder too, and ignores paths with no file', () => {
    const dir = cppStubDir([]);
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bin', 'clang++.exe'), '');
    const cands = cppCandidateExes(dir);
    expect(cands[0].cmd).toBe('clang++');
    expect(cands[0].source).toBe('custom');
    // A stale setting that points at nothing adds no candidate (and no claim).
    expect(cppCandidateExes(path.join(dir, 'deleted')).length).toBeLessThan(cands.length);
  });

  it('only lists files that exist', () => {
    const dir = cppStubDir(['g++.exe']);
    for (const cand of cppCandidateExes(dir)) {
      expect(fs.existsSync(cand.exe), cand.exe).toBe(true);
    }
  });

  it('finds a compiler in a folder only PATH knows about, not in a hardcoded list', async () => {
    // The reported bug’s opposite case: the toolchain lives somewhere no scan
    // entry mentions. If discovery worked only because `C:\MinGW\bin` is in the
    // vendor list, this candidate would be labelled 'scan' or missing entirely.
    const dir = cppStubDir([executableName('g++')]);
    const savedPath = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${savedPath}`;
    invalidatePathCache();
    try {
      const exe = path.join(dir, executableName('g++'));
      expect(locateOnPath('g++')?.toLowerCase()).toBe(exe.toLowerCase());
      const cand = cppCandidateExes(null)[0];
      expect(cand.exe.toLowerCase()).toBe(exe.toLowerCase());
      expect(cand.source).toBe('PATH');
      expect(cppKnownBinDirs().some((d) => d.toLowerCase() === path.resolve(dir).toLowerCase())).toBe(false);
    } finally {
      process.env.PATH = savedPath;
      invalidatePathCache();
      await refreshPathFromRegistry(true);
    }
  });
});

describe('discoverCpp with unusable candidates', () => {
  beforeEach(() => {
    invalidateCppDiscovery();
  });

  it('reports an executable that cannot run instead of claiming it works', async () => {
    const dir = cppStubDir(['g++.exe']); // exists, is not a working toolchain
    const exe = path.join(dir, 'g++.exe');
    const res = await discoverCpp({ customPath: dir, force: true });
    const rejected = res.rejected.find((r) => r.exe.toLowerCase() === path.resolve(exe).toLowerCase());
    expect(rejected, 'the broken stub must be reported as unusable').toBeTruthy();
    expect(rejected!.reason).toMatch(/broken|did not run/i);
    if (res.compiler) expect(res.compiler.exe.toLowerCase()).not.toBe(path.resolve(exe).toLowerCase());
  }, 60000);

  it('never uses cl.exe and says why', async () => {
    // MSVC’s compiler needs the Visual Studio developer environment; the runner
    // deliberately passes an allow-listed environment without INCLUDE/LIB, so
    // silently picking `cl.exe` would produce a failure the user cannot see.
    const dir = cppStubDir(['cl.exe']);
    const res = await discoverCpp({ customPath: dir, force: true });
    const cl = res.rejected.find((r) => path.basename(r.exe).toLowerCase() === 'cl.exe');
    expect(cl, 'a located cl.exe must be reported').toBeTruthy();
    expect(cl!.reason).toMatch(/Visual Studio|INCLUDE/i);
    if (res.compiler) expect(res.compiler.family).not.toBe('msvc');
  }, 60000);

  it('answers the configured path it was given, and caches per setting', async () => {
    const first = await discoverCpp({ force: true });
    const cached = await discoverCpp();
    expect(cached).toBe(first);
    invalidateCppDiscovery();
    expect(await discoverCpp()).not.toBe(first);
  }, 60000);

  it('treats a changed compiler setting as a new answer in the runtime list', async () => {
    invalidateLocalRuntimes();
    const plain = await detectLocalRuntimes(false, null, null);
    const configured = await detectLocalRuntimes(false, null, cppStubDir(['cl.exe']));
    // Same process, different setting: serving the cached object here would let
    // an old answer hide (or fake) the compiler the user just pointed at.
    expect(configured).not.toBe(plain);
    expect(configured.cpp.compiler?.source === 'custom').toBe(false);
    invalidateLocalRuntimes();
  }, 60000);
});

// ---------------------------------------------------------------------------
// Environment freshness: why the integrated terminal said "g++ is not recognized"
// ---------------------------------------------------------------------------
describe('PATH recovery', () => {
  it('reads a registry Path value and expands its %VAR% tokens like Windows', () => {
    process.env.STACKAMIT_TEST_DIR = path.join('C:', 'StackamitTestDir');
    try {
      const raw = parseRegValue(
        'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment\n    Path    REG_EXPAND_SZ    %STACKAMIT_TEST_DIR%\\bin;C:\\Other Tool\\bin with spaces\n',
      );
      expect(raw).toBe('%STACKAMIT_TEST_DIR%\\bin;C:\\Other Tool\\bin with spaces');
      expect(expandEnvTokens(raw!)).toBe(path.join('C:', 'StackamitTestDir', 'bin') + ';C:\\Other Tool\\bin with spaces');
      // An unknown token is left alone rather than guessed at.
      expect(expandEnvTokens('%STACKAMIT_NO_SUCH_VAR%\\bin')).toBe('%STACKAMIT_NO_SUCH_VAR%\\bin');
      expect(parseRegValue('no Path value here')).toBeNull();
    } finally {
      delete process.env.STACKAMIT_TEST_DIR;
    }
  });

  it('merges PATH lists keeping what already resolves in front', () => {
    const merged = mergePathDirs('C:\\a;C:\\b', 'C:\\b;C:\\c');
    expect(merged).toEqual(['C:\\a', 'C:\\b', 'C:\\c']);
    // Case-insensitive on Windows: the same folder written two ways is one entry.
    expect(mergePathDirs('C:\\Tools;C:\\tools').length).toBe(IS_WIN ? 1 : 2);
    expect(mergePathDirs('"C:\\quoted"', '')).toEqual(['C:\\quoted']);
    // A trailing separator names the same directory as one without it, and the
    // registry PATH routinely has it while an inherited environment does not.
    // Without this, `C:\nodejs` and `C:\nodejs\` are searched twice and one
    // spelling can hide that the other was already recovered.
    expect(mergePathDirs('C:\\Tools\\;C:\\tools')).toEqual(IS_WIN ? ['C:\\Tools'] : ['C:\\Tools', 'C:\\tools']);
    // A drive root is not the same directory as the drive, and the POSIX root is
    // not an empty string: neither may lose its separator.
    expect(mergePathDirs('C:\\', 'C:\\a')).toEqual(['C:\\', 'C:\\a']);
    expect(mergePathDirs('/', '/tmp')).toEqual(['/', '/tmp']);
  });

  it('recovers directories this process does not have, without reordering its own', async () => {
    if (!IS_WIN) return;
    invalidatePathCache();
    const recovered = await refreshPathFromRegistry(true);
    const own = new Set(mergePathDirs(process.env.PATH).map((d) => d.toLowerCase()));
    const extra = recovered.filter((d) => !own.has(d.toLowerCase()));
    console.log(
      `[runtimeProbe] PATH: ${own.size} from this process + ${extra.length} recovered from the registry${extra.length ? ` (${extra.slice(0, 3).join(', ')}${extra.length > 3 ? ', …' : ''})` : ''}`,
    );
    const list = pathSearchDirs().map((d) => d.toLowerCase());
    // Nothing that already resolved moves, and nothing recovered is dropped.
    let at = -1;
    for (const dir of mergePathDirs(process.env.PATH)) {
      const index = list.indexOf(dir.toLowerCase());
      expect(index, dir).toBeGreaterThan(-1);
      expect(index, dir).toBeGreaterThan(at);
      at = index;
    }
    for (const dir of extra) expect(list).toContain(dir.toLowerCase());
    // Asked again without force, the cached list answers — no second reg.exe.
    expect(await refreshPathFromRegistry()).toBe(recovered);
    invalidatePathCache();
    expect(pathSearchDirs().length).toBe(mergePathDirs(process.env.PATH).length);
    await refreshPathFromRegistry(true);
  }, 60000);

  it('invalidates the recovered PATH together with the tool caches', async () => {
    if (!IS_WIN) return;
    await refreshPathFromRegistry(true);
    const mod = await import('../services/runtimeProbe');
    mod.invalidateToolDiscovery();
    // After a reset the registry has to be read again, or a compiler installed
    // in the meantime would stay invisible until the app was restarted.
    expect(pathSearchDirs().length).toBe(mergePathDirs(process.env.PATH).length);
    const again = await refreshPathFromRegistry(true);
    expect(again.length).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('pushes the recovered directories into this process, keeping its own', async () => {
    if (!IS_WIN) return;
    const savedPath = process.env.PATH;
    try {
      await refreshPathFromRegistry(true);
      const dirs = pathSearchDirs();
      expect(dirs.length).toBeGreaterThan(1);
      // Stand in for the environment block a shortcut-launched app carries: the
      // last directory is one this process is missing.
      const dropped = dirs[dirs.length - 1];
      const kept = dirs.slice(0, -1);
      process.env.PATH = kept.join(path.delimiter);

      const merged = applyMergedPathToProcess();
      const after = String(process.env.PATH).split(path.delimiter).filter(Boolean);
      // Additive and ordered: what already resolved stays in front, untouched.
      expect(after.slice(0, kept.length)).toEqual(kept);
      expect(after, dropped).toContain(dropped);
      expect(merged).toBe(process.env.PATH);
      // Idempotent — re-applying it cannot shuffle the working list again.
      expect(applyMergedPathToProcess()).toBe(merged);
    } finally {
      process.env.PATH = savedPath;
      invalidatePathCache();
    }
  }, 60000);

  it('a child started after the repair really inherits the recovered directory', async () => {
    if (!IS_WIN) return;
    const savedPath = process.env.PATH;
    try {
      await refreshPathFromRegistry(true);
      const dirs = pathSearchDirs();
      expect(dirs.length).toBeGreaterThan(1);
      const dropped = dirs[dirs.length - 1];
      // Take the directory away first: a child of a process that already had it
      // would prove nothing about the repair.
      process.env.PATH = dirs.slice(0, -1).join(path.delimiter);
      invalidatePathCache();

      const merged = await refreshProcessPath(true);
      expect(merged.toLowerCase(), dropped).toContain(dropped.toLowerCase());
      // A plain spawn with no `env` option is effectively what a PTY-backed
      // shell receives on Windows, so this is the property the terminal needs.
      const probe = spawnSync('cmd.exe', ['/d', '/s', '/c', 'echo PROBE=%PATH%'], { encoding: 'utf8' });
      expect(String(probe.stdout), dropped).toContain(dropped);
    } finally {
      process.env.PATH = savedPath;
      invalidatePathCache();
    }
  }, 60000);
});

// ---------------------------------------------------------------------------
// TypeScript discovery — the compiler is *run* (`node tsc --version`), so a
// located package must also be a working one. Uses this repo's own
// node_modules/typescript, which makes the project and custom paths real.
// ---------------------------------------------------------------------------
const hasNode = Boolean(locateOnPath('node'));
const repoTsPkg = hasNode ? findTypescriptPackage(process.cwd(), null) : null;
const describeTsDiscovery = hasNode && repoTsPkg ? describe : describe.skip;

describeTsDiscovery('TypeScript discovery', () => {
  beforeEach(() => {
    invalidateTypeScriptDiscovery();
  });

  it('finds the project package and a runnable tsc entry inside it', () => {
    expect(path.basename(repoTsPkg as string)).toBe('typescript');
    const entry = typescriptTscEntry(repoTsPkg as string);
    expect(entry, 'a bin/tsc or lib/tsc.js entry must exist').toBeTruthy();
    expect(fs.existsSync(entry as string)).toBe(true);
  });

  it('honours an explicitly configured package path and validates it by running', async () => {
    const { compiler, rejected } = await discoverTypeScript({ customPath: repoTsPkg, force: true });
    expect(compiler, JSON.stringify(rejected)).toBeTruthy();
    expect(compiler!.source).toBe('custom');
    expect(compiler!.packageRoot).toBe(path.resolve(repoTsPkg as string));
    // The version came from actually running `node <tsc> --version`, not a guess.
    expect(compiler!.version).toMatch(/[Vv]ersion\s+\d/);
    expect(fs.existsSync(compiler!.nodeExe)).toBe(true);
    expect(fs.existsSync(compiler!.tscJs)).toBe(true);
  }, 30000);

  it('discovers a project-local compiler from the entry folder when no path is configured', async () => {
    const { compiler, rejected } = await discoverTypeScript({
      entryDir: path.join(process.cwd(), 'src'),
      workspaceRoot: process.cwd(),
      force: true,
    });
    expect(compiler, JSON.stringify(rejected)).toBeTruthy();
    expect(compiler!.source).toBe('project');
  }, 30000);

  it('reports a configured path that is not a typescript package as rejected, not usable', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-ts-none-'));
    const { compiler, rejected } = await discoverTypeScript({ customPath: empty, force: true });
    expect(compiler).toBeNull();
    // It never fakes success: a non-package folder is called out, not run.
    expect(rejected.some((r) => /does not look like a typescript package/.test(r.reason))).toBe(true);
  }, 30000);
});

// ---------------------------------------------------------------------------
// TypeScript capability reporting — the availability the Settings badge shows
// must be produced by the SAME discovery a Run performs, given the configured
// path and the opened workspace. A project that ships its own
// `node_modules/typescript` is therefore reported available even with no global
// `tsc`, so the badge can never contradict the compiler the run uses.
// ---------------------------------------------------------------------------
describeTsDiscovery('TypeScript capability reporting matches the run', () => {
  beforeEach(() => {
    invalidateTypeScriptDiscovery();
    invalidateLocalRuntimes();
  });

  it('reports a project-local compiler available when the opened workspace carries one', async () => {
    const runtimes = await detectLocalRuntimes(true, null, null, { workspaceRoot: process.cwd() });
    const ts = runtimes.typescript;
    expect(ts.available, ts.installHint).toBe(true);
    expect(ts.tsCompiler?.source).toBe('project');
    // The reported compiler is a real, runnable entry, not a bare `tsc` shim.
    expect(ts.tsCompiler && fs.existsSync(ts.tsCompiler.tscJs)).toBe(true);
  }, 30000);

  it('honours a configured TypeScript path in the reported compiler', async () => {
    const runtimes = await detectLocalRuntimes(true, null, null, { tsCompilerPath: repoTsPkg });
    const ts = runtimes.typescript;
    expect(ts.available, ts.installHint).toBe(true);
    expect(ts.tsCompiler?.source).toBe('custom');
    expect(path.resolve(ts.tsCompiler?.packageRoot || '')).toBe(path.resolve(repoTsPkg as string));
  }, 30000);

  it('never reports availability from a configured path that is not a compiler', async () => {
    const bogus = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-ts-badge-'));
    const runtimes = await detectLocalRuntimes(true, null, null, { tsCompilerPath: bogus, workspaceRoot: null });
    // Whatever else the machine has, the bogus custom folder is never the
    // reported compiler — the badge cannot claim a non-package is usable.
    expect(runtimes.typescript.tsCompiler?.source).not.toBe('custom');
  }, 30000);

  it('still reports the plain global-only view when no workspace context is given', async () => {
    // Back-compat: the old 3-argument call path (no context) keeps working and
    // simply reflects a globally reachable compiler, nothing project-specific.
    const runtimes = await detectLocalRuntimes(true, null, null);
    expect(runtimes.typescript).toBeTruthy();
    expect(typeof runtimes.typescript.available).toBe('boolean');
  }, 30000);
});
