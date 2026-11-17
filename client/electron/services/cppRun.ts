/**
 * C++ build & run planning (Electron main process).
 *
 * Why this is its own module: deciding *what to compile* is the hard part of
 * running C++ — an IDE that only compiles the file under the cursor produces a
 * `undefined reference to main`-style link error for every real project, while a
 * naive "compile every .cpp I can find" produces duplicate `main` symbols. The
 * planner below resolves that from what the project itself states, and `
 * localRun.ts` keeps doing what it is good at: spawning, streaming, timing out,
 * killing.
 *
 * Three sources of truth, in this order:
 *  1. a `CMakeLists.txt` in the project — its `add_executable()` /
 *     `target_include_directories()` / `set(CMAKE_CXX_STANDARD)` lines are a
 *     complete, human-written description of the build, so they drive the
 *     compiler command line directly. **No `cmake` binary is needed or claimed**:
 *     this reads the descriptor, it does not run CMake, and every construct it
 *     cannot resolve (`find_package`, `add_subdirectory`, `${VAR}` source lists)
 *     is reported to the user instead of being quietly dropped.
 *  2. no descriptor → follow the project's own `#include "…"` edges from the
 *     entry file and pull in the implementation file each header names
 *     (`Student.h` → `Student.cpp`). This is what makes a plain multi-file
 *     project build without any build system at all.
 *  3. neither works → the entry file alone, which is still correct for the
 *     single-file programs the editor is often used for.
 *
 * Two argv rules come from the Java work on this same machine, not preference:
 *  - **project paths stay relative to `cwd` = the project root.** Compilers
 *    receive their command line through the process ANSI code page, so a folder
 *    name outside it can arrive mangled; the same file addressed relatively from
 *    its own root compiles. Only the built executable lives at an absolute path
 *    — inside a scratch directory this app created, never user content.
 *  - **the built program is launched with the compiler's own `bin` prepended to
 *    the child PATH.** A MinGW-built executable imports `libstdc++-6.dll` and
 *    `libgcc_s_dw2-1.dll` from that folder; without it the program compiled fine
 *    and then failed to start with an opaque "DLL not found" error.
 *
 * No path, source text or user input is ever interpolated into a shell command
 * line: every step is an executable plus an argv array, which is why a project
 * folder named like `C:\\somewhere\\C++ test & stuff\\` (space, plus, ampersand)
 * needs no quoting.
 */
import fs from 'node:fs';
import path from 'node:path';

import { IS_WIN, mergedPathEnv, probeRuntime, type CppCompiler } from './runtimeProbe.js';

/** File extensions this runner treats as translation units. */
export const CPP_SOURCE_EXT = ['.cpp', '.cc', '.cxx'];
/** … and as headers (never compiled on their own). */
export const CPP_HEADER_EXT = ['.hpp', '.hh', '.hxx', '.h', '.inl'];

/** One child process in a build/run. Mirrors `localRun.SpawnStep` structurally. */
export type CppStep = {
  cmd: string;
  /** Absolute executable — the discovered compiler, never PATH's guess. */
  file: string;
  args: string[];
  cwd: string;
  stdin: boolean;
  label: string;
  /** Extra environment for this step (the run step gets the compiler's bin). */
  env?: Record<string, string>;
};

export type CppTarget = {
  name: string;
  /** Source paths exactly as the descriptor wrote them (usually relative). */
  sources: string[];
  /** Include directories for this target, relative to the descriptor folder. */
  includes: string[];
};

export type CMakeDescriptor = {
  targets: CppTarget[];
  globalIncludes: string[];
  standard: number | null;
  /** Constructions the descriptor uses that this runner does not resolve. */
  limitations: string[];
};

export type CppBuildPlan = {
  strategy: 'cmake-target' | 'include-closure' | 'folder-sources' | 'single-file';
  /** Working directory for both steps, and the base every path is relative to. */
  root: string;
  targetName: string | null;
  /** The `-std=…` flag actually used, or null for the compiler's default. */
  stdFlag: string | null;
  /** The standard the project asked for, kept so a downgrade is visible. */
  requestedStd: string | null;
  includes: string[];
  sources: string[];
  /** Absolute path of the executable this build produces (a scratch folder). */
  exePath: string;
  steps: CppStep[];
  notes: string[];
};

export type PlanResult = { ok: true; plan: CppBuildPlan } | { ok: false; code: string; message: string };

// ---------------------------------------------------------------------------
// The file-system view the planner uses (injectable, so the multi-file and
// include-path cases are unit-testable without touching a real disk).
// ---------------------------------------------------------------------------
export type CppFileIndex = {
  exists(p: string): boolean;
  isDirectory(p: string): boolean;
  /** UTF-8 text of a file, or '' when unreadable. */
  readFile(p: string): string;
  /** File paths under `dir`, recursively, bounded by depth and count. */
  list(dir: string): string[];
};

