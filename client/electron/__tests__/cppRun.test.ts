import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CPP_STANDARDS,
  chooseStandard,
  cmakeCalls,
  entrySourceForHeader,
  findProjectRoot,
  hasMainFunction,
  invalidateStandardCache,
  parseCmakeLists,
  planCppRun,
  realCppIndex,
  resolveIncludeClosure,
  scanIncludes,
  stripCppCommentsAndLiterals,
} from '../services/cppRun';
import { type CppCompiler } from '../services/runtimeProbe';

/**
 * C++ build planning — the decision layer of the desktop C++ run.
 *
 * No compiler is spawned anywhere in this file: `accepts` is injected and the
 * project fixtures live in temp folders, so every assertion below is about what
 * the planner *chooses* (which sources, which include paths, which standard,
 * which working directory). The real toolchain behaviour is verified in
 * `cppToolchain.integration.test.ts`, and the user's own project in Phase 8.
 */

const IS_WIN = process.platform === 'win32';
const tempDirs: string[] = [];

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-plan-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(dir: string, rel: string, text: string): string {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

/** argv paths are compared in one written form: `/` on every platform. */
const slash = (p: string) => p.replace(/\\/g, '/');

afterEach(() => {
  invalidateStandardCache();
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* temp noise must not fail a test */
    }
  }
});

/** A compiler the planner can be tested against without one being installed. */
function fakeCompiler(overrides: Partial<CppCompiler> = {}): CppCompiler {
  return {
    exe: IS_WIN ? 'C:\\fake\\mingw\\bin\\g++.exe' : '/fake/mingw/bin/g++',
    binDir: IS_WIN ? 'C:\\fake\\mingw\\bin' : '/fake/mingw/bin',
    cmd: 'g++',
    family: 'gcc',
    version: 'g++.exe (Fake GCC) 13.2.0',
    major: 13,
    minor: 2,
    source: 'PATH',
    ...overrides,
  };
}

/** A std probe that accepts what the test asks for and nothing newer. */
function acceptsOnly(...stds: string[]) {
  return async (_c: CppCompiler, std: string) => stds.includes(std);
}

/**
 * The layout of a real multi-file project, written to disk: a header in
 * `include/`, its implementation in `src/`, and a `main.cpp` that uses both —
 * exactly the shape that a "compile the open file only" runner cannot build.
 */
function makeProject(opts: { cmake?: string | null; extraSource?: boolean } = {}): string {
  const root = workspace();
  writeFile(root, 'include/Student.h', '#pragma once\n#include <string>\nstruct Student { std::string name; int score; };\n');
  writeFile(root, 'include/TextUtils.h', '#pragma once\n#include <string>\nstd::string shout(const std::string&);\n');
  writeFile(root, 'src/Student.cpp', '#include "Student.h"\n#include <algorithm>\nint best(const Student* s){ return s->score; }\n');
  writeFile(root, 'src/TextUtils.cpp', '#include "TextUtils.h"\nstd::string shout(const std::string& s){ return s + "!"; }\n');
  writeFile(
    root,
    'src/main.cpp',
    '#include <iostream>\n#include "Student.h"\n#include "TextUtils.h"\n#include "Student.cpp"\nint main(){ Student a{"Amit",88}; std::cout << shout(a.name) << a.score; }\n',
  );
  if (opts.extraSource) writeFile(root, 'src/Unused.cpp', 'int unused_helper(){ return 1; }\n');
  if (opts.cmake !== null) {
    writeFile(
      root,
      'CMakeLists.txt',
      opts.cmake ||
        `cmake_minimum_required(VERSION 3.16)\nproject(Proj LANGUAGES CXX)\nset(CMAKE_CXX_STANDARD 17)\nadd_executable(App\n    src/main.cpp\n    src/Student.cpp\n    src/TextUtils.cpp\n)\ntarget_include_directories(App PRIVATE include)\nadd_executable(UnitTests\n    tests/test_main.cpp\n    src/Student.cpp\n    src/TextUtils.cpp\n)\ntarget_include_directories(UnitTests PRIVATE include)\n`,
    );
  }
  return root;
}

