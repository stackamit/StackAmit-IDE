/**
 * Local program runner (Electron main process).
 *
 * This is the desktop app's *own* execution path: it spawns the installed
 * runtime as a child process and streams its real stdout/stderr/exit code back
 * to the window. It deliberately does not go through the API server, so
 * "Run" keeps working with the network unplugged, and it does not go through a
 * shell either — arguments are a fixed argv array built from the allow-listed
 * plan below, which is why paths with spaces and non-ASCII characters work
 * without quoting tricks.
 *
 * No `electron` import here: the module is pure Node (main-process code that
 * stays unit-testable under vitest). The IPC layer passes in the temp root and
 * validates every path against the authorized workspace roots.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  detectLocalRuntimes,
  discoverCpp,
  discoverTypeScript,
  executableName,
  findJdk,
  LOCAL_RUNTIMES,
  mergedPathEnv,
  type CppCompiler,
  type DetectedRuntime,
  type JdkInfo,
  type TypeScriptCompiler,
} from './runtimeProbe.js';
import { javaBufferFileName, planJavaRun } from './javaRun.js';
import { findProjectRoot, planCppRun, realCppIndex } from './cppRun.js';

/**
 * One spawn: an executable plus an argv array. `file` is the absolute path to
 * run (a plan that knows its toolchain sets it); otherwise the discovered
 * runtime is used. Only the program itself gets a stdin — a build step does not.
 */
export type SpawnStep = {
  cmd: string;
  args: string[];
  file?: string;
  cwd?: string;
  stdin?: boolean;
  label?: string;
  /**
   * Additions to the allow-listed child environment. A C++ plan uses this to put
   * the compiler's own folder first on PATH, because the program it just built
   * imports the runtime DLLs that live there.
   */
  env?: Record<string, string>;
};

export type RunPlan = {
  /** File an unsaved buffer is written to (and run under) inside the temp dir. */
  sourceName: string;
  /**
   * Override for the buffer's file name when the language cares about it
   * (Java: `public class Widget` will not compile inside `Main.java`).
   */
  sourceNameFor?: (source: string) => string;
  /**
   * Build the argv for one run. `target` is the file name the runtime is told
   * to execute: the selected file's own basename when a saved file is run in
   * place, otherwise the buffer copy's name for a throwaway run. It is always a
   * bare file name (never a path) because `cwd` is set to the containing
   * folder, which keeps the argv free of any shell-quoting concerns.
   */
  run?: (rt: DetectedRuntime, target: string) => SpawnStep;
  /**
   * Languages that need more than one spawn (Java: compile, then run) decide
   * their steps, scratch directories and status lines here. A structured
   * failure is returned to the user verbatim — never a silent fallback.
   */
  prepare?: (ctx: PrepareContext) => Promise<PreparedRun> | PreparedRun;
  /**
   * Wall-clock budget for the whole run. A compiled language needs a longer one
   * than an interpreter: a first build of a real project is minutes, not seconds.
   */
  timeoutMs?: number;
  /**
   * When false, the run does not require the language to have been marked
   * *available* by the global runtime probe before `prepare` is reached. The
   * TypeScript plan sets this: a project's own `node_modules/typescript` is the
   * authoritative compiler and is located inside `prepare` (per-workspace), so a
   * machine with no global `tsc` must still be able to build a project that
   * carries one. Interpreted languages leave this undefined (probe required).
   */
  needsRuntimeProbe?: boolean;
};

export type PrepareContext = {
  rt: DetectedRuntime;
  /** Bare file name being executed; its folder is `cwd`. */
  target: string;
  cwd: string;
  /** Absolute path of that file. */
  sourceFile: string;
  /**
   * Resolved Java dependency JARs (absolute paths) for this run, placed on both
   * the compile and runtime classpath. Empty/undefined means the program has no
   * external dependencies — the pre-existing dependency-free behavior.
   */
  classpath?: string[];
  /** Temp dir created for a buffer run (null when the user's own file runs). */
  tempDir: string | null;
  tempRoot: string;
  usingSavedFile: boolean;
  /** User-configured JDK folder, when one was supplied for this run. */
  jdkPath: string | null;
  /** User-configured compiler path (folder or executable), for C++ runs. */
  compilerPath: string | null;
  /**
   * Absolute path of the file this run *stands for* — the document's own saved
   * location, even when the buffer has unsaved changes and the code being run is
   * a throwaway copy. That is what lets an edited-but-unsaved `main.cpp` still
   * build against the project's other sources instead of alone.
   */
  projectPath: string | null;
  /** The folder the user opened, which bounds how far a project root may be. */
  workspaceRoot: string | null;
  /**
   * The C++ compiler finder this run must use — the real
   * `runtimeProbe.discoverCpp` unless a caller injected another one, so the
   * "no compiler anywhere" branch is reachable in tests on a machine that does
   * have MinGW installed.
   */
  discoverCpp: DiscoverCpp;
  /**
   * The JDK finder this run must use. It is the real `runtimeProbe.findJdk`
   * unless a caller injected another one, so the "no JDK anywhere" branch is
   * reachable in tests on a machine that does have Java installed.
   */
  findJdk: FindJdk;
  /**
   * The TypeScript compiler finder this run must use — the real
   * `runtimeProbe.discoverTypeScript` unless a caller injected another one. It
   * is asked with this run's own `entryDir`/`workspaceRoot`, which is how a
   * project-local `node_modules/typescript` is found even when no global `tsc`
   * exists (the reason this plan sets `needsRuntimeProbe: false`).
   */
  discoverTypeScript: DiscoverTypeScript;
};

export type PreparedRun =
  | { steps: SpawnStep[]; scratch?: string[]; notes?: string[] }
  | { ok: false; code: string; message: string };

/** What `runtimeProbe.discoverCpp` looks like to a plan. */
export type DiscoverCpp = (opts: { customPath?: string | null; force?: boolean }) => Promise<{ compiler: CppCompiler | null; rejected: { exe: string; reason: string }[] }>;

/** What `runtimeProbe.discoverTypeScript` looks like to a plan. */
export type DiscoverTypeScript = (opts: { customPath?: string | null; entryDir?: string | null; workspaceRoot?: string | null; force?: boolean }) => Promise<{ compiler: TypeScriptCompiler | null; rejected: { where: string; reason: string }[] }>;

/**
 * One entry per locally supported runtime, mirroring LOCAL_RUNTIMES. Interpreted
 * languages are the easy case — a runtime on PATH is the whole toolchain.
 * Compiled ones have to earn their place: Java is here because the JDK is
 * *discovered and validated* (`runtimeProbe.findJdk` / `javaRun.planJavaRun`)
 * and C++ because a compiler is *located, run and read* (`discoverCpp` /
 * `cppRun.planCppRun`) before anything is spawned. Where nothing is found the
 * run says so, and the language still has the online provider and the terminal.
 */