/** Folders that never hold project sources worth compiling. */
export const CPP_SKIP_DIRS = new Set([
  'build',
  'out',
  'dist',
  'node_modules',
  '.git',
  '.svn',
  '.idea',
  '.vs',
  '.cache',
  'cmake-build-debug',
  'cmake-build-release',
  'debug',
  'release',
  'x64',
  'win32',
  'third_party',
  'thirdparty',
  'deps',
  '_deps',
]);

export const realCppIndex: CppFileIndex = {
  exists: (p) => {
    try {
      return fs.statSync(p).isFile() || fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  isDirectory: (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  readFile: (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return '';
    }
  },
  list: (dir) => listRecursive(dir, 6, 3000),
};

function listRecursive(dir: string, depth: number, limit: number): string[] {
  if (depth < 0) return [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (out.length >= limit) break;
    const full = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (CPP_SKIP_DIRS.has(name.toLowerCase()) || name.startsWith('.')) continue;
      for (const child of listRecursive(full, depth - 1, limit)) {
        if (out.length >= limit) break;
        out.push(child);
      }
    } else if (stat.isFile()) out.push(full);
  }
  return out;
}

/** Case- and separator-insensitive key, because Windows paths are neither. */
function keyOf(p: string): string {
  return String(p).replace(/\\/g, '/').toLowerCase();
}

function hasExtension(p: string, exts: string[]): boolean {
  return exts.includes(path.extname(p).toLowerCase());
}

// ---------------------------------------------------------------------------
// Source-text scanning (comments and string literals must not count)
// ---------------------------------------------------------------------------
/**
 * Remove `//`/`/* … *\/` comments and string/char literal contents, keeping the
 * line structure so nothing about the following code shifts. Raw string
 * literals (`R"(…)"`) are not parsed; a `//` inside one is only ever cosmetic
 * for the two things looked for here (includes and `main`).
 */
export function stripCppCommentsAndLiterals(source: string): string {
  const text = String(source ?? '');
  let out = '';
  let i = 0;
  type State = 'code' | 'line' | 'block' | 'string' | 'char';
  let state: State = 'code';
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (state === 'code') {
      if (two === '//') {
        state = 'line';
        i += 2;
      } else if (two === '/*') {
        state = 'block';
        i += 2;
      } else if (text[i] === '"') {
        state = 'string';
        out += '"';
        i += 1;
      } else if (text[i] === "'") {
        state = 'char';
        out += "'";
        i += 1;
      } else {
        out += text[i];
        i += 1;
      }
      continue;
    }
    if (state === 'line') {
      if (text[i] === '\n') {
        state = 'code';
        out += '\n';
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (two === '*/') {
        state = 'code';
        i += 2;
        out += ' ';
      } else {
        if (text[i] === '\n') out += '\n';
        i += 1;
      }
      continue;
    }
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if ((state === 'string' && text[i] === '"') || (state === 'char' && text[i] === "'")) {
      out += text[i];
      state = 'code';
      i += 1;
      continue;
    }
    if (text[i] === '\n') {
      state = 'code'; // an unterminated literal: get back on track
      out += '\n';
      i += 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** The `"quoted"` (and `<angle>`) include names of one translation unit. */
export function scanIncludes(source: string): string[] {
  // Comments only: the path after `#include` is a string literal, and the full
  // literal-stripping pass would remove exactly the text being looked for.
  const clean = stripCppComments(source);
  const re = /^[ \t]*#[ \t]*include[ \t]*["<]([^">]+)[">]/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out.push(m[1].trim());
  return out;
}

/** True when the text defines a `main` entry point (a `-lmain`-style call is not it). */
export function hasMainFunction(source: string): boolean {
  const clean = stripCppCommentsAndLiterals(source);
  return /(^|[\s;{}])\b(?:[\w:*<>&\s]+(?:\([^)]*\))?\s+)*int\s+main\s*\(/.test(clean) ||
    /(^|[\s;{}])\bint\s*::\s*main\s*\(/.test(clean);
}

// ---------------------------------------------------------------------------
// CMakeLists.txt reading (the descriptor, not the tool)
// ---------------------------------------------------------------------------
/** `#`-to-end-of-line comments only (string literals keep their contents). */
function stripCmakeComments(text: string): string {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/(?<!\\)#.*$/, ''))
    .join('\n');
}

/**
 * Remove `//` and block comments while leaving string literals intact — a
 * preprocessor directive's argument *is* a string literal, so the full
 * literal-stripping pass cannot be used to read includes.
 */
export function stripCppComments(source: string): string {
  const text = String(source ?? '');
  let out = '';
  let i = 0;
  type State = 'code' | 'line' | 'block' | 'string' | 'char';
  let state: State = 'code';
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (state === 'code') {
      if (two === '//') {
        state = 'line';
        i += 2;
      } else if (two === '/*') {
        state = 'block';
        i += 2;
      } else {
        out += text[i];
        if (text[i] === '"') state = 'string';
        else if (text[i] === "'") state = 'char';
        i += 1;
      }
      continue;
    }
    if (state === 'line') {
      if (text[i] === '\n') {
        state = 'code';
        out += '\n';
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (two === '*/') {
        state = 'code';
        i += 2;
        out += ' ';
      } else {
        if (text[i] === '\n') out += '\n'; // keep line numbers meaningful
        i += 1;
      }
      continue;
    }
    // In a literal everything is data — a `//` inside "…" is not a comment.
    out += text[i];
    if (text[i] === '\\') {
      out += text[i + 1] || '';
      i += 2;
      continue;
    }
    if ((state === 'string' && text[i] === '"') || (state === 'char' && text[i] === "'")) state = 'code';
    if (text[i] === '\n') state = 'code'; // an unterminated literal
    i += 1;
  }
  return out;
}

/**
 * Command calls with their argument list, from balanced parentheses and
 * respecting quoted arguments. `list` and `if` bodies are read as plain calls
 * too, which is harmless: only the command names below are looked at.
 */
export function cmakeCalls(text: string): { name: string; args: string[] }[] {
  const out: { name: string; args: string[] }[] = [];
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    const args: string[] = [];
    let current = '';
    let quoted = false;
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          quoted = false;
          args.push(current.trim());
          current = '';
        } else current += ch;
        continue;
      }
      if (ch === '"') {
        quoted = true;
        if (current.trim()) args.push(current.trim());
        current = '';
      } else if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          if (current.trim()) args.push(current.trim());
          break;
        }
        current += ch;
      } else if (/\s/.test(ch)) {
        if (current.trim()) args.push(current.trim());
        current = '';
      } else current += ch;
    }
    // Resume *after* the closing bracket. Continuing inside the argument list
    // would read the tail of it as new calls: `…)\nadd_executable(UnitTests (`
    // lost its command name and invented one called `utable`, which is how a
    // test target silently disappeared from the build.
    re.lastIndex = i < text.length && depth === 0 ? i + 1 : re.lastIndex + m[0].length;
    out.push({ name: m[1], args: args.map((a) => a.replace(/\s+/g, ' ').trim()).filter(Boolean) });
  }
  return out;
}