// ---------------------------------------------------------------------------
// CMake descriptor reading
// ---------------------------------------------------------------------------
describe('parseCmakeLists', () => {
  it('reads targets, sources, include dirs and the standard', () => {
    const cmake = parseCmakeLists(
      `set(CMAKE_CXX_STANDARD 17)\nadd_executable(App src/main.cpp src/a.cpp)\ntarget_include_directories(App PRIVATE include)\n`,
    );
    expect(cmake.standard).toBe(17);
    expect(cmake.targets.map((t) => t.name)).toEqual(['App']);
    expect(cmake.targets[0].sources).toEqual(['src/main.cpp', 'src/a.cpp']);
    expect(cmake.targets[0].includes).toEqual(['include']);
    expect(cmake.limitations).toEqual([]);
  });

  it('handles a multi-line call, comments and quoted arguments', () => {
    const cmake = parseCmakeLists(
      `# a comment with add_executable(Nope x.cpp) inside\nadd_executable(App\n  "src/main.cpp"   # trailing comment\n  src/b.cpp\n)\n`,
    );
    expect(cmake.targets[0].name).toBe('App');
    expect(cmake.targets[0].sources).toEqual(['src/main.cpp', 'src/b.cpp']);
  });

  it('reports what it cannot honour instead of dropping it silently', () => {
    const cmake = parseCmakeLists(
      `find_package(fmt REQUIRED)\nadd_subdirectory(external)\ntarget_link_libraries(App PRIVATE fmt::fmt)\nadd_executable(App \${SOURCES} src/main.cpp)\n`,
    );
    const text = cmake.limitations.join('\n');
    expect(text).toMatch(/find_package/i);
    expect(text).toMatch(/add_subdirectory/i);
    expect(text).toMatch(/target_link_libraries/i);
    expect(text).toMatch(/variable/i);
    // The one source it *can* read still is read.
    expect(cmake.targets[0].sources).toEqual(['src/main.cpp']);
  });

  it('separates include_directories() from a target and keeps both', () => {
    const cmake = parseCmakeLists(`include_directories(vendor)\nadd_executable(App a.cpp)\ntarget_include_directories(App PRIVATE include)\n`);
    expect(cmake.globalIncludes).toEqual(['vendor']);
    expect(cmake.targets[0].includes).toEqual(['include']);
  });

  it('ignores CMake keywords that are not file names', () => {
    const cmake = parseCmakeLists(`add_executable(App WIN32 EXCLUDE_FROM_ALL src/main.cpp)\n`);
    expect(cmake.targets[0].sources).toEqual(['src/main.cpp']);
  });

  it('survives an empty or nonsense file without inventing a target', () => {
    expect(parseCmakeLists('').targets).toEqual([]);
    expect(parseCmakeLists('message(STATUS "hi")').targets).toEqual([]);
  });
});

