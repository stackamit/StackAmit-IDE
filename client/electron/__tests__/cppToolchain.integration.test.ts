import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { start, stop, disposeAll, type RunEvent } from '../services/localRun';
import { detectLocalRuntimes, invalidateLocalRuntimes, locateOnPath, discoverCpp, invalidateCppDiscovery } from '../services/runtimeProbe';
import { compilerAcceptsStandard } from '../services/cppRun';

/**
 * Real-compiler C++ verification (no mocks).
 *
 * This is the suite that answers the reported bug — "Run does nothing for my
 * multi-file C++ project" — with the machine's own toolchain: the same runtime
 * discovery the packaged app uses decides what gets spawned, and each test
 * asserts the *program output*, not just that a process started. It self-skips,
 * with a loud BLOCKED line, where no C++ compiler is installed.
 *
 * The project it builds is generated in a temp folder in the shape the reported
 * project has (`include/` headers, `src/` implementations, a `main.cpp` that
 * uses them, spaces in the folder name), so the assertions are about the
 * runner's behaviour and stay runnable on any machine.
 */

const IS_WIN = process.platform === 'win32';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-cpp-test-'));

// Skip choices happen at collection time, before any async hook can run.
const CPP_ON_PATH = ['g++', 'clang++', 'c++'].some((c) => Boolean(locateOnPath(c)));

let compiler: Awaited<ReturnType<typeof discoverCpp>>['compiler'] = null;

beforeAll(async () => {
  invalidateLocalRuntimes();
  invalidateCppDiscovery();
  const discovery = await discoverCpp({ force: true });
  compiler = discovery.compiler;
  for (const rt of Object.values(await detectLocalRuntimes(true))) {
    if (rt.key === 'cpp') {
      console.log(
        `[cppToolchain] cpp available=${rt.available} cmd=${rt.cmd} -> ${rt.path} (${rt.version}) family=${rt.compiler?.family || '-'} source=${rt.compiler?.source || '-'} bin=${rt.compiler?.binDir || '-'}`,
      );
    }
  }
  if (!compiler) {
    console.log(`[cppToolchain] BLOCKED: ${discovery.rejected.length ? `compiler(s) found but unusable: ${discovery.rejected.map((r) => `${path.basename(r.exe)} (${r.reason})`).join('; ')}` : 'no C++ compiler located on PATH or in the known install folders'} — real compile tests skipped`);
  }
}, 60000);

afterEach(() => {
  disposeAll();
});

afterAll(() => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    /* temp noise must not fail a suite */
  }
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

/** Start a run and stream it to completion, exactly like the renderer does. */
async function runToCompletion(
  opts: Partial<Parameters<typeof start>[0]> & { language: string },
  waitMs = 90000,
): Promise<Collected> {
  const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
  let finish: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const res = await start({ tempRoot, ...opts } as Parameters<typeof start>[0], (e) => {
    col.events.push(e);
    if (e.type === 'exit') {
      col.exit = e;
      finish();
    } else if (e.type === 'stdout') col.stdout += e.data;
    else if (e.type === 'stderr') col.stderr += e.data;
    else if (e.type === 'info') col.info += e.data;
    else if (e.type === 'error') col.errors += e.data;
  });
  col.result = res as Collected['result'];
  if (!res.ok) return col;
  await Promise.race([exited, new Promise((r) => setTimeout(r, waitMs))]);
  return col;
}

function makeDir(prefix = 'proj-'): string {
  const dir = fs.mkdtempSync(path.join(tempRoot, prefix));
  return dir;
}