const CMAKE_SKIPPED_ARGS = new Set([
  'win32',
  'macosx',
  'macosx_bundle',
  'exclude_from_all',
  'optional',
  'private',
  'public',
  'interface',
  'system',
  'before',
  'after',
  'interface',
]);

/**
 * Read a `CMakeLists.txt` body into a build description. Anything the runner
 * cannot honour is collected as a plain-language limitation, so the Output panel
 * can say "this descriptor references a package I did not resolve" instead of
 * producing a confusing link error.
 */
export function parseCmakeLists(text: string): CMakeDescriptor {
  const calls = cmakeCalls(stripCmakeComments(text));
  const targets: CppTarget[] = [];
  const globalIncludes: string[] = [];
  const limitations: string[] = [];
  let standard: number | null = null;
  const note = (message: string) => {
    if (!limitations.includes(message)) limitations.push(message);
  };

  const target = (name: string | undefined): CppTarget | null => {
    if (!name) return null;
    let found = targets.find((t) => t.name === name);
    if (!found) {
      found = { name, sources: [], includes: [] };
      targets.push(found);
    }
    return found;
  };

  for (const call of calls) {
    const name = call.name.toLowerCase();
    if (name === 'set') {
      const [variable, ...rest] = call.args;
      if (/^CMAKE_CXX_STANDARD$/i.test(variable || '')) {
        const value = rest.find((a) => /^\d+$/.test(a));
        if (value) standard = Number(value);
      }
      // A variable holding a source list (`set(SOURCES a.cpp b.cpp)`) is only
      // resolved when the reference below can match it.
      continue;
    }
    if (name === 'add_executable') {
      const [rawName, ...rest] = call.args;
      const sources: string[] = [];
      let unresolvedRefs = 0;
      for (const arg of rest) {
        if (CMAKE_SKIPPED_ARGS.has(arg.toLowerCase())) continue;
        if (arg.includes('$<')) {
          note(`A generator expression in the ${rawName || 'add_executable'} source list was skipped: ${arg}`);
          continue;
        }
        if (arg.includes('${')) {
          unresolvedRefs++;
          continue;
        }
        if (arg.startsWith('/') || /^[A-Za-z]:[\\/]/.test(arg)) {
          note(`An absolute source path in the ${rawName || 'add_executable'} list was skipped: ${arg}`);
          continue;
        }
        if (/\.(c|cpp|cc|cxx|C)$/.test(arg) || !/\./.test(arg)) sources.push(arg);
      }
      if (unresolvedRefs) note(`A \${…} variable in the ${rawName || 'add_executable'} source list is not resolved — its files are not compiled.`);
      const targetName = rawName && !rawName.includes('${') ? rawName : rawName ? 'app' : 'app';
      const existing = target(targetName);
      if (existing) existing.sources.push(...sources);
      continue;
    }
    if (name === 'add_library') {
      note(`add_library(${call.args[0] || '…'}) is not built by this runner — a library target's sources are only compiled when an executable needs them.`);
      continue;
    }
    if (name === 'target_include_directories') {
      const [targetName, ...rest] = call.args;
      const t = target(targetName);
      for (const arg of rest) {
        if (CMAKE_SKIPPED_ARGS.has(arg.toLowerCase())) continue;
        if (arg.includes('$<') || arg.includes('${')) {
          note(`An include directory that depends on a CMake variable or generator expression was skipped: ${arg}`);
          continue;
        }
        if (t && !t.includes.includes(arg)) t.includes.push(arg);
      }
      continue;
    }
    if (name === 'include_directories') {
      for (const arg of call.args) {
        if (CMAKE_SKIPPED_ARGS.has(arg.toLowerCase()) || arg.includes('${') || arg.includes('$<')) continue;
        if (!globalIncludes.includes(arg)) globalIncludes.push(arg);
      }
      continue;
    }
    if (name === 'add_subdirectory') {
      note(`add_subdirectory(${call.args[0] || '…'}) is not processed — sources in that sub-project are not compiled here.`);
      continue;
    }
    if (name === 'target_link_libraries') {
      note(`target_link_libraries(${call.args[0] || '…'}): ${call.args.slice(1).filter((a) => !CMAKE_SKIPPED_ARGS.has(a.toLowerCase())).join(', ') || 'dependencies'} are not linked — this runner resolves the project's own sources only.`);
      continue;
    }
    if (name === 'find_package' || name === 'fetchcontent' || name === 'pkg_check_modules') {
      note(`${call.name}(${call.args[0] || ''}) declares an external dependency that this runner does not download or resolve.`);
      continue;
    }
    if (name === 'file') {
      if (/^GLOB/i.test(call.args[1] || '')) note('file(GLOB …) source lists are not expanded — files matching the pattern may be missing from the build.');
    }
  }

  return { targets: targets.filter((t) => t.sources.length), globalIncludes, standard, limitations };
}

