/**
 * Java run planning (Electron main process, pure functions).
 *
 * Why this is a module of its own: everything that decides *how* a Java program
 * gets executed is a string/argv problem with real edge cases (package
 * declarations, a public class whose name does not match the file name,
 * multi-file projects, Maven/Gradle layouts, a JDK 8 that has no source-file
 * mode). Keeping it pure makes it unit-testable and keeps `localRun.ts` in
 * charge of what it is good at — spawning, streaming, timing out, killing.
 *
 * The strategies below are not guesses; each one was executed against a real
 * JDK on this machine (see the `javaToolchain` integration suite):
 *  - `java Main.java` (source-file mode, JDK 11+) compiles in memory, reads
 *    sibling sources in the same folder, tolerates a class name that differs
 *    from the file name, accepts stdin, and reports a missing third-party
 *    package as a genuine compile error.
 *  - It is *not* used for a file that declares a `package`: passing the bare
 *    file name then breaks the package/path correspondence the mode requires,
 *    so any `package` statement goes down the compile-and-run path instead —
 *    `javac -d <scratch> -sourcepath . <relative source>` then
 *    `java -cp <scratch> <qualified.MainClass>`, which also compiles the
 *    dependent sources the program references.
 *
 * Two argv rules come from measurements, not preferences:
 *  - **Paths stay relative to the step's `cwd`.** `java`/`javac` decode their
 *    command line with `sun.jnu.encoding`, which on a default Windows install
 *    is the ANSI code page (this machine: Cp1252). An absolute project path
 *    containing `测试` arrives mangled and javac answers
 *    `error: Invalid filename`, while the same file addressed relatively from
 *    its own folder compiles and runs. Only the scratch class directory — a
 *    path this app created, not user content — is passed absolutely.
 *  - **The JVM is told to speak UTF-8.** Without `-Dstdout.encoding` a program
 *    printing `ünïcødē 测试 🧪` emits code-page bytes into the pipe the runner
 *    reads as UTF-8, so the Output panel would show mojibake.
 *
 * No file path or source text is ever interpolated into a shell command line:
 * every step is an executable plus an argv array, which is why folders with
 * spaces need no quoting tricks at all.
 */
import fs from 'node:fs';
import path from 'node:path';

import { IS_WIN, type JdkInfo } from './runtimeProbe.js';

/** One child process in a run. Mirrors `localRun.SpawnStep` structurally. */
export type JavaStep = {
  /** Bare command name, kept for the echoed `$ …` line. */
  cmd: string;
  /** Absolute executable to spawn (the JDK's own bin, not PATH's). */
  file: string;
  args: string[];
  cwd: string;
  /** Only the program itself gets a stdin; a build step does not. */
  stdin: boolean;
  /** Human-readable phase, shown when the step starts. */
  label: string;
};

export type JavaPlan = {
  strategy: 'source-file' | 'compile-and-run';
  mainClass: string;
  /** Folder the compiled classes land in (a scratch dir this run owns). */
  outDir: string;
  steps: JavaStep[];
  /** Lines the runner streams as `info` before executing. */
  notes: string[];
};

/**
 * JVM switches for the program itself: the runner reads the pipe as UTF-8, so
 * the child has to write it as UTF-8 too (`stdout.encoding`/`stderr.encoding`
 * are JDK 19+; older JVMs ignore the property and already matched the platform,
 * which is exactly what the two lines below fix on every JDK that matters).
 */
export const JAVA_UTF8_FLAGS = ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8'];
/** The same for `javac`, whose own JVM prints the compiler diagnostics. */
export const JAVAC_UTF8_FLAGS = JAVA_UTF8_FLAGS.map((f) => `-J${f}`);

/**
 * Remove comments and string/character literals so declarations inside them
 * cannot be mistaken for the program's own package/class. A tiny scanner, not
 * a Java parser: text blocks (`"""`) are handled, annotation escaping is not
 * relevant to the two things we look for.
 */