describe('cmakeCalls', () => {
  it('splits balanced calls in order', () => {
    const calls = cmakeCalls('project(Demo LANGUAGES CXX)\nset(CMAKE_CXX_STANDARD 17)\n');
    expect(calls.map((c) => c.name)).toEqual(['project', 'set']);
    expect(calls[1].args).toEqual(['CMAKE_CXX_STANDARD', '17']);
  });
});

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------
describe('C++ source scanning', () => {
  it('reads quoted includes and ignores the ones inside comments', () => {
    const src = `#include <iostream>\n#include "Student.h"\n// #include "Ghost.h"\n/* #include "AlsoGhost.h" */\nconst char* p = "#include \"Fake.h\"";\n`;
    expect(scanIncludes(src)).toEqual(['iostream', 'Student.h']);
  });

  it('finds main() only where it is really defined', () => {
    expect(hasMainFunction('int main(int argc, char** argv) { return 0; }')).toBe(true);
    expect(hasMainFunction('static int helper(){ return 0; }')).toBe(false);
    expect(hasMainFunction('// int main() commented out\nvoid f(){}')).toBe(false);
    expect(hasMainFunction('const char* s = "int main()";')).toBe(false);
    expect(hasMainFunction('int\nmain()\n{\n}\n')).toBe(true);
  });

  it('keeps the line structure when stripping comments', () => {
    const stripped = stripCppCommentsAndLiterals('a\n/* x\ny */b\nc');
    expect(stripped.split('\n')).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Project root
// ---------------------------------------------------------------------------
describe('findProjectRoot', () => {
  it('uses the CMakeLists.txt folder, not the source folder', () => {
    const root = makeProject();
    expect(findProjectRoot(path.join(root, 'src', 'main.cpp'), null, realCppIndex)).toBe(root);
  });

  it('recognises the conventional include/ + src/ layout with no build file', () => {
    const root = makeProject({ cmake: null });
    expect(findProjectRoot(path.join(root, 'src', 'main.cpp'), null, realCppIndex)).toBe(root);
  });

  it('falls back to the file’s own folder for a one-file project', () => {
    const root = workspace();
    const file = writeFile(root, 'single.cpp', 'int main(){}\n');
    expect(findProjectRoot(file, null, realCppIndex)).toBe(root);
  });

  it('never walks above the folder the user opened', () => {
    const root = workspace();
    const nested = path.join(root, 'project');
    const file = writeFile(nested, 'src/main.cpp', 'int main(){}\n');
    fs.writeFileSync(path.join(root, 'CMakeLists.txt'), 'add_executable(Outer src/main.cpp)\n', 'utf8');
    expect(findProjectRoot(file, nested, realCppIndex)).toBe(nested);
  });
});

// ---------------------------------------------------------------------------
// Include closure (the no-build-system path)
// ---------------------------------------------------------------------------
describe('resolveIncludeClosure', () => {
  it('pulls in the implementation file of every header the program includes', () => {
    const root = makeProject({ cmake: null, extraSource: true });
    const files = realCppIndex.list(root);
    const closure = resolveIncludeClosure(path.join(root, 'src', 'main.cpp'), root, files, realCppIndex);
    const names = closure.sources.map((f) => path.relative(root, f).replace(/\\/g, '/')).sort();
    // main.cpp + Student.cpp + TextUtils.cpp (reached through the headers), and
    // never the unreferenced Unused.cpp that would only add link weight.
    expect(names).toEqual(['src/Student.cpp', 'src/TextUtils.cpp', 'src/main.cpp']);
    expect(closure.includeDirs.map((d) => path.relative(root, d).replace(/\\/g, '/').toLowerCase())).toContain('include');
  });

  it('does not claim sources for a program that includes nothing local', () => {
    const root = makeProject({ cmake: null });
    const file = writeFile(root, 'src/lonely.cpp', '#include <iostream>\nint main(){}\n');
    const closure = resolveIncludeClosure(file, root, realCppIndex.list(root), realCppIndex);
    expect(closure.sources.map((f) => path.basename(f))).toEqual(['lonely.cpp']);
  });
});

describe('entrySourceForHeader', () => {
  it('runs the source that includes the header, preferring the one with main', () => {
    const root = makeProject({ cmake: null });
    const entry = entrySourceForHeader(path.join(root, 'include', 'Student.h'), realCppIndex.list(root), realCppIndex);
    expect(entry && path.basename(entry)).toBe('main.cpp');
  });

  it('says nothing runnable for a header no source references', () => {
    const root = workspace();
    const header = writeFile(root, 'include/Alone.h', '#pragma once\n');
    expect(entrySourceForHeader(header, realCppIndex.list(root), realCppIndex)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Standard selection
// ---------------------------------------------------------------------------
describe('chooseStandard', () => {
  it('keeps the standard the project asked for when the compiler takes it', async () => {
    const res = await chooseStandard(fakeCompiler(), 'c++17', acceptsOnly('c++17', 'c++14'));
    expect(res).toEqual({ stdFlag: '-std=c++17', downgradedFrom: null });
  });

  it('downgrades to what the compiler really accepts and says so', async () => {
    const res = await chooseStandard(fakeCompiler(), 'c++20', acceptsOnly('c++14', 'c++11'));
    expect(res.stdFlag).toBe('-std=c++14');
    expect(res.downgradedFrom).toBe('c++20');
  });

  it('offers no flag at all rather than one that was never probed', async () => {
    const res = await chooseStandard(fakeCompiler(), null, async () => false);
    expect(res.stdFlag).toBeNull();
  });

  it('probes the newest standards first when the project states none', async () => {
    const asked: string[] = [];
    await chooseStandard(fakeCompiler(), null, async (_c, std) => {
      asked.push(std);
      return std === 'c++14';
    });
    expect(asked.slice(0, 3)).toEqual(CPP_STANDARDS.slice(0, 3));
    expect(asked).toContain('c++14');
  });
});

// ---------------------------------------------------------------------------
// The plan itself
// ---------------------------------------------------------------------------
describe('planCppRun', () => {
  const outDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-out-'));
    tempDirs.push(dir);
    return dir;
  };

  it('builds the CMake target that owns the file, with its include dirs and standard', async () => {
    const root = makeProject();
    const res = await planCppRun({
      compiler: fakeCompiler(),
      entryFile: path.join(root, 'src', 'main.cpp'),
      root,
      outDir: outDir(),
      accepts: acceptsOnly('c++17', 'c++14'),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const plan = res.plan;
    expect(plan.strategy).toBe('cmake-target');
    expect(plan.targetName).toBe('App');
    expect(plan.stdFlag).toBe('-std=c++17');
    // Every implementation file the target lists, not just the open one.
    expect(plan.sources.map((s) => path.basename(s)).sort()).toEqual(['Student.cpp', 'TextUtils.cpp', 'main.cpp']);
    const compile = plan.steps[0];
    expect(compile.args.filter((a) => a.endsWith('.cpp')).map(slash)).toEqual(['src/main.cpp', 'src/Student.cpp', 'src/TextUtils.cpp']);
    expect(compile.args).toEqual(expect.arrayContaining(['-I', 'include']));
    expect(compile.cwd).toBe(root);
    expect(compile.stdin).toBe(false);
    expect(plan.steps).toHaveLength(2);
  });

  it('keeps project paths relative to the root and the executable absolute in the scratch folder', async () => {
    const root = makeProject();
    const dir = outDir();
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'src', 'main.cpp'), root, outDir: dir, accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error('plan failed');
    const argv = res.plan.steps[0].args;
    expect(argv.some((a) => a.includes(root.replace(/\\/g, '/')) || (IS_WIN && a.includes(root)))).toBe(false);
    expect(res.plan.exePath.startsWith(dir)).toBe(true);
    expect(res.plan.exePath).toMatch(IS_WIN ? /\.exe$/ : /App$/);
  });

  it('launches the program from the project root with the compiler folder first on PATH', async () => {
    const root = makeProject();
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'src', 'main.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error('plan failed');
    const run = res.plan.steps[1];
    expect(run.cwd).toBe(root);
    expect(run.stdin).toBe(true);
    expect(run.file).toBe(res.plan.exePath);
    // A MinGW-built program cannot even start without the DLLs next to g++.
    expect(run.env?.PATH.split(path.delimiter)[0]).toBe(fakeCompiler().binDir);
  });

  it('follows the project’s own includes when there is no build descriptor', async () => {
    const root = makeProject({ cmake: null, extraSource: true });
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'src', 'main.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error('plan failed');
    expect(res.plan.strategy).toBe('include-closure');
    expect(res.plan.sources.map((s) => path.basename(s)).sort()).toEqual(['Student.cpp', 'TextUtils.cpp', 'main.cpp']);
    expect(res.plan.notes.join('\n')).toMatch(/Compiled the sources this program includes/);
  });

  it('compiles one whole folder when it holds a single main and no descriptors', async () => {
    const root = workspace();
    writeFile(root, 'a.cpp', '#include "b.h"\nint main(){ return helper(); }\n');
    writeFile(root, 'b.cpp', 'int helper(){ return 2; }\n');
    writeFile(root, 'b.h', 'int helper();\n');
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'a.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(['include-closure', 'folder-sources']).toContain(res.plan.strategy);
    expect(res.plan.sources.map((s) => path.basename(s)).sort()).toEqual(['a.cpp', 'b.cpp']);
  });

  it('compiles a lone file alone', async () => {
    const root = workspace();
    const file = writeFile(root, 'solo.cpp', '#include <iostream>\nint main(){ std::cout << 1; }\n');
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: file, root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(res.plan.strategy).toBe('single-file');
    expect(res.plan.sources).toHaveLength(1);
  });

  it('builds a second target when the opened file belongs to it (tests vs app)', async () => {
    const root = makeProject();
    writeFile(root, 'tests/test_main.cpp', '#include "Student.h"\n#include <cassert>\nint main(){ assert(1); }\n');
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'tests', 'test_main.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(res.plan.targetName).toBe('UnitTests');
    expect(res.plan.sources.map((s) => path.basename(s)).sort()).toEqual(['Student.cpp', 'TextUtils.cpp', 'test_main.cpp']);
    expect(res.plan.notes.join('\n')).toMatch(/also defines App/);
  });

  it('builds a program that CMakeLists.txt does not list instead of merging two mains', async () => {
    // A real shape: the user renames/adds a source with its own main(). Joining it
    // to a target that already has an entry point always fails to link.
    const root = makeProject();
    writeFile(
      root,
      'src/main1.cpp',
      '#include <iostream>\n#include "Student.h"\n#include "TextUtils.h"\nint main(){ std::cout << "banner"; }\n',
    );
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'src', 'main1.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(res.plan.strategy).not.toBe('cmake-target');
    expect(res.plan.targetName).toBeNull();
    const argv = res.plan.steps[0].args.map(slash);
    const mains = argv.filter((a) => a === 'src/main.cpp' || a === 'tests/test_main.cpp' || a === 'src/main1.cpp');
    expect(mains).toEqual(['src/main1.cpp']);
    // What the descriptor still gets to say: the search path and the standard.
    expect(argv).toEqual(expect.arrayContaining(['-I', 'include']));
    expect(res.plan.stdFlag).toBe('-std=c++17');
    const notes = res.plan.notes.join('\n');
    expect(notes).toMatch(/main1\.cpp is not listed in CMakeLists\.txt and defines its own main\(\)/);
    expect(notes).not.toMatch(/also defines/);
  });

  it('still attaches a helper file with no main() to the target that has one', async () => {
    const root = makeProject();
    writeFile(root, 'src/Extra.cpp', '#include "Student.h"\nint extra(const Student* s){ return s->score; }\n');
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'src', 'Extra.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(res.plan.strategy).toBe('cmake-target');
    expect(res.plan.targetName).toBe('App');
    expect(res.plan.sources.map((s) => path.basename(s))).toContain('Extra.cpp');
  });

  it('treats an unsaved buffer as its own project file instead of compiling a duplicate', async () => {
    const root = makeProject();
    const tempDir = workspace();
    const buffer = writeFile(tempDir, 'main.cpp', '#include "Student.h"\n#include <iostream>\nint main(){ std::cout << "EDITED"; }\n');
    const diskEntry = path.join(root, 'src', 'main.cpp');
    const res = await planCppRun({
      compiler: fakeCompiler(),
      entryFile: buffer,
      root,
      outDir: outDir(),
      entryOutsideRoot: true,
      replaces: [diskEntry],
      accepts: acceptsOnly('c++17'),
    });
    if (!res.ok) throw new Error(JSON.stringify(res));
    const argv = res.plan.steps[0].args;
    // The buffer replaces the file on disk: it appears, the disk copy does not.
    expect(argv).toContain(buffer);
    expect(argv.filter((a) => slash(a).endsWith('/src/main.cpp'))).toEqual([]);
    // …and the throwaway folder is searched for its own neighbours.
    expect(argv).toContain(path.dirname(buffer));
  });

  it('redirects a header press to the source that includes it', async () => {
    const root = makeProject({ cmake: null });
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'include', 'Student.h'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(path.basename(res.plan.sources[0])).toBe('main.cpp');
  });

  it('refuses a file that is not C++ at all, and a header nobody includes', async () => {
    const root = workspace();
    const txt = writeFile(root, 'notes.txt', 'hello');
    const bad = await planCppRun({ compiler: fakeCompiler(), entryFile: txt, root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('CPP_NOT_A_SOURCE');

    const lonely = writeFile(root, 'include/Alone.h', '#pragma once\n');
    const noEntry = await planCppRun({ compiler: fakeCompiler(), entryFile: lonely, root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    expect(noEntry.ok).toBe(false);
    if (!noEntry.ok) {
      expect(noEntry.code).toBe('CPP_NO_ENTRY_SOURCE');
      expect(noEntry.message).toMatch(/header/i);
    }
  });

  it('says out loud when the standard had to come down', async () => {
    const root = makeProject(); // CMakeLists asks for C++17
    const res = await planCppRun({ compiler: fakeCompiler({ cmd: 'g++', version: 'g++.exe (MinGW.org GCC-6.3.0-1) 6.3.0', major: 6 }), entryFile: path.join(root, 'src', 'main.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++14', 'c++11') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(res.plan.stdFlag).toBe('-std=c++14');
    expect(res.plan.requestedStd).toBe('c++17');
    expect(res.plan.notes.join('\n')).toMatch(/does not accept it/);
  });

  it('carries the descriptor’s unresolved dependencies into the notes', async () => {
    const root = workspace();
    writeFile(root, 'src/main.cpp', '#include <fmt/core.h>\nint main(){}\n');
    writeFile(root, 'CMakeLists.txt', 'find_package(fmt REQUIRED)\ntarget_link_libraries(App PRIVATE fmt::fmt)\nadd_executable(App src/main.cpp)\n');
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'src', 'main.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(res.plan.notes.join('\n')).toMatch(/find_package|target_link_libraries/i);
  });

  it('never puts a shell metacharacter between the compiler and its arguments', async () => {
    // A folder named `C++ test` is the reported case: the argv array is what
    // makes it work, so nothing may be concatenated into a command string.
    const root = path.join(workspace(), 'C++ test folder & (parens)');
    fs.mkdirSync(root, { recursive: true });
    writeFile(root, 'src/main.cpp', 'int main(){}\n');
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'src', 'main.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    for (const step of res.plan.steps) {
      expect(step.args.some((a) => /cmd\.exe|\/c$|&&/.test(a))).toBe(false);
      expect(Array.isArray(step.args)).toBe(true);
    }
    expect(res.plan.steps[0].cwd).toBe(root);
  });

  it('names the built program after the project target', async () => {
    const root = makeProject();
    const res = await planCppRun({ compiler: fakeCompiler(), entryFile: path.join(root, 'src', 'main.cpp'), root, outDir: outDir(), accepts: acceptsOnly('c++17') });
    if (!res.ok) throw new Error(JSON.stringify(res));
    expect(path.basename(res.plan.exePath)).toBe(IS_WIN ? 'App.exe' : 'App');
  });
});