/** True when `child` is `parent` itself or lives inside it. */
function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The `CMakeLists.txt` folder that owns a file, walking up from it. */
export function cmakeDescriptorFor(sourceDir: string, stopAbove: string | null, index: CppFileIndex): { dir: string; text: string } | null {
  // Walking up from a folder that is not inside the project would search the
  // temp directory's ancestors (and could find some unrelated CMakeLists.txt),
  // so a foreign starting point looks at the project folder itself only.
  if (stopAbove && !isWithin(sourceDir, stopAbove)) {
    const at = path.join(stopAbove, 'CMakeLists.txt');
    return index.exists(at) ? { dir: stopAbove, text: index.readFile(at) } : null;
  }
  let dir = sourceDir;
  for (let up = 0; up < 10; up++) {
    const file = path.join(dir, 'CMakeLists.txt');
    if (index.exists(file) && index.isDirectory(dir)) return { dir, text: index.readFile(file) };
    if (stopAbove && keyOf(dir) === keyOf(stopAbove)) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Project root
// ---------------------------------------------------------------------------
/** Markers that make a folder *the* project root rather than a source folder. */
export const PROJECT_ROOT_MARKERS = ['CMakeLists.txt', 'Makefile', 'meson.build', '.git', 'compile_commands.json', '.clangd'];

/**
 * The folder a C++ program should be built and run from: the nearest ancestor
 * with a build descriptor, otherwise the nearest ancestor with the conventional
 * `include/` + `src/` layout (the C++ equivalent of "this is the project"),
 * otherwise the file's own folder. Never above `stopAbove` when the caller knows
 * which folder the user actually opened.
 */
export function findProjectRoot(sourceFile: string, stopAbove: string | null, index: CppFileIndex = realCppIndex): string {
  let dir = path.dirname(path.resolve(sourceFile));
  const stop = stopAbove ? keyOf(path.resolve(stopAbove)) : null;
  const first: string = dir;
  // Without a bound the walk is deliberately short: an unbounded search would
  // happily land on a repository or a `build/` folder three levels up and treat
  // the whole of it as this program's project.
  const maxUp = stop ? 8 : 3;
  for (let up = 0; up < maxUp; up++) {
    if (PROJECT_ROOT_MARKERS.some((m) => index.exists(path.join(dir, m)))) return dir;
    // `<root>/include` + `<root>/src` (or `<root>/sources`) is the layout the
    // community uses for hand-built projects; matching it lets `-I include`
    // work from the root the way the README of such a project documents it.
    if (index.isDirectory(path.join(dir, 'include')) && (index.isDirectory(path.join(dir, 'src')) || index.isDirectory(path.join(dir, 'sources')))) return dir;
    if (stop && keyOf(dir) === stop) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return first;
}

// ---------------------------------------------------------------------------
// Include-closure resolution (no build system involved)
// ---------------------------------------------------------------------------
export type ClosureResult = { sources: string[]; includeDirs: string[]; headers: string[] };

/**
 * Follow the project's own quoted includes from the entry file outward and take
 * each header's implementation file with it: `#include "Student.h"` resolves to
 * `src/Student.cpp` next to it (or anywhere else in the project with that exact
 * base name). Only what the entry actually references is compiled, which is what
 * keeps two unrelated `main()`s out of one link step.
 */
export function resolveIncludeClosure(
  entryFile: string,
  root: string,
  allFiles: string[],
  index: CppFileIndex = realCppIndex,
  maxFiles = 64,
): ClosureResult {
  const sources = new Set<string>([keyOf(entryFile)]);
  const outSources = [entryFile];
  const headers = new Set<string>();
  const includeDirs = new Set<string>([path.dirname(entryFile)]);
  const byBase = new Map<string, string[]>();
  for (const file of allFiles) {
    const base = path.basename(file).toLowerCase();
    byBase.set(base, [...(byBase.get(base) || []), file]);
  }
  const dirIndex = new Set(allFiles.map((f) => keyOf(path.dirname(f))));

  const queue: string[] = [entryFile];
  const seen = new Set<string>([keyOf(entryFile)]);
  while (queue.length && seen.size <= maxFiles) {
    const file = queue.shift() as string;
    if (!/\.(cpp|cc|cxx|h|hpp|hh|hxx|inl)$/i.test(file)) continue;
    for (const name of scanIncludes(index.readFile(file))) {
      // `<sys/header>` is the standard library / compiler's own include tree.
      const candidateDirs = [path.dirname(file), root, path.join(root, 'include'), ...[...includeDirs]];
      let resolved: string | null = null;
      for (const dir of candidateDirs) {
        const direct = path.join(dir, name);
        if (dirIndex.has(keyOf(dir)) && index.exists(direct)) {
          resolved = direct;
          break;
        }
      }
      if (!resolved) {
        const found = byBase.get(name.toLowerCase());
        if (found && found.length) resolved = found[0];
      }
      if (!resolved) continue; // a standard/unresolvable header: not our business
      if (hasExtension(resolved, CPP_HEADER_EXT)) {
        headers.add(path.dirname(resolved));
        includeDirs.add(path.dirname(resolved));
        if (!seen.has(keyOf(resolved))) {
          seen.add(keyOf(resolved));
          queue.push(resolved);
        }
        // …and its implementation, when the project ships one.
        for (const ext of CPP_SOURCE_EXT) {
          const impl = path.join(path.dirname(resolved), `${path.basename(resolved, path.extname(resolved))}${ext}`);
          const alternatives = (byBase.get(`${path.basename(resolved, path.extname(resolved))}${ext}`.toLowerCase()) || []).concat(index.exists(impl) ? [impl] : []);
          for (const candidate of alternatives) {
            if (!sources.has(keyOf(candidate))) {
              sources.add(keyOf(candidate));
              outSources.push(candidate);
              queue.push(candidate);
            }
          }
        }
      } else if (hasExtension(resolved, CPP_SOURCE_EXT) && !sources.has(keyOf(resolved))) {
        // A source including a source (rare, but real in tutorial code).
        sources.add(keyOf(resolved));
        outSources.push(resolved);
        queue.push(resolved);
      }
    }
  }

  const conventional = ['include', 'headers', 'inc', 'src']
    .map((d) => path.join(root, d))
    .filter((d) => index.isDirectory(d));
  for (const dir of conventional) includeDirs.add(dir);
  for (const dir of headers) includeDirs.add(dir);

  return {
    sources: outSources,
    includeDirs: [...includeDirs].filter((d, i, arr) => arr.findIndex((x) => keyOf(x) === keyOf(d)) === i),
    headers: [...headers],
  };
}

/**
 * A header is not runnable on its own, but the user may well press Run while it
 * is focused. Find the implementation unit that includes it, preferring the one
 * that carries `main`.
 */
export function entrySourceForHeader(headerFile: string, allFiles: string[], index: CppFileIndex = realCppIndex): string | null {
  const base = path.basename(headerFile).toLowerCase();
  const candidates = allFiles.filter((f) => hasExtension(f, CPP_SOURCE_EXT) && keyOf(f) !== keyOf(headerFile));
  const includers = candidates.filter((f) => scanIncludes(index.readFile(f)).some((inc) => path.basename(inc).toLowerCase() === base));
  const pool = includers.length ? includers : candidates;
  const withMain = pool.find((f) => hasMainFunction(index.readFile(f)));
  if (withMain) return withMain;
  // The header's own implementation file, when there is no `main` anywhere.
  const sibling = allFiles.find((f) => keyOf(f) === keyOf(path.join(path.dirname(headerFile), `${path.basename(headerFile, path.extname(headerFile))}.cpp`)));
  return sibling || null;
}

// ---------------------------------------------------------------------------
// Standard selection
// ---------------------------------------------------------------------------
/** Standards worth probing, newest first. */
export const CPP_STANDARDS = ['c++23', 'c++20', 'c++17', 'c++14', 'c++11'];

const stdSupportCache = new Map<string, boolean>();

/**
 * Does this compiler take `-std=<std>`? Asked, not assumed: the probe compiles
 * an empty translation unit (`-E -x c++ -` reads stdin to EOF and prints
 * linemarkers), which is the cheapest honest answer. A project that asks for
 * more than the installed compiler offers gets its highest supported standard
 * plus a visible note — never a silent downgrade.
 */
export async function compilerAcceptsStandard(compiler: CppCompiler, std: string): Promise<boolean> {
  const key = `${compiler.exe}|${std}`;
  if (stdSupportCache.has(key)) return stdSupportCache.get(key)!;
  const res = await probeRuntime(compiler.exe, [`-std=${std}`, '-E', '-x', 'c++', '-']);
  stdSupportCache.set(key, res.ok);
  return res.ok;
}

/** Forget cached standard support (a different compiler was installed, tests). */
export function invalidateStandardCache(): void {
  stdSupportCache.clear();
}

/** Highest standard the compiler accepts at or below `wanted`; null if none. */
export async function chooseStandard(
  compiler: CppCompiler,
  wanted: string | null,
  accepts: (compiler: CppCompiler, std: string) => Promise<boolean> = compilerAcceptsStandard,
): Promise<{ stdFlag: string | null; downgradedFrom: string | null }> {
  const order = wanted ? [wanted, ...CPP_STANDARDS.filter((s) => s !== wanted)] : CPP_STANDARDS;
  for (const std of order) {
    if (await accepts(compiler, std)) {
      return wanted && std !== wanted ? { stdFlag: `-std=${std}`, downgradedFrom: wanted } : { stdFlag: `-std=${std}`, downgradedFrom: null };
    }
  }
  return { stdFlag: null, downgradedFrom: wanted };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------
export type CppRunInput = {
  compiler: CppCompiler;
  /** Absolute path of the file the user pressed Run on (`.cpp` or a header). */
  entryFile: string;
  /** Project root; the build and the program both run here. */
  root: string;
  /** Scratch folder for the built executable (owned and deleted by the caller). */
  outDir: string;
  /** The entry's own directory when it is a throwaway copy outside the root. */
  entryOutsideRoot?: boolean;
  /**
   * Project files the entry *replaces* — an unsaved buffer standing in for its
   * own saved file. Without this, the copy on disk would be compiled next to the
   * buffer and the link would fail with a duplicate `main`.
   */
  replaces?: string[];
  index?: CppFileIndex;
  /** Injectable std probe, so unit tests never spawn a compiler. */
  accepts?: (compiler: CppCompiler, std: string) => Promise<boolean>;
};

function relativeToRoot(root: string, file: string): string {
  const rel = path.relative(root, file);
  // A file outside the root (a temp copy of an unsaved buffer) stays absolute.
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return file;
  return rel;
}

/**
 * Build the compiler + program steps. Every returned path in `args` that belongs
 * to the project is relative to `cwd` = `root`; the executable is absolute inside
 * `outDir`, which this app created.
 */
export async function planCppRun(input: CppRunInput): Promise<PlanResult> {
  const index = input.index || realCppIndex;
  const { compiler, root } = input;
  const entryExt = path.extname(input.entryFile).toLowerCase();

  let entryFile = input.entryFile;
  const allFiles = index.list(root);
  if (CPP_HEADER_EXT.includes(entryExt)) {
    const found = entrySourceForHeader(entryFile, allFiles, index);
    if (!found) {
      return {
        ok: false,
        code: 'CPP_NO_ENTRY_SOURCE',
        message: `${path.basename(entryFile)} is a header, which cannot be run on its own. Open one of the source files that includes it (or the file with main()) and press Run.`,
      };
    }
    entryFile = found;
  }
  if (!hasExtension(entryFile, CPP_SOURCE_EXT)) {
    return {
      ok: false,
      code: 'CPP_NOT_A_SOURCE',
      message: `"${path.basename(entryFile)}" is not a C++ source file (.cpp, .cc or .cxx).`,
    };
  }

  // 1) A CMake descriptor, if the project has one, is the most exact answer.
  const descriptor = cmakeDescriptorFor(path.dirname(entryFile), root, index);
  let strategy: CppBuildPlan['strategy'] = 'single-file';
  let sources: string[] = [entryFile];
  let includeDirs: string[] = [];
  let targetName: string | null = null;
  let wantedStd: string | null = null;
  const limitations: string[] = [];

  if (descriptor) {
    const { dir: descriptorDir, text } = descriptor;
    const cmake = parseCmakeLists(text);
    wantedStd = cmake.standard ? `c++${cmake.standard}` : null;
    limitations.push(...cmake.limitations);
    const normalize = (p: string) => path.resolve(descriptorDir, p.replace(/\//g, path.sep));
    const entryKey = keyOf(entryFile);
    const owning = cmake.targets.find((t) => t.sources.some((s) => keyOf(normalize(s)) === entryKey));
    // A target is only a home for a file it does not already list when that file
    // is a helper. A source with its own `main()` cannot be joined to a target
    // that already has an entry point — the link always fails on a second `main`.
    const entryHasMain = hasMainFunction(index.readFile(entryFile));
    const targetHasMain = (t: (typeof cmake.targets)[number]) =>
      t.sources.some((s) => hasMainFunction(index.readFile(normalize(s))));
    const chosen =
      owning ||
      (entryHasMain
        ? null
        : cmake.targets.find((t) => targetHasMain(t)) || cmake.targets[0] || null);
    if (chosen) {
      strategy = 'cmake-target';
      targetName = chosen.name;
      sources = [...new Set(chosen.sources.map(normalize))];
      if (!sources.some((s) => keyOf(s) === entryKey)) sources.unshift(entryFile);
      includeDirs = [...new Set([...chosen.includes, ...cmake.globalIncludes].map((i) => normalize(i)))];
    } else {
      // Keep what the descriptor says about flags and search paths even when the
      // program being run is not one of its targets.
      includeDirs = [...new Set(cmake.globalIncludes.map((i) => normalize(i)))];
      limitations.push(
        entryHasMain && !owning
          ? `${path.basename(entryFile)} is not listed in CMakeLists.txt and defines its own main(), so it was built on its own; adding it to a target that already has an entry point would fail to link.`
          : 'CMakeLists.txt has no add_executable() this runner could match, so the project’s own includes were followed instead.',
      );
    }
  }

  // 2) No (usable) descriptor: follow the project's include edges.
  if (strategy === 'single-file') {
    const closure = resolveIncludeClosure(entryFile, root, allFiles, index);
    if (closure.sources.length > 1) {
      strategy = 'include-closure';
      sources = closure.sources;
      includeDirs = closure.includeDirs;
    } else {
      // 3) One folder of sources with a single main() is the classic homework /
      //    tutorial layout; compile that folder rather than one file.
      const dir = path.dirname(entryFile);
      const siblings = allFiles.filter((f) => path.dirname(f) === dir && hasExtension(f, CPP_SOURCE_EXT));
      const entryHasMain = hasMainFunction(index.readFile(entryFile));
      const usable = entryHasMain ? siblings.filter((f) => !hasMainFunction(index.readFile(f)) || keyOf(f) === keyOf(entryFile)) : siblings;
      if (usable.length > 1) {
        strategy = 'folder-sources';
        sources = usable;
        includeDirs = closure.includeDirs;
      } else {
        sources = [entryFile];
        includeDirs = closure.includeDirs;
      }
    }
  }

  // `-I` for the conventional folders of the root even without CMake, so
  // `#include "Student.h"` resolves in the layout such projects use.
  for (const candidate of ['include', 'inc', 'headers']) {
    const dir = path.join(root, candidate);
    if (index.isDirectory(dir) && !includeDirs.some((d) => keyOf(d) === keyOf(dir))) includeDirs.push(dir);
  }

  const { stdFlag, downgradedFrom } = await chooseStandard(
    compiler,
    wantedStd || (compiler.family === 'gcc' || compiler.family === 'clang' ? 'c++17' : null),
    input.accepts,
  );

  const exeName = `${(targetName || path.basename(entryFile)).replace(/\.(cpp|cc|cxx|h|hpp|hh|hxx)$/i, '')}${IS_WIN ? '.exe' : ''}`;
  const exePath = path.join(input.outDir, exeName);

  // The file the buffer stands for never joins the command line: the buffer is it.
  const replaced = new Set((input.replaces || []).map((p) => keyOf(p)));
  sources = sources.filter((s) => !replaced.has(keyOf(s)) || keyOf(s) === keyOf(entryFile));
  if (!sources.length) sources = [entryFile];

  const compileArgs: string[] = [];
  if (stdFlag) compileArgs.push(stdFlag);
  compileArgs.push('-Wall');
  for (const dir of includeDirs) compileArgs.push('-I', relativeToRoot(root, dir));
  // An unsaved buffer is compiled from its throwaway folder, so its own
  // neighbours on disk have to be searchable too.
  if (input.entryOutsideRoot && path.isAbsolute(entryFile)) compileArgs.push('-I', path.dirname(entryFile));
  for (const source of sources) compileArgs.push(relativeToRoot(root, source));
  compileArgs.push('-o', exePath);

  const steps: CppStep[] = [
    {
      cmd: compiler.cmd,
      file: compiler.exe,
      args: compileArgs,
      cwd: root,
      stdin: false,
      label: 'compile',
      // The compiler drives `cc1plus`/`as`/`ld` next door; putting its folder
      // first costs nothing and covers the toolchains that resolve them on PATH.
      env: { PATH: `${compiler.binDir}${path.delimiter}${mergedPathEnv()}` },
    },
    {
      // The program runs from the project root, so data files next to the
      // sources behave the way they do for a terminal build of the same project.
      cmd: exeName,
      file: exePath,
      args: [],
      cwd: root,
      stdin: true,
      label: 'link+run',
      // A MinGW/LLVM-built executable needs its compiler runtime DLLs, which
      // live next to the compiler — without this the program compiles fine and
      // then fails to start with "library not loaded".
      env: { PATH: `${compiler.binDir}${path.delimiter}${mergedPathEnv()}` },
    },
  ];

  const notes: string[] = [
    `C++ · ${compiler.cmd} ${compiler.version || 'version unknown'} (${compiler.source}) · ${strategy}${targetName ? ` · target ${targetName}` : ''} · ${sources.length} source${sources.length === 1 ? '' : 's'}${stdFlag ? ` · ${stdFlag}` : ''}`,
    `Project root: ${root}`,
  ];
  const missing = sources.filter((s) => !index.exists(s));
  if (missing.length) {
    notes.push(`Listed in the project but not on disk: ${missing.map((m) => path.basename(m)).join(', ')} — the compile will report which one it could not open.`);
  }
  if (downgradedFrom) {
    notes.push(`This project asks for -std=${downgradedFrom.replace('-std=', '')} but ${compiler.cmd} does not accept it; built with ${stdFlag || 'the compiler default'} instead.`);
  }
  if (strategy === 'cmake-target') {
    notes.push('Built from the project’s CMakeLists.txt descriptor (the compiler was invoked directly; the cmake tool was not run).');
  }
  for (const limitation of limitations) notes.push(`CMakeLists.txt: ${limitation}`);
  if (strategy === 'include-closure') {
    notes.push(`Compiled the sources this program includes: ${sources.map((s) => path.basename(s)).join(', ')}`);
  }
  const otherTargets = descriptor && strategy === 'cmake-target'
    ? parseCmakeLists(descriptor.text).targets.filter((t) => t.name !== targetName)
    : [];
  if (otherTargets.length) {
    notes.push(`This project also defines ${otherTargets.map((t) => t.name).join(', ')} — open one of its source files and press Run to build that program instead.`);
  }

  return {
    ok: true,
    plan: { strategy, root, targetName, stdFlag, requestedStd: wantedStd, includes: includeDirs, sources, exePath, steps, notes },
  };
}

/**
 * C++ does not care what the file is called (unlike Java's public class rule),
 * so an unsaved buffer keeps the plan's `main.cpp` name — which is also what
 * makes the compiler treat it as a C++ translation unit rather than by suffix.
 */
export const CPP_BUFFER_FILE_NAME = 'main.cpp';