export function stripJavaCommentsAndLiterals(source: string): string {
  const text = String(source ?? '');
  let out = '';
  let i = 0;
  type State = 'code' | 'line' | 'block' | 'string' | 'char' | 'text';
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
      } else if (text.startsWith('"""', i)) {
        state = 'text';
        i += 3;
      } else if (text[i] === '"') {
        state = 'string';
        i += 1;
      } else if (text[i] === "'") {
        state = 'char';
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
      } else {
        if (text[i] === '\n') out += '\n'; // keep line numbers meaningful
        i += 1;
      }
      continue;
    }
    // Inside a literal: only the terminator matters, plus backslash escapes.
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (state === 'text' && text.startsWith('"""', i)) {
      state = 'code';
      i += 3;
      continue;
    }
    if ((state === 'string' && text[i] === '"') || (state === 'char' && text[i] === "'")) {
      state = 'code';
      i += 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** `package a.b;` + the class whose `main` will be run. */
export function parseJavaUnit(source: string, fileName: string): { pkg: string | null; className: string } {
  const clean = stripJavaCommentsAndLiterals(source);
  const pkg = clean.match(/^\s*package\s+([\w$]+(?:\.[\w$]+)*)\s*;/m)?.[1] ?? null;

  const declared: { name: string; public: boolean }[] = [];
  const decl = /(?:^|[\s;}])([\w\s.]*?)\b(class|interface|enum|record)\s+([\w$]+)/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(clean))) {
    const modifiers = m[1] || '';
    // `new` / anonymous bodies never carry these modifiers, so this stays
    // specific to type declarations.
    if (/\bnew\b/.test(modifiers)) continue;
    declared.push({ name: m[3], public: /\bpublic\b/.test(modifiers) });
  }

  const base = path.basename(fileName).replace(/\.java$/i, '');
  const byName = declared.find((d) => d.name === base);
  const firstPublic = declared.find((d) => d.public);
  return { pkg, className: byName?.name || firstPublic?.name || declared[0]?.name || base || 'Main' };
}

/**
 * The directory that sits *above* the package path, which is what `javac`'s
 * `-sourcepath` needs to find the project's other sources. Walks up one folder
 * per package segment and stops as soon as the names stop matching, so a
 * `src/main/java/com/x/App.java` tree resolves to `src/main/java` while a
 * stray `package` that does not match the layout falls back to the file's own
 * folder instead of inventing a root.
 */
export function sourceRootFor(sourceFile: string, pkg: string | null): string {
  let dir = path.dirname(sourceFile);
  if (!pkg) return dir;
  for (const segment of pkg.split('.').reverse()) {
    if (path.basename(dir) !== segment) return path.dirname(sourceFile);
    dir = path.dirname(dir);
  }
  return dir;
}

export function javacPathOf(jdk: JdkInfo): string {
  return path.join(jdk.home, 'bin', IS_WIN ? 'javac.exe' : 'javac');
}

export type JavaRunInput = {
  jdk: JdkInfo;
  /** Absolute path of the `.java` file that will actually be executed. */
  sourceFile: string;
  /** Folder the *program* runs in — the file's own folder, as for other languages. */
  cwd: string;
  /** Scratch folder for `.class` output — created and removed by the caller. */
  outDir: string;
  /** A `pom.xml` / `build.gradle` exists above the file. */
  buildDescriptor: boolean;
  /**
   * Absolute paths to already-resolved dependency JARs (from `javaDeps`), placed
   * on BOTH the compile and the runtime classpath. They live in `~/.m2`, not in
   * the project, so — like the scratch `outDir` — they are passed absolutely and
   * never need the relative-path care a user source file does.
   */
  classpath?: string[];
};

/** OS-correct classpath separator: `;` on Windows, `:` elsewhere. */
export function classpathSeparator(): string {
  return IS_WIN ? ';' : ':';
}

/**
 * Decide the strategy and build the argv. Returns a structured failure when
 * this JDK cannot run the program at all — which is reported to the user,
 * never papered over by picking a runtime we did not verify.
 */