export const LOCAL_PLANS: Record<string, RunPlan> = {
  python: {
    sourceName: 'main.py',
    run: (rt, target) => ({ cmd: rt.cmd || 'python', args: ['-u', target] }),
  },
  javascript: {
    sourceName: 'main.js',
    run: (rt, target) => ({ cmd: rt.cmd || 'node', args: [target] }),
  },
  powershell: {
    sourceName: 'main.ps1',
    // The generated script is unsigned, so the default Windows execution policy
    // (Restricted / AllSigned) refuses it. `-ExecutionPolicy Bypass` relaxes the
    // policy for this child process only — nothing is written to the registry
    // and no machine-level setting changes.
    run: (rt, target) => ({
      cmd: rt.cmd || 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', target],
    }),
  },
  java: {
    sourceName: 'Main.java',
    sourceNameFor: javaBufferFileName,
    async prepare(ctx): Promise<PreparedRun> {
      // The discovered runtime carries the validated JDK; a caller that
      // injected its own detection without one gets the same finder the probe
      // uses, never a blind trust in whichever `java` is first on PATH.
      const jdk = ctx.rt.jdk ?? (await ctx.findJdk({ customPath: ctx.jdkPath }));
      if (!jdk) {
        return {
          ok: false,
          code: 'JDK_MISSING',
          message: `No Java development kit (JDK) was found. ${LOCAL_RUNTIMES.java.installHint} Setting JAVA_HOME or a custom JDK path also works.`,
        };
      }
      // Compiled output goes to a folder this run owns and deletes; the user's
      // project folder is never written to.
      const scratch = await fsp.mkdtemp(path.join(ctx.tempRoot, 'stackamit-java-')).catch(() => null);
      if (!scratch) {
        return { ok: false, code: 'TMP_UNAVAILABLE', message: 'Could not create a temporary folder for the compiled classes.' };
      }
      const res = planJavaRun({
        jdk,
        sourceFile: ctx.sourceFile,
        cwd: ctx.cwd,
        outDir: path.join(scratch, 'classes'),
        buildDescriptor: hasJavaBuildDescriptor(ctx),
        classpath: ctx.classpath,
      });
      if (!res.ok) {
        await fsp.rm(scratch, { recursive: true, force: true }).catch(() => {});
        return res;
      }
      return { steps: res.plan.steps, scratch: [scratch], notes: res.plan.notes };
    },
  },
  cpp: {
    sourceName: 'main.cpp',
    // A first build of a real project is minutes on a cold disk cache; the
    // interpreter budget below would kill a legitimate compile mid-way.
    timeoutMs: 180000,
    async prepare(ctx): Promise<PreparedRun> {
      // The detected runtime carries the compiler the probe verified; a caller
      // that injected its own detection without one gets the same finder, never
      // a blind trust in whichever `g++` resolves first.
      const compiler =
        ctx.rt.compiler ?? (await ctx.discoverCpp({ customPath: ctx.compilerPath, force: false })).compiler;
      if (!compiler) {
        return {
          ok: false,
          code: 'CPP_COMPILER_MISSING',
          message: `No usable C++ compiler was found. ${LOCAL_RUNTIMES.cpp.installHint}`.trim(),
        };
      }
      // The executable is written to a folder this run owns and deletes; the
      // user's project is never polluted with build output.
      const scratch = await fsp.mkdtemp(path.join(ctx.tempRoot, 'stackamit-cpp-')).catch(() => null);
      if (!scratch) {
        return { ok: false, code: 'TMP_UNAVAILABLE', message: 'Could not create a temporary folder for the built program.' };
      }
      // Build and run from the *project*, not from the file's own folder: a
      // `src/main.cpp` that includes `include/Student.h` is described that way
      // by every build system in the project, and a program reading a data file
      // next to it expects the same working directory a terminal build uses.
      const anchor = ctx.projectPath && fs.existsSync(ctx.projectPath) ? ctx.projectPath : ctx.sourceFile;
      const root = findProjectRoot(anchor, ctx.workspaceRoot, realCppIndex);
      const res = await planCppRun({
        compiler,
        entryFile: ctx.sourceFile,
        root,
        outDir: scratch,
        // An unsaved buffer runs as a throwaway copy: it stands for its own
        // saved file, so that file must not be compiled a second time next to it.
        entryOutsideRoot: !ctx.usingSavedFile && root !== ctx.cwd,
        replaces: ctx.usingSavedFile ? [] : anchor === ctx.sourceFile ? [] : [anchor],
      });
      if (!res.ok) {
        await fsp.rm(scratch, { recursive: true, force: true }).catch(() => {});
        return res;
      }
      return { steps: res.plan.steps, scratch: [scratch], notes: res.plan.notes };
    },
  },
  typescript: {
    sourceName: 'main.ts',
    // A real project's first `tsc` pass type-checks every included file; give it
    // the same generous budget a C++ build gets, not the interpreter default.
    timeoutMs: 120000,
    // A project that ships its own `node_modules/typescript` can build even when
    // no global `tsc` was detected, so `prepare` is allowed to run without the
    // probe having marked TypeScript available (it locates the compiler inside
    // the workspace and reports honestly if it cannot).
    needsRuntimeProbe: false,
    async prepare(ctx): Promise<PreparedRun> {
      const sourceFile = ctx.sourceFile;
      const ext = path.extname(sourceFile).toLowerCase();
      // `.tsx` is a React/JSX module: it has no standalone Node entry point and
      // needs the project's bundler/dev-server, which the IDE exposes through
      // the browser preview — not this runner. Say so instead of half-building.
      if (ext === '.tsx') {
        return {
          ok: false,
          code: 'TSX_UNSUPPORTED_LOCAL',
          message: `A .tsx file is a React/JSX module, which cannot be run as a standalone Node program. Build or preview the project (its dev server / npm run build) and open it in the browser preview instead.`,
        };
      }
      if (ext !== '.ts') {
        return { ok: false, code: 'TS_NOT_A_SOURCE', message: `"${path.basename(sourceFile)}" is not a TypeScript source file (.ts).` };
      }
      const entryDir = path.dirname(sourceFile);
      const workspaceRoot = ctx.workspaceRoot ? path.resolve(ctx.workspaceRoot) : null;
      // Ask the finder with *this run's* project so a `node_modules/typescript`
      // inside the workspace wins over a (possibly absent) global install.
      const discovery = await ctx.discoverTypeScript({
        customPath: ctx.compilerPath,
        entryDir,
        workspaceRoot,
      });
      const compiler = discovery.compiler;
      if (!compiler) {
        return {
          ok: false,
          code: 'TS_COMPILER_MISSING',
          message: `No usable TypeScript compiler was found for this project. ${LOCAL_RUNTIMES.typescript.installHint}`.trim(),
        };
      }
      // The compiled JavaScript lands in a folder this run owns and deletes; the
      // user's project is never polluted with build output (same rule as Java/C++).
      const scratch = await fsp.mkdtemp(path.join(ctx.tempRoot, 'stackamit-ts-')).catch(() => null);
      if (!scratch) {
        return { ok: false, code: 'TMP_UNAVAILABLE', message: 'Could not create a temporary folder for the compiled JavaScript.' };
      }

      const configPath = findTsConfig(entryDir, workspaceRoot);
      const notes: string[] = [`TypeScript · tsc ${compiler.version || 'version unknown'} (${compiler.source})`];

      // `--noEmitOnError` is what makes a failed type-check a *real* failure:
      // tsc exits non-zero and emits nothing, so the run step never executes a
      // stale or half-built file and the Output panel shows the diagnostics.
      const compileArgs: string[] = [];
      let rootDir: string;
      let compileCwd: string;
      // Whether tsc will emit ES modules. Decided from the project's own
      // configuration; the no-config fallback below compiles as CommonJS.
      let emitEsm = false;
      if (configPath) {
        const configDir = path.dirname(configPath);
        compileCwd = configDir;
        rootDir = configDir;
        // `tsc -p <dir>` already applies EVERY compilerOption in the project's
        // tsconfig.json — module, moduleResolution, target, paths and the rest.
        // Forcing `--module CommonJS` on top silently overrode a NodeNext/ESM
        // project: `import.meta` became illegal (TS1343) and `module` stopped
        // matching `moduleResolution: NodeNext` (TS5110). So the project config
        // is left as the source of truth and only the output location is forced,
        // which keeps build artifacts out of the user's own folder.
        compileArgs.push('-p', configDir, '--outDir', scratch, '--rootDir', configDir, '--noEmitOnError');
        notes.push(`Compiled with the project's ${path.basename(configPath)}.`);
        emitEsm = emittedModuleIsEsm(configPath, entryDir, workspaceRoot);
      } else {
        compileCwd = entryDir;
        rootDir = entryDir;
        // A lone file with no project has no module system to honour, so it keeps
        // the same Node-compatible CommonJS defaults as before.
        compileArgs.push(
          sourceFile,
          '--outDir', scratch,
          '--rootDir', rootDir,
          '--module', 'CommonJS',
          '--target', 'ES2020',
          '--esModuleInterop',
          '--skipLibCheck',
          '--resolveJsonModule',
          '--noEmitOnError',
        );
        notes.push('No tsconfig.json was found, so the file was compiled with Node-compatible defaults (CommonJS, ES2020).');
      }

      // Map the entry to its emitted `.js`: outDir / relative(file, rootDir).
      const outJs = path.join(scratch, path.relative(rootDir, sourceFile).replace(/\.ts$/i, '.js'));

      // ES-module output must be run as ESM: Node decides a `.js` file's kind
      // from the nearest package.json, and the emitted file lives in the scratch
      // folder (outside the project), so mirror the format there with a throwaway
      // `package.json`. This writes ONLY inside the temp output folder — the
      // user's package.json and tsconfig.json are never modified. CommonJS output
      // needs nothing (Node's default), so that path stays byte-identical.
      if (emitEsm) {
        await fsp.writeFile(path.join(scratch, 'package.json'), '{ "type": "module" }\n', 'utf8');
        notes.push('Emitted ES modules; running the output with Node\'s ESM loader.');
      }

      // The compiled JavaScript and its dependency lookups both have to work
      // from the scratch folder, which lives outside the project:
      //  - CommonJS `require` of an installed package resolves through NODE_PATH.
      //  - The ES-module loader ignores NODE_PATH and walks `node_modules` up
      //    from the importing file, so a bare `import` (e.g. `mathjs`) would
      //    otherwise fail with ERR_MODULE_NOT_FOUND in the scratch folder.
      // Exposing the project's packages folder *inside* the scratch dir (a
      // throwaway entry this run owns and deletes — never a change to the user's
      // project) makes both formats resolve. NODE_PATH stays as the CommonJS
      // fallback for filesystems where the link cannot be created.
      const nodeModules = findNodeModules(entryDir, workspaceRoot);
      const runEnv: Record<string, string> | undefined = nodeModules ? { NODE_PATH: nodeModules } : undefined;
      if (nodeModules) {
        if (!linkNodeModulesInto(scratch, nodeModules)) {
          notes.push('Installed packages are being resolved through NODE_PATH for this run; if an ES-module import reports a missing package, the project’s packages folder could not be linked into the build output.');
        }
      } else if (projectHasDeclaredDependencies(entryDir, workspaceRoot)) {
        notes.push('This project declares npm dependencies but no installed packages (node_modules) were found next to it, so an import of a third-party package will not resolve. Run `npm install` in the project folder first.');
      }

      const steps: SpawnStep[] = [
        {
          cmd: 'node',
          file: compiler.nodeExe,
          args: [compiler.tscJs, ...compileArgs],
          cwd: compileCwd,
          stdin: false,
          label: 'compile',
        },
        {
          cmd: 'node',
          file: compiler.nodeExe,
          args: [outJs],
          cwd: compileCwd,
          stdin: true,
          label: 'run',
          env: runEnv,
        },
      ];
      return { steps, scratch: [scratch], notes };
    },
  },
};