function write(dir: string, rel: string, text: string): string {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

/**
 * The reported project's shape: a header + implementation pair in separate
 * folders, a `main.cpp` that uses them, and a CMakeLists.txt describing all of
 * it. Building *this* with a "compile the open file" runner fails at link time,
 * which is precisely the bug.
 */
function makeStudentProject(): string {
  // A folder with a space and a `+`, like the reported `C++ test\CppProjectTest`.
  const root = makeDir('C++ test folder-');
  write(root, 'include/TextUtils.h', '#pragma once\n#include <string>\nstd::string shout(const std::string& text);\n');
  write(root, 'src/TextUtils.cpp', '#include "TextUtils.h"\nstd::string shout(const std::string& text) { return text + " WORKS"; }\n');
  write(
    root,
    'src/main.cpp',
    [
      '#include <iostream>',
      '#include "TextUtils.h"',
      'int main() {',
      '  std::cout << "StackAmit-IDE C++ Test Project\\n";',
      '  std::cout << "Utility test: " << shout("CPP") << "\\n";',
      '  std::cout << "STATUS: SUCCESS\\n";',
      '  return 0;',
      '}',
      '',
    ].join('\n'),
  );
  write(
    root,
    'CMakeLists.txt',
    [
      'cmake_minimum_required(VERSION 3.16)',
      'project(CppProjectTest LANGUAGES CXX)',
      'set(CMAKE_CXX_STANDARD 17)',
      'add_executable(CppProjectTest',
      '    src/main.cpp',
      '    src/TextUtils.cpp',
      ')',
      'target_include_directories(CppProjectTest PRIVATE include)',
      'add_executable(CppUnitTests',
      '    tests/test_main.cpp',
      '    src/TextUtils.cpp',
      ')',
      'target_include_directories(CppUnitTests PRIVATE include)',
      '',
    ].join('\n'),
  );
  write(
    root,
    'tests/test_main.cpp',
    [
      '#include <cassert>',
      '#include <iostream>',
      '#include "TextUtils.h"',
      'int main() {',
      '  for (int i = 0; i < 6; i++) assert(shout("x") == "x WORKS");',
      '  std::cout << "All 6 C++ tests passed.\\n";',
      '  return 0;',
      '}',
      '',
    ].join('\n'),
  );
  return root;
}

describe('C++ compiler discovery on this machine', () => {
  it('either finds a usable compiler or says why not — never both', async () => {
    const discovery = await discoverCpp({ force: true });
    const cpp = (await detectLocalRuntimes(true)).cpp;
    expect(cpp.available).toBe(Boolean(discovery.compiler));
    if (!discovery.compiler) {
      expect(cpp.cmd).toBeNull();
      expect(cpp.installHint.length).toBeGreaterThan(40);
      return;
    }
    // A claimed compiler must be a real file that answered `--version`.
    expect(fs.existsSync(discovery.compiler.exe)).toBe(true);
    expect(discovery.compiler.version).toBeTruthy();
    expect(['gcc', 'clang', 'msvc', 'unknown']).toContain(discovery.compiler.family);
    // The folder the built program needs for its runtime DLLs.
    expect(discovery.compiler.binDir).toBe(path.dirname(discovery.compiler.exe));
  }, 30000);

  it('accepts an explicit compiler path and labels it as configured', async () => {
    if (!compiler) return;
    const byFolder = await discoverCpp({ customPath: path.dirname(compiler.exe), force: true });
    expect(byFolder.compiler, 'a compiler folder must be found through the setting').toBeTruthy();
    expect(byFolder.compiler!.source).toBe('custom');
    expect(byFolder.compiler!.exe.toLowerCase()).toBe(compiler.exe.toLowerCase());
    const byExe = await discoverCpp({ customPath: compiler.exe, force: true });
    expect(byExe.compiler!.source).toBe('custom');
  }, 30000);

  it('reports an unusable configured path without claiming it works', async () => {
    const bogus = path.join(tempRoot, 'definitely-not-a-compiler.exe');
    const res = await discoverCpp({ customPath: bogus, force: true });
    // The real install (if any) is still allowed to answer; the point is that a
    // stale setting alone can never produce a `found` result.
    if (res.compiler) expect(res.compiler.source).not.toBe('custom');
    expect(res.compiler ? res.compiler.exe.toLowerCase() : null).not.toBe(bogus.toLowerCase());
  }, 30000);
});

describe.runIf(CPP_ON_PATH)('real C++ builds through the desktop run path', () => {
  it('compiles and runs an unsaved single-file buffer', async () => {
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '#include <iostream>\nint main(){ std::cout << "CPP BUFFER OK\\n"; return 0; }\n',
    });
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('CPP BUFFER OK');
    expect(col.exit?.code).toBe(0);
    expect(col.info).toMatch(/C\+\+ ·/);
  }, 90000);

  it('builds a multi-file project from its CMake target and runs it in a folder with spaces', async () => {
    const root = makeStudentProject();
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '',
      filePath: path.join(root, 'src', 'main.cpp'),
      projectPath: path.join(root, 'src', 'main.cpp'),
      workspaceRoot: root,
    });
    expect(col.result.ok, col.result.message).toBe(true);
    // The implementation file was compiled and linked, not just main.cpp.
    expect(col.stdout).toContain('StackAmit-IDE C++ Test Project');
    expect(col.stdout).toContain('Utility test: CPP WORKS');
    expect(col.stdout).toContain('STATUS: SUCCESS');
    expect(col.exit?.code).toBe(0);
    expect(col.info).toMatch(/cmake-target/);
    expect(col.info).toMatch(/Project root: /);
  }, 90000);

  it('builds the test target when the test file is what was opened', async () => {
    const root = makeStudentProject();
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '',
      filePath: path.join(root, 'tests', 'test_main.cpp'),
      projectPath: path.join(root, 'tests', 'test_main.cpp'),
      workspaceRoot: root,
    });
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('All 6 C++ tests passed.');
    expect(col.exit?.code).toBe(0);
    expect(col.info).toMatch(/target CppUnitTests/);
  }, 90000);

  it('follows the project’s includes when there is no build descriptor', async () => {
    const root = makeStudentProject();
    fs.rmSync(path.join(root, 'CMakeLists.txt'));
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '',
      filePath: path.join(root, 'src', 'main.cpp'),
      projectPath: path.join(root, 'src', 'main.cpp'),
      workspaceRoot: root,
    });
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('Utility test: CPP WORKS');
    expect(col.info).toMatch(/include-closure/);
  }, 90000);

  it('runs the program with the project root as its working directory', async () => {
    const root = makeStudentProject();
    write(root, 'data.txt', 'read-from-project-root');
    write(
      root,
      'src/main.cpp',
      ['#include <fstream>', '#include <iostream>', '#include <string>', 'int main() {', '  std::ifstream in("data.txt");', '  std::string line;', '  std::getline(in, line);', '  std::cout << "data:" << line << "\\n";', '}', ''].join('\n'),
    );
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '',
      filePath: path.join(root, 'src', 'main.cpp'),
      projectPath: path.join(root, 'src', 'main.cpp'),
      workspaceRoot: root,
    });
    expect(col.stdout).toContain('data:read-from-project-root');
    expect(col.exit?.code).toBe(0);
  }, 90000);

  it('streams compiler diagnostics and runs nothing when the compile fails', async () => {
    const root = makeStudentProject();
    write(root, 'src/main.cpp', 'int main() { this is not valid c++ }\n');
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '',
      filePath: path.join(root, 'src', 'main.cpp'),
      projectPath: path.join(root, 'src', 'main.cpp'),
      workspaceRoot: root,
    });
    // The run *started*; the compiler is what refused.
    expect(col.result.ok).toBe(true);
    expect(col.stderr.length, 'compiler diagnostics must reach the Output panel').toBeGreaterThan(0);
    expect(col.stderr).toMatch(/error/i);
    expect(col.info).toMatch(/stopped: compile failed/);
    expect(col.stdout).not.toContain('STATUS: SUCCESS');
    expect(col.exit?.code).not.toBe(0);
  }, 90000);

  it('does not execute an older executable after a later compile fails', async () => {
    const root = makeStudentProject();
    const file = path.join(root, 'src', 'main.cpp');
    const good = await runToCompletion({ language: 'cpp', sourceCode: '', filePath: file, projectPath: file, workspaceRoot: root });
    expect(good.stdout).toContain('STATUS: SUCCESS');
    // Break one of the *other* files: the failing build must not silently launch
    // the program that is still sitting in the previous run's scratch folder.
    write(root, 'src/TextUtils.cpp', 'this will not compile\n');
    const broken = await runToCompletion({ language: 'cpp', sourceCode: '', filePath: file, projectPath: file, workspaceRoot: root });
    expect(broken.info).toMatch(/stopped: compile failed/);
    expect(broken.stdout).toBe('');
    expect(broken.exit?.code).not.toBe(0);
  }, 120000);

  it('reports a runtime exit code separately from a build failure', async () => {
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '#include <cstdlib>\nint main(){ return 3; }\n',
    });
    expect(col.stdout).toBe('');
    expect(col.info).not.toMatch(/stopped: compile failed/);
    expect(col.exit?.code).toBe(3);
  }, 90000);

  it('delivers stdin to a C++ program', async () => {
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '#include <iostream>\n#include <string>\nint main(){ std::string s; std::getline(std::cin, s); std::cout << "got:" << s << "\\n"; }\n',
      stdin: 'from the editor\n',
    });
    expect(col.stdout).toContain('got:from the editor');
  }, 90000);

  it('builds an unsaved buffer against its project instead of alone', async () => {
    // The dirty-editor path: the buffer stands for `src/main.cpp`, so the
    // project's other sources are compiled next to the *edited* text — and the
    // copy on disk must not be compiled a second time (duplicate `main`).
    const root = makeStudentProject();
    const edited = [
      '#include <iostream>',
      '#include "TextUtils.h"',
      'int main() {',
      '  std::cout << "EDITED:" << shout("CPP") << "\\n";',
      '}',
      '',
    ].join('\n');
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: edited,
      filePath: null,
      projectPath: path.join(root, 'src', 'main.cpp'),
      workspaceRoot: root,
    });
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('EDITED:CPP WORKS');
    expect(col.stdout).not.toContain('StackAmit-IDE C++ Test Project');
    expect(col.exit?.code).toBe(0);
  }, 120000);

  it('pressing Run on a header builds the program that includes it', async () => {
    const root = makeStudentProject();
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '',
      filePath: path.join(root, 'include', 'TextUtils.h'),
      projectPath: path.join(root, 'include', 'TextUtils.h'),
      workspaceRoot: root,
    });
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('Utility test: CPP WORKS');
  }, 120000);

  it('stops a program that outruns the time limit and kills the child', async () => {
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: 'int main(){ for(;;) {} }',
      timeoutMs: 20000,
    }, 60000);
    expect(col.result.ok).toBe(true);
    expect(col.exit?.timedOut).toBe(true);
    expect(col.info).toMatch(/time limit/);
  }, 120000);

  it('Stop terminates a running program', async () => {
    // The program waits on the clock rather than `std::this_thread::sleep_for`:
    // a sleep needs winpthreads, which the MinGW.org build of GCC 6.3 does not
    // ship, so a thread-based fixture fails at link time and tests nothing.
    const source = [
      '#include <cstdio>',
      '#include <ctime>',
      'int main() {',
      '  std::printf("started\\n");',
      '  std::fflush(stdout);',
      '  std::time_t until = std::time(nullptr) + 120;',
      '  while (std::time(nullptr) < until) {}',
      '  return 0;',
      '}',
      '',
    ].join('\n');
    const col: Collected = { result: { ok: false }, events: [], stdout: '', stderr: '', info: '', errors: '', exit: null };
    let sessionId: string | null = null;
    const res = await start(
      { language: 'cpp', sourceCode: source, tempRoot },
      (e) => {
        if (e.type === 'exit') col.exit = e;
        else if (e.type === 'stdout') col.stdout += e.data;
        else if (e.type === 'info') col.info += e.data;
        else if (e.type === 'error') col.errors += e.data;
      },
    );
    col.result = res as Collected['result'];
    if (res.ok) {
      sessionId = res.sessionId;
      const deadline = Date.now() + 60000;
      while (!col.stdout.includes('started') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      // Without this line the failure below is meaningless: it would say Stop
      // did not work when the program never started.
      expect(col.stdout, `the program never printed its first line (${col.info}${col.errors})`).toContain('started');
      expect(stop(sessionId)).toBe(true);
    }
    expect(col.exit?.stopped).toBe(true);
    expect(col.info).toMatch(/Stopped by user/);
  }, 120000);

  it('leaves no build output in the project folder', async () => {
    const root = makeStudentProject();
    const before = fs.readdirSync(root).sort();
    await runToCompletion({
      language: 'cpp',
      sourceCode: '',
      filePath: path.join(root, 'src', 'main.cpp'),
      projectPath: path.join(root, 'src', 'main.cpp'),
      workspaceRoot: root,
    });
    expect(fs.readdirSync(root).sort()).toEqual(before);
    // …and nothing is left behind in the scratch folders either.
    expect(fs.existsSync(path.join(root, 'src', 'main.obj'))).toBe(false);
  }, 90000);

  it('does not leak the parent environment into the compiled program', async () => {
    process.env.STACKAMIT_CPP_CANARY = 'must-not-leak';
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '#include <cstdio>\n#include <cstdlib>\nint main(){ const char* s = std::getenv("STACKAMIT_CPP_CANARY"); std::printf("canary=%s\\n", s ? s : "ABSENT"); std::printf("path=%s\\n", std::getenv("PATH") ? "yes" : "no"); }\n',
    });
    delete process.env.STACKAMIT_CPP_CANARY;
    expect(col.stdout).toContain('canary=ABSENT');
    // PATH still arrives — the compiler folder is prepended to it on purpose.
    expect(col.stdout).toContain('path=yes');
    expect(col.stdout).not.toContain('must-not-leak');
  }, 90000);

  it('builds with the standard the project asks for, or says it came down', async () => {
    const root = workspace17Project();
    const col = await runToCompletion({
      language: 'cpp',
      sourceCode: '',
      filePath: path.join(root, 'src', 'main.cpp'),
      projectPath: path.join(root, 'src', 'main.cpp'),
      workspaceRoot: root,
    });
    expect(col.result.ok, col.result.message).toBe(true);
    expect(col.stdout).toContain('STD-PROBE DONE');
    // The choice is *measured*, not assumed: re-ask the same compiler the same
    // question and require the build note to agree with the answer. Older
    // toolchains accept `-std=c++17` while implementing little of it, so a
    // feature-based fixture would test the compiler rather than the runner.
    const accepts17 = await compilerAcceptsStandard(compiler!, 'c++17');
    if (accepts17) expect(col.info, col.info).toMatch(/-std=c\+\+17/);
    else expect(col.info).toMatch(/does not accept it/);
    console.log(`[cppToolchain] project asked for C++17 → ${col.info.split('\n')[0]}; compiler reported __cplusplus=${col.stdout.match(/CPLUSPLUS:(\d+)/)?.[1]}`);
    expect(col.exit?.code).toBe(0);
  }, 90000);
});