export function planJavaRun(input: JavaRunInput): { ok: true; plan: JavaPlan } | { ok: false; code: string; message: string } {
  const { jdk, sourceFile, cwd, outDir } = input;
  const depJars = (input.classpath || []).filter(Boolean);
  const cpSep = classpathSeparator();
  const javac = javacPathOf(jdk);
  if (!fs.existsSync(javac)) {
    return {
      ok: false,
      code: 'JRE_ONLY',
      message: `The Java runtime at ${jdk.home} has no compiler (javac). Running Java needs a full JDK — install one (winget install -e --id Microsoft.OpenJDK.21) or point the custom JDK path at a JDK folder.`,
    };
  }

  const { pkg, className } = parseJavaUnit(fs.readFileSync(sourceFile, 'utf8'), path.basename(sourceFile));
  const mainClass = pkg ? `${pkg}.${className}` : className;
  // Source-file mode needs JDK 11+ (JEP 330) and wants the path handed to it to
  // match the declared package; any `package` statement — and any JDK whose
  // version could not be read — takes the path that works on every JDK instead.
  const canUseSourceMode = (jdk.major ?? 0) >= 11 && !pkg;
  const strategy: JavaPlan['strategy'] = canUseSourceMode ? 'source-file' : 'compile-and-run';
  // The compile step works from the folder above the package path and names the
  // source relatively, because an absolute non-ASCII path does not survive the
  // JVM's command-line decoding (see the module header).
  const sourceRoot = sourceRootFor(sourceFile, pkg);
  const relativeSource = path.relative(sourceRoot, sourceFile) || path.basename(sourceFile);

  const notes = [
    `Java · ${strategy === 'source-file' ? 'source-file mode' : `javac → java · main class ${mainClass}`} · JDK ${jdk.major ?? jdk.version ?? 'unknown'} (${jdk.source})`,
  ];
  if (input.buildDescriptor && depJars.length === 0) {
    notes.push(
      'A Maven/Gradle descriptor is in this project, but the declared dependencies are not on the classpath yet: they are not resolved automatically, so a third-party import will fail to compile until it is really added (Java Dependencies panel → Resolve).',
    );
  } else if (depJars.length > 0) {
    notes.push(`Java dependencies on the classpath: ${depJars.length} JAR${depJars.length === 1 ? '' : 's'}.`);
  }

  const steps: JavaStep[] =
    strategy === 'source-file'
      ? [
          {
            cmd: 'java',
            file: jdk.javaExe,
            // Source-file mode still needs the dependencies for compilation and
            // execution; `--class-path` is the single flag that serves both.
            args: depJars.length
              ? [...JAVA_UTF8_FLAGS, '--class-path', depJars.join(cpSep), path.basename(sourceFile)]
              : [...JAVA_UTF8_FLAGS, path.basename(sourceFile)],
            cwd,
            stdin: true,
            label: 'java',
          },
        ]
      : [
          {
            cmd: 'javac',
            file: javac,
            // `-sourcepath .` is what makes javac compile the other sources this
            // program references; `-d` keeps the class files out of the project.
            // `-cp <deps>` puts resolved JARs on the compile classpath.
            args: [
              '-encoding',
              'UTF-8',
              ...JAVAC_UTF8_FLAGS,
              '-d',
              outDir,
              ...(depJars.length ? ['-cp', depJars.join(cpSep)] : []),
              '-sourcepath',
              '.',
              relativeSource,
            ],
            cwd: sourceRoot,
            stdin: false,
            label: 'javac',
          },
          {
            // The program runs in the file's own folder, so data files next to
            // it resolve the way they do for Python and Node. The classpath is
            // the compiled classes PLUS the same dependency JARs javac saw, so
            // compile and runtime agree and a resolved type never NoClassDefFound.
            cmd: 'java',
            file: jdk.javaExe,
            args: [...JAVA_UTF8_FLAGS, '-cp', [outDir, ...depJars].join(cpSep), mainClass],
            cwd,
            stdin: true,
            label: 'java',
          },
        ];

  return { ok: true, plan: { strategy, mainClass, outDir, steps, notes } };
}

/** File name an unsaved Java buffer must be written under. */
export function javaBufferFileName(source: string): string {
  return `${parseJavaUnit(String(source ?? ''), 'Main.java').className}.java`;
}