/**
 * Walk up from `startDir` (bounded by `stopDir`) for a `tsconfig.json`. Returns
 * its absolute path, or null. The first one met wins, matching how `tsc -p`
 * resolves a project directory.
 */
function findTsConfig(startDir: string, stopDir: string | null): string | null {
  let dir = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : null;
  for (let up = 0; up < 24; up++) {
    const candidate = path.join(dir, 'tsconfig.json');
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* not here */
    }
    if (stop && dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * The nearest `node_modules` at or above `startDir` (bounded by `stopDir`), or
 * null. Handed to the run step as NODE_PATH so a compiled program that
 * `require`s an installed dependency still finds it from the scratch folder.
 */
function findNodeModules(startDir: string, stopDir: string | null): string | null {
  let dir = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : null;
  for (let up = 0; up < 24; up++) {
    const candidate = path.join(dir, 'node_modules');
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* not here */
    }
    if (stop && dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Make a project's installed packages resolvable from a compiled-output folder
 * that lives outside the project. Creates a `node_modules` link *inside* the
 * given (run-owned, self-deleting) output folder pointing at the discovered
 * packages folder, so both CommonJS `require` and the ES-module loader find bare
 * specifiers. A directory junction is used on Windows (it needs no elevated
 * token); a symlink elsewhere. Returns false when no link could be made (the
 * caller still has NODE_PATH for CommonJS) and never throws or touches the
 * project itself. Deleting the output folder later removes the link, not its
 * target (`fs.rm` does not traverse a symlink), which is verified by a test.
 */
export function linkNodeModulesInto(outDir: string, packagesDir: string): boolean {
  const link = path.join(outDir, 'node_modules');
  try {
    // A real `node_modules` or link already there resolves on its own.
    if (fs.existsSync(link)) return true;
    fs.symlinkSync(packagesDir, link, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch {
    return false;
  }
}

/**
 * True when a `package.json` at or above `startDir` (bounded by `stopDir`)
 * declares at least one dependency or devDependency. Used to turn a silent
 * unresolved-import failure into an actionable “run npm install first” note.
 */
function projectHasDeclaredDependencies(startDir: string, stopDir: string | null): boolean {
  let dir = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : null;
  for (let up = 0; up < 24; up++) {
    const candidate = path.join(dir, 'package.json');
    try {
      if (fs.statSync(candidate).isFile()) {
        const pkg = parseJsonc(fs.readFileSync(candidate, 'utf8'));
        if (pkg && typeof pkg === 'object') {
          const deps = pkg.dependencies;
          const dev = pkg.devDependencies;
          const nonEmpty = (o: any) => o && typeof o === 'object' && Object.keys(o).length > 0;
          if (nonEmpty(deps) || nonEmpty(dev)) return true;
        }
      }
    } catch {
      /* not here */
    }
    if (stop && dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/**
 * Recognise the TypeScript module-format conflict that stops a perfectly valid
 * ESM-style program from compiling, and turn it into an actionable next step.
 *
 * The two codes are `tsc`'s own, emitted when the project's settings disagree
 * about module format — most often a `package.json` `"type": "commonjs"` (so
 * `.ts` files are CommonJS) combined with `"verbatimModuleSyntax": true` while
 * the source uses ES `import`/`export` syntax (TS1295), or importing an
 * ES-module-only dependency from a CommonJS file (TS1479). The IDE must not
 * override the project's compiler or edit its files, so instead it explains the
 * conflict and lists the fixes the user can make. Returns null for any other
 * output so unrelated compile errors are shown exactly as `tsc` wrote them.
 */
export function typescriptModuleFormatHint(compileOutput: string): string | null {
  if (!compileOutput) return null;
  // The same "project settings disagree about module format" conflict is
  // reported under different codes across TypeScript versions, so match the
  // whole family rather than one number:
  //   TS1295 / TS1286 / TS1287 — ES import/export syntax in a CommonJS file
  //     while `verbatimModuleSyntax` forbids rewriting it (TS1286/TS1287 are
  //     the older split of what newer tsc folds into TS1295).
  //   TS1479 — a CommonJS file importing an ES-module-only dependency.
  const verbatimConflict = /\bTS(?:1295|1286|1287)\b/.test(compileOutput);
  const esmDepConflict = /\bTS1479\b/.test(compileOutput);
  if (!verbatimConflict && !esmDepConflict) return null;
  const why = verbatimConflict
    ? 'your code uses ES-module import/export syntax, but the project treats these files as CommonJS\n  while "verbatimModuleSyntax" forbids rewriting that syntax.'
    : 'a CommonJS file is importing a dependency that only ships as an ES module, which cannot be\n  loaded with require().';
  return (
    `This is a project configuration conflict, not an IDE error: tsc refused to build because ${why}\n`
    + `The IDE keeps your project settings as the source of truth and will not override them. To fix it,\n`
    + `make one consistent choice in your own files — for example:\n`
    + `  * set "type": "module" in package.json (recommended when the code uses import/export), or\n`
    + `  * turn off "verbatimModuleSyntax" in tsconfig.json so tsc can rewrite the imports to CommonJS, or\n`
    + `  * rename the entry file to .mts so it is treated as an ES module.\n`
    + `Then run again.`
  );
}

/**
 * Decide whether `tsc -p <configPath>` will emit ES modules, so the run step can
 * hand Node a matching package.json. Reads the project's own configuration as
 * the source of truth: the effective `module`/`target` (following `extends`) and
 * the nearest `package.json` type (what NodeNext/Node16 key off for `.ts`).
 */
function emittedModuleIsEsm(configPath: string, entryDir: string, workspaceRoot: string | null): boolean {
  const opts = readEffectiveCompilerOptions(configPath);
  const pkgType = readNearestPackageType(entryDir, workspaceRoot);
  return moduleKindIsEsm(opts.module, opts.target, pkgType);
}

/**
 * Pure mapping from a project's module/target/package-type to the format tsc
 * emits for a `.ts` file. Exported for direct unit testing.
 *  - CommonJS/AMD/UMD/System → CommonJS.
 *  - Node16/NodeNext → per-file: ESM only when the nearest package.json is
 *    `"type": "module"` (mirrors how Node and tsc classify a `.ts`).
 *  - Any explicit ES target (ES2015/ES2020/ESNext/preserve…) → ESM.
 *  - No `module` set → mirror tsc's own default (CommonJS for ES3/ES5, else ESM).
 */
export function moduleKindIsEsm(
  moduleOpt: string | undefined,
  targetOpt: string | undefined,
  packageType: string | null,
): boolean {
  const norm = (s?: string) => (s || '').toLowerCase().replace(/[_\s-]+/g, '');
  const m = norm(moduleOpt);
  if (m) {
    if (m === 'commonjs' || m === 'amd' || m === 'umd' || m === 'system') return false;
    if (m === 'node16' || m === 'nodenext') return packageType === 'module';
    return true; // es2015/es2020/esnext/preserve/…
  }
  const t = norm(targetOpt);
  if (!t || t === 'es3' || t === 'es5') return false;
  return true;
}

/**
 * Strip // and /* *\/ comments and trailing commas from a tsconfig-style file,
 * respecting string literals, so a plain JSON.parse never trips on the comments
 * real tsconfigs carry. Returns null when the text is not parseable at all.
 */
function parseJsonc(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    /* retry with comments/trailing commas removed */
  }
  let out = '';
  let inStr = false;
  let quote = '';
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += c2 ?? '';
        i++;
        continue;
      }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < n && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // land on the '/' of '*/'; the for-loop advances past it
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (j < n && (text[j] === '}' || text[j] === ']')) continue; // drop trailing comma
      out += c;
      continue;
    }
    out += c;
  }
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

/** Resolve a tsconfig `extends` specifier (relative path or node_modules pkg). */
function resolveExtends(spec: string, fromDir: string): string | null {
  if (!spec) return null;
  const candidates: string[] = [];
  if (spec.startsWith('.') || path.isAbsolute(spec)) {
    const base = path.resolve(fromDir, spec);
    candidates.push(base);
    if (!base.toLowerCase().endsWith('.json')) candidates.push(base + '.json');
  } else {
    const nm = findNodeModules(fromDir, null);
    if (nm) {
      const p = path.join(nm, spec);
      candidates.push(p);
      if (!p.toLowerCase().endsWith('.json')) candidates.push(p + '.json');
      candidates.push(path.join(p, 'tsconfig.json'));
    }
  }
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * The effective `module`/`target` for a tsconfig, following `extends` (bounded)
 * and letting the child override the parent — the same precedence tsc applies.
 */
function readEffectiveCompilerOptions(configPath: string, depth = 0): { module?: string; target?: string } {
  if (depth > 6) return {};
  let cfg: any;
  try {
    cfg = parseJsonc(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
  if (!cfg || typeof cfg !== 'object') return {};
  const ext = cfg.extends;
  const extList: string[] = typeof ext === 'string' ? [ext] : Array.isArray(ext) ? ext.filter((x) => typeof x === 'string') : [];
  let merged: { module?: string; target?: string } = {};
  for (const e of extList) {
    const pp = resolveExtends(e, path.dirname(configPath));
    if (pp) merged = { ...merged, ...readEffectiveCompilerOptions(pp, depth + 1) };
  }
  const own = cfg.compilerOptions && typeof cfg.compilerOptions === 'object' ? cfg.compilerOptions : {};
  const ownSel: { module?: string; target?: string } = {};
  if (typeof own.module === 'string') ownSel.module = own.module;
  if (typeof own.target === 'string') ownSel.target = own.target;
  return { ...merged, ...ownSel };
}

/**
 * The `type` field of the nearest `package.json` at or above `startDir` (bounded
 * by `stopDir` when given), or null. NodeNext/Node16 classify a `.ts` file by
 * exactly this, so the run needs the same answer to pick the output format.
 */
function readNearestPackageType(startDir: string, stopDir: string | null): string | null {
  let dir = path.resolve(startDir);
  const stop = stopDir ? path.resolve(stopDir) : null;
  for (let up = 0; up < 24; up++) {
    const candidate = path.join(dir, 'package.json');
    try {
      if (fs.statSync(candidate).isFile()) {
        const pkg = parseJsonc(fs.readFileSync(candidate, 'utf8'));
        return pkg && typeof pkg === 'object' && typeof pkg.type === 'string' ? pkg.type : null;
      }
    } catch {
      /* not here */
    }
    if (stop && dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * True when a Maven/Gradle descriptor sits at or above the file being run, so
 * the run can warn that declared dependencies are not on the classpath. Reads
 * the same marker names the language-server side uses.
 */
function hasJavaBuildDescriptor(ctx: PrepareContext): boolean {
  const markers = ['pom.xml', 'build.gradle', 'build.gradle.kts'];
  let dir = ctx.cwd;
  for (let up = 0; up < 12; up++) {
    if (markers.some((m) => fs.existsSync(path.join(dir, m)))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

/** Wall-clock budget for one local run; the child is killed when it expires. */
export const DEFAULT_TIMEOUT_MS = 60000;
/** Streamed output cap per run — a runaway loop cannot exhaust the renderer. */
export const MAX_OUTPUT_CHARS = 200000;
/** Hard ceiling on simultaneous local runs from one window. */
export const MAX_SESSIONS = 4;

export type RunEvent =
  | { type: 'stdout' | 'stderr' | 'info' | 'error'; data: string }
  | { type: 'exit'; code: number | null; timedOut?: boolean; stopped?: boolean };

export type RunSink = (event: RunEvent) => void;

type Session = {
  id: string;
  child: ChildProcessWithoutNullStreams | null;
  tempDir: string | null;
  /**
   * Folders this run created for itself (a Java plan's compiled classes live
   * here). Deleted on finish, like `tempDir` — and never a user folder.
   */
  scratch: string[];
  /** The steps this run executes in order; more than one only for Java. */
  steps: SpawnStep[];
  index: number;
  /** stdin for the program, held until the step that reads it is running. */
  pendingStdin: string | null;
  sink: RunSink;
  remaining: number;
  /**
   * Bounded capture of the current build step's combined output, so a failing
   * compile can be recognised by its diagnostics (e.g. a TypeScript module-
   * format conflict) and answered with an actionable hint. Not the program's
   * stdout — build steps only, and capped so a chatty compiler can't grow it.
   */
  buildOutput: string;
  timer: ReturnType<typeof setTimeout> | null;
  finished: boolean;
};

const sessions = new Map<string, Session>();

/**
 * Environment for child processes: an explicit allow-list instead of
 * `process.env`. The Electron main process can hold things the user typed into
 * an admin panel or provider keys inherited from a dev shell; a language
 * runtime needs the OS basics and PATH, and nothing else.
 */
const ENV_ALLOW_LIST = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  // A JDK's own launcher reads JAVA_HOME (and tools that shell out to `java`
  // need it too). It is a folder path, not a credential, and the language-server
  // bridge sets it from the JDK it verified rather than trusting the ambient one.
  'JAVA_HOME',
  'USERNAME',
  'LANGUAGE',
  'LANG',
  'LC_ALL',
  'TZ',
  'HOME_PATH',
];

export function sanitizeEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_ALLOW_LIST) {
    const actual = Object.keys(base).find((k) => k.toUpperCase() === key);
    if (actual && typeof base[actual] === 'string') out[actual] = base[actual] as string;
  }
  // The PATH a child is handed has to be the one the runtime *lookup* used. A
  // program rarely runs its own tool: a Python script shells out to `git`, an
  // npm script calls `node`, a language server spawns its own helpers, and each
  // of those resolves a name against this value. Giving them the raw inherited
  // snapshot while the IDE detected tools through the recovered registry PATH is
  // what makes "'x' is not recognized" appear next to a green availability dot.
  // Entries are appended in the registry's order, so nothing that already
  // resolved moves or stops resolving.
  const pathKey = Object.keys(out).find((k) => k.toUpperCase() === 'PATH');
  if (pathKey) out[pathKey] = mergedPathEnv(out[pathKey]);
  // Unbuffered, UTF-8 output is what makes streamed stdout appear line by line
  // instead of arriving in one lump when the process exits.
  out.PYTHONUNBUFFERED = '1';
  out.PYTHONIOENCODING = 'utf-8';
  out.PYTHONUTF8 = '1';
  return out;
}

export type StartOptions = {
  language: string;
  /** Buffer contents to run when there is no saved file to run instead. */
  sourceCode: string;
  /** Absolute path of the saved file, when the caller wants *it* executed. */
  filePath?: string | null;
  /** Where throwaway copies of unsaved buffers are written (app.getPath). */
  tempRoot: string;
  timeoutMs?: number;
  /** Optional stdin written to the child as soon as it is spawned. */
  stdin?: string;
  /**
   * User-configured JDK folder (same setting IntelliSense uses). It is only
   * ever handed to the JDK finder, which validates the directory and its
   * launcher; nothing is spawned from the raw string.
   */
  jdkPath?: string | null;
  /**
   * User-configured compiler path (a folder or the executable itself). Like the
   * JDK setting it is only ever handed to the compiler finder, which locates and
   * runs the tool before anything is built from it.
   */
  compilerPath?: string | null;
  /**
   * The document's own saved path, even when the buffer is dirty — the file this
   * run stands for, which is how a C++ project is found for unsaved changes.
   */
  projectPath?: string | null;
  /** The folder the user opened; bounds the project root lookup. */
  workspaceRoot?: string | null;
  /**
   * Resolved Java dependency JARs (absolute paths) to place on the compile and
   * runtime classpath. Only Java consumes it; other languages ignore it.
   */
  classpath?: string[];
};

/**
 * Runtime discovery is injectable so the "no runtime installed" path can be
 * tested (and re-checked after an install) without touching the real PATH.
 */
export type DetectRuntimes = (
  force?: boolean,
  jdkPath?: string | null,
  compilerPath?: string | null,
) => Promise<Record<string, DetectedRuntime>>;

/** The JDK finder a plan may use; same injectable idea as `DetectRuntimes`. */
export type FindJdk = (opts: { customPath?: string | null; minMajor?: number; force?: boolean }) => Promise<JdkInfo | null>;

/** Seams a caller can replace (tests, or a future per-run toolchain choice). */
export type RunDeps = { findJdk?: FindJdk; discoverCpp?: DiscoverCpp; discoverTypeScript?: DiscoverTypeScript };

function emit(sink: RunSink, event: RunEvent): void {
  try {
    sink(event);
  } catch {
    /* a dead window must never crash the main process */
  }
}

/**
 * Remove folders a run created for itself (a scratch build output, a buffer
 * copy). Only ever called on paths this module made under the temp root — never
 * a user folder. Windows antivirus scanners briefly hold a freshly built
 * executable open, so a single rm can fail with EBUSY; quiet retries are what
 * actually clean up, and a leftover temp dir is never worth breaking a run over.
 */
export async function cleanupScratch(dirs: string[]): Promise<void> {
  for (const dir of dirs || []) {
    if (!dir) continue;
    await fsp
      .rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
      .catch(() => {
        /* a leftover temp dir is not worth breaking a run over */
      });
  }
}

function finish(session: Session, event: RunEvent): void {
  if (session.finished) return;
  session.finished = true;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  emit(session.sink, event);
  // Only throwaway folders are deleted; a real workspace file and its folder
  // belong to the user and are never touched.
  void cleanupScratch([session.tempDir, ...session.scratch].filter(Boolean) as string[]);
  session.tempDir = null;
  session.scratch = [];
}

/** Start a local run. Returns the session id, or a structured failure. */
export async function start(
  options: StartOptions,
  sink: RunSink,
  detect: DetectRuntimes = detectLocalRuntimes,
  deps: RunDeps = {},
): Promise<{ ok: true; sessionId: string } | { ok: false; code: string; message: string }> {
  const language = String(options.language || '');
  const plan = LOCAL_PLANS[language];
  if (!plan) {
    return {
      ok: false,
      code: 'NO_LOCAL_PLAN',
      message: `There is no local runner for "${language}" in the desktop app. Run it online (needs the API server) or use the terminal.`,
    };
  }
  if (sessions.size >= MAX_SESSIONS) {
    return { ok: false, code: 'TOO_MANY_RUNS', message: 'Too many local runs are active. Stop one first.' };
  }
  const source = typeof options.sourceCode === 'string' ? options.sourceCode : '';
  if (!source.trim() && !options.filePath) {
    return { ok: false, code: 'EMPTY_SOURCE', message: 'Source code is empty.' };
  }

  const runtimes = await detect(false, options.jdkPath ?? null, options.compilerPath ?? null);
  const rt = runtimes[language];
  // A plan that locates its own toolchain inside the project (TypeScript) must
  // reach `prepare` even when the global probe reported nothing; every other
  // language still needs the probe to have found the runtime first.
  if (plan.needsRuntimeProbe !== false && (!rt || !rt.available)) {
    const label = LOCAL_RUNTIMES[language]?.label || language;
    return {
      ok: false,
      code: 'RUNTIME_MISSING',
      message: `No local ${label} was found. ${LOCAL_RUNTIMES[language]?.installHint || ''}`.trim(),
    };
  }

  // Saved + on disk → run the real file where it lives, so that `import`s and
  // data files next to it behave the way the user expects. Otherwise run a
  // throwaway copy of the buffer from a temp directory.
  let cwd: string;
  let target: string;
  if (options.filePath) {
    // An explicitly selected file must exist. Silently running a temp `main.*`
    // copy instead would execute the wrong program (or an empty one) and hide
    // the real problem, so fail with the path that could not be found.
    if (!fs.existsSync(options.filePath)) {
      return {
        ok: false,
        code: 'FILE_NOT_FOUND',
        message: `The selected file could not be found on disk: ${options.filePath}. Save it (or reopen it) and run again.`,
      };
    }
    cwd = path.dirname(options.filePath);
    target = path.basename(options.filePath);
  } else {
    const tempDir = await fsp.mkdtemp(path.join(options.tempRoot, 'stackamit-run-')).catch(() => null);
    if (!tempDir) {
      return { ok: false, code: 'TMP_UNAVAILABLE', message: 'Could not create a temporary folder for this run.' };
    }
    // A language that cares about the file name (Java: it must match the public
    // class) names its own buffer copy; the rest keep the plan's `main.*`.
    target = plan.sourceNameFor ? plan.sourceNameFor(source) : plan.sourceName;
    cwd = tempDir;
    try {
      await fsp.writeFile(path.join(tempDir, target), source, 'utf8');
    } catch (err) {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      return { ok: false, code: 'TMP_WRITE_FAILED', message: `Could not prepare the run: ${(err as Error).message}` };
    }
  }

  const id = randomUUID();
  const usingSavedFile = Boolean(options.filePath);

  // Resolve what this run executes: one spawn for the interpreted plans, a
  // compile step followed by the program for Java. A plan that cannot proceed
  // returns a structured failure, which reaches the user unchanged.
  let steps: SpawnStep[];
  const scratch: string[] = [];
  const notes: string[] = [];
  if (plan.prepare) {
    const prepared = await plan.prepare({
      rt,
      target,
      cwd,
      sourceFile: path.join(cwd, target),
      tempDir: usingSavedFile ? null : cwd,
      tempRoot: options.tempRoot,
      usingSavedFile,
      jdkPath: options.jdkPath ?? null,
      compilerPath: options.compilerPath ?? null,
      projectPath: options.projectPath ?? null,
      workspaceRoot: options.workspaceRoot ?? null,
      classpath: options.classpath ?? [],
      findJdk: deps.findJdk ?? findJdk,
      discoverCpp: deps.discoverCpp ?? discoverCpp,
      discoverTypeScript: deps.discoverTypeScript ?? discoverTypeScript,
    });
    if ('steps' in prepared) {
      if (!prepared.steps.length) {
        return { ok: false, code: 'NO_LOCAL_PLAN', message: `The local runner for "${language}" produced no command.` };
      }
      steps = prepared.steps;
      scratch.push(...(prepared.scratch || []));
      notes.push(...(prepared.notes || []));
    } else {
      // Nothing was spawned yet, so every folder created for this run is ours
      // to remove again — including the buffer copy and the scratch dir.
      if (!usingSavedFile) await fsp.rm(cwd, { recursive: true, force: true }).catch(() => {});
      for (const dir of scratch) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
      return prepared;
    }
  } else if (plan.run) {
    steps = [plan.run(rt, target)];
  } else {
    return { ok: false, code: 'NO_LOCAL_PLAN', message: `The local runner for "${language}" is not configured.` };
  }

  const session: Session = {
    id,
    child: null,
    tempDir: usingSavedFile ? null : cwd,
    scratch,
    steps,
    index: 0,
    pendingStdin: options.stdin || null,
    sink,
    remaining: MAX_OUTPUT_CHARS,
    buildOutput: '',
    timer: null,
    finished: false,
  };

  if (!usingSavedFile) {
    emit(session.sink, { type: 'info', data: `Running an unsaved copy from ${cwd}\n` });
  }
  for (const note of notes) emit(session.sink, { type: 'info', data: `${note}\n` });

  const stream = (kind: 'stdout' | 'stderr') => (chunk: Buffer) => {
    // Keep a bounded copy of a build step's output so a failed compile can be
    // diagnosed (the program's own stdout is never buffered here).
    if (session.index < steps.length - 1 && session.buildOutput.length < 64_000) {
      session.buildOutput += String(chunk);
    }
    if (session.remaining <= 0) return;
    const text = String(chunk);
    if (text.length > session.remaining) {
      emit(session.sink, { type: kind, data: text.slice(0, session.remaining) });
      emit(session.sink, { type: 'info', data: '\n… output truncated (limit reached).\n' });
      session.remaining = 0;
      return;
    }
    session.remaining -= text.length;
    emit(session.sink, { type: kind, data: text });
  };

  /** Spawn one step; on a clean exit, continue with the next one. */
  const launch = (index: number): { ok: true } | { ok: false; message: string } => {
    const step = steps[index];
    session.index = index;
    session.buildOutput = '';
    // Prefer the toolchain the plan verified, then the runtime discovery found,
    // then the plain command name. Never a shell in between.
    const file = step.file || rt.path || executableName(step.cmd);
    emit(session.sink, { type: 'info', data: `$ ${step.cmd} ${step.args.join(' ')}\n` });
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(file, step.args, {
        cwd: step.cwd || cwd,
        windowsHide: true,
        // The allow-listed environment, plus whatever this step needs on top of
        // it (a C++ run step prepends the compiler's folder for its DLLs).
        env: step.env ? { ...sanitizeEnv(), ...step.env } : sanitizeEnv(),
        stdio: [step.stdin === false ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      }) as ChildProcessWithoutNullStreams;
    } catch (err) {
      return { ok: false, message: `Failed to start ${step.cmd}: ${(err as Error).message}` };
    }
    session.child = child;
    child.stdout.on('data', stream('stdout'));
    child.stderr.on('data', stream('stderr'));

    child.on('error', (err: NodeJS.ErrnoException) => {
      // ENOENT here means the runtime disappeared between probe and spawn.
      const hint = err.code === 'ENOENT' ? LOCAL_RUNTIMES[language]?.installHint || '' : err.message;
      emit(session.sink, { type: 'error', data: `Could not run ${step.cmd}: ${hint}\n` });
      sessions.delete(id);
      finish(session, { type: 'exit', code: null });
    });

    child.on('close', (code) => {
      if (session.finished) return;
      if (code === 0 && index < steps.length - 1) {
        const next = launch(index + 1);
        if (!next.ok) {
          sessions.delete(id);
          emit(session.sink, { type: 'error', data: `${next.message}\n` });
          finish(session, { type: 'exit', code: null });
        }
        return;
      }
      if (index < steps.length - 1) {
        // A build step failed: its compiler output has already streamed to
        // stderr, so say what that means instead of running a stale class file.
        emit(session.sink, { type: 'info', data: `… stopped: ${step.label || step.cmd} failed (exit ${code ?? 'unknown'}), so nothing was run.\n` });
        // Turn a common, self-inflicted TypeScript module-format conflict into a
        // plain-language next step. The project's config stays the source of
        // truth — the IDE never edits it or overrides the compiler — it only
        // explains what `tsc` itself is refusing and how to resolve it.
        if (language === 'typescript') {
          const hint = typescriptModuleFormatHint(session.buildOutput);
          if (hint) emit(session.sink, { type: 'info', data: `\n${hint}\n` });
        }
      }
      sessions.delete(id);
      finish(session, { type: 'exit', code: typeof code === 'number' ? code : null });
    });

    // stdin belongs to the program, never to a build step.
    if (step.stdin !== false && session.pendingStdin) {
      writeStdin(id, session.pendingStdin);
      session.pendingStdin = null;
    }
    return { ok: true };
  };

  sessions.set(id, session);
  const first = launch(0);
  if (!first.ok) {
    sessions.delete(id);
    finish(session, { type: 'error', data: first.message });
    return { ok: false, code: 'SPAWN_FAILED', message: first.message };
  }

  // One wall-clock budget for the whole run (compile + execute), not per step.
  // A plan can raise it for a toolchain that legitimately takes longer to build.
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : plan.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  session.timer = setTimeout(() => {
    if (session.finished) return;
    emit(session.sink, { type: 'info', data: `\n… stopped: this run exceeded the ${timeoutMs / 1000}s local time limit.\n` });
    killChild(session);
    sessions.delete(id);
    finish(session, { type: 'exit', code: null, timedOut: true });
  }, timeoutMs);

  return { ok: true, sessionId: id };
}

// ---------------------------------------------------------------------------
// "Run in Terminal": render the SAME plan as a manual command line
// ---------------------------------------------------------------------------
export type TerminalCommandOptions = {
  language: string;
  /** Absolute path of the saved file (must exist on disk — a terminal runs a real file). */
  filePath: string | null;
  jdkPath?: string | null;
  compilerPath?: string | null;
  projectPath?: string | null;
  workspaceRoot?: string | null;
  /** Resolved Java dependency JARs, kept identical to the managed run. */
  classpath?: string[];
};

export type TerminalCommandResult =
  | { ok: true; commands: string[]; cwd: string; extraPathDirs: string[]; notes: string[]; scratch: string[] }
  | { ok: false; code: string; message: string };

/**
 * Quote one token for cmd.exe. A token is left bare when it needs no quoting,
 * wrapped in double quotes when it holds a space or a cmd metacharacter, and
 * rejected (null) when it contains a character that cannot be safely embedded
 * at all — a double quote, a `%` (variable expansion fires even inside quotes),
 * or a control character. Rejecting rather than guessing is what keeps this
 * from becoming "unsafe shell concatenation": the caller then runs the managed
 * Output path instead of typing a command that could misbehave.
 */
export function renderCmdToken(token: string): string | null {
  const text = String(token);
  if (/["%\r\n]/.test(text)) return null;
  if (text === '') return '""';
  if (!/[ \t&^|<>()]/.test(text)) return text;
  return `"${text}"`;
}

/** Render one argv (program + args) into a cmd.exe command line, or null. */
export function renderCmdLine(prog: string, args: string[]): string | null {
  const head = renderCmdToken(prog);
  if (head === null) return null;
  const rest: string[] = [];
  for (const arg of args) {
    const token = renderCmdToken(arg);
    if (token === null) return null;
    rest.push(token);
  }
  return [head, ...rest].join(' ');
}

/**
 * Build the command line a managed run would execute — without running it — so
 * the integrated terminal types the identical build. It calls the very same
 * `LOCAL_PLANS[*].prepare` / `.run` the Output run uses (cpp/java multi-file
 * discovery, include dirs, standards, scratch output folder and all), so the two
 * can never disagree. Only a saved file can go this way: a terminal has no
 * throwaway buffer copy to compile.
 */
export async function buildTerminalCommand(
  options: TerminalCommandOptions,
  detect: DetectRuntimes = detectLocalRuntimes,
  deps: RunDeps = {},
): Promise<TerminalCommandResult> {
  const language = String(options.language || '');
  const plan = LOCAL_PLANS[language];
  if (!plan) {
    return { ok: false, code: 'NO_LOCAL_PLAN', message: `There is no local runner for "${language}" to render a command for.` };
  }
  if (!options.filePath || !fs.existsSync(options.filePath)) {
    return {
      ok: false,
      code: 'NOT_SAVED',
      message: 'Save the file to disk before running it in the terminal — a shell needs the real file, not an unsaved buffer.',
    };
  }

  const runtimes = await detect(false, options.jdkPath ?? null, options.compilerPath ?? null);
  const rt = runtimes[language];
  if (plan.needsRuntimeProbe !== false && (!rt || !rt.available)) {
    const label = LOCAL_RUNTIMES[language]?.label || language;
    return { ok: false, code: 'RUNTIME_MISSING', message: `No local ${label} was found. ${LOCAL_RUNTIMES[language]?.installHint || ''}`.trim() };
  }

  const cwd = path.dirname(options.filePath);
  const target = path.basename(options.filePath);
  const tempRoot = process.env.TEMP || process.env.TMP || os.tmpdir();

  let steps: SpawnStep[];
  const notes: string[] = [];
  // A compiled plan builds into a scratch folder it created during `prepare`. The
  // typed terminal command writes its output there, so the folder must stay while
  // the command can still use it — it is handed back for the window's lifecycle to
  // release, not deleted here (and a plan that fails before returning cleans its
  // own folder).
  const scratch: string[] = [];
  if (plan.prepare) {
    const prepared = await plan.prepare({
      rt,
      target,
      cwd,
      sourceFile: options.filePath,
      tempDir: null,
      tempRoot,
      usingSavedFile: true,
      jdkPath: options.jdkPath ?? null,
      compilerPath: options.compilerPath ?? null,
      projectPath: options.projectPath ?? null,
      workspaceRoot: options.workspaceRoot ?? null,
      classpath: options.classpath ?? [],
      findJdk: deps.findJdk ?? findJdk,
      discoverCpp: deps.discoverCpp ?? discoverCpp,
      discoverTypeScript: deps.discoverTypeScript ?? discoverTypeScript,
    });
    if ('steps' in prepared) {
      steps = prepared.steps;
      notes.push(...(prepared.notes || []));
      scratch.push(...(prepared.scratch || []));
    } else {
      // A plan that cannot proceed cleans up its own scratch folder before
      // returning (cpp/java `prepare` do this), so the structured failure is
      // simply handed back for the renderer to explain.
      return { ok: false, code: prepared.code, message: prepared.message };
    }
  } else if (plan.run) {
    steps = [plan.run(rt, target)];
  } else {
    return { ok: false, code: 'NO_LOCAL_PLAN', message: `The local runner for "${language}" is not configured.` };
  }

  // Folders a step puts ahead of PATH (a C++ run needs its compiler's DLLs). The
  // integrated terminal already carries the merged PATH, so only the additions
  // this plan makes are handed over — that is what makes the manual command and
  // the managed run genuinely equivalent for a compiled program.
  const basePathSet = new Set(mergedPathEnv().split(path.delimiter).map((d) => d.toLowerCase()));
  const extraPathDirs: string[] = [];
  for (const step of steps) {
    const p = step.env?.PATH;
    if (!p) continue;
    for (const dir of p.split(path.delimiter)) {
      if (dir && !basePathSet.has(dir.toLowerCase()) && !extraPathDirs.includes(dir)) extraPathDirs.push(dir);
    }
  }

  const commands: string[] = [];
  for (const step of steps) {
    const prog = step.file || step.cmd;
    const line = renderCmdLine(prog, step.args);
    if (line === null) {
      // The command cannot be typed at all, so it will never run and its output
      // folder is already useless — release it now rather than leak it.
      await cleanupScratch(scratch);
      return {
        ok: false,
        code: 'TERMINAL_UNSAFE_PATH',
        message: 'This project uses a path with characters that cannot be safely written into a shell command line. Run it through the Output panel instead.',
      };
    }
    commands.push(line);
  }

  return { ok: true, commands, cwd: steps[0]?.cwd || cwd, extraPathDirs, notes, scratch };
}

function killChild(session: Session): void {
  const child = session.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    // SIGKILL/TerminateProcess: the direct child is the language runtime itself
    // (no intermediate shell), so one kill ends the whole run on Windows too.
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

/** Send a line to the running program's stdin. */
export function writeStdin(sessionId: string, data: string): boolean {
  const s = sessions.get(sessionId);
  if (!s || !s.child || !s.child.stdin?.writable) return false;
  try {
    s.child.stdin.write(String(data).slice(0, 16384));
    return true;
  } catch {
    return false;
  }
}

/** Stop a running program; the exit event carries `stopped: true`. */
export function stop(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  killChild(s);
  sessions.delete(sessionId);
  emit(s.sink, { type: 'info', data: 'Stopped by user.\n' });
  finish(s, { type: 'exit', code: null, stopped: true });
  return true;
}

export function activeSessionIds(): string[] {
  return [...sessions.keys()];
}

export function disposeAll(): void {
  for (const id of [...sessions.keys()]) stop(id);
  sessions.clear();
}