/**
 * A project that asks for C++17. The program itself compiles under any
 * standard and prints the value of `__cplusplus`, which is what makes this a
 * test of the flag the runner passes rather than of a specific feature.
 */
function workspace17Project(): string {
  const root = makeDir('cpp17-');
  write(
    root,
    'src/main.cpp',
    ['#include <iostream>', 'int main() {', '  std::cout << "CPLUSPLUS:" << __cplusplus << "\\n";', '  std::cout << "STD-PROBE DONE\\n";', '  return 0;', '}', ''].join('\n'),
  );
  write(
    root,
    'CMakeLists.txt',
    ['cmake_minimum_required(VERSION 3.16)', 'set(CMAKE_CXX_STANDARD 17)', 'add_executable(App17 src/main.cpp)', ''].join('\n'),
  );
  return root;
}

describe.skipIf(CPP_ON_PATH)('no C++ compiler on this machine', () => {
  it('says so with an actionable message instead of pretending to run', async () => {
    const col = await runToCompletion({ language: 'cpp', sourceCode: 'int main(){}' });
    expect(col.result.ok).toBe(false);
    expect(['RUNTIME_MISSING', 'NO_LOCAL_PLAN', 'CPP_COMPILER_MISSING']).toContain(col.result.code);
    expect(col.result.message).toMatch(/compiler|C\+\+/i);
  });
});
