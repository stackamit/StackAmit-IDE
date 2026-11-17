import { describe, it, expect } from 'vitest';
import {
  monacoLanguageFor,
  runKeyFor,
  baseName,
  isUntitled,
  MONACO_TO_RUN_KEY,
} from '../langForFile.js';
import { LANGUAGES } from '../../languages/languageCapabilities.js';

/**
 * The exact backend runner contract, mirrored from
 * `server/src/config/languages.js` (key + the file name each provider expects).
 * The server's own `tests/runner-matrix.test.js` asserts the same 18 keys
 * against the real registry, so the two ends cannot drift apart silently.
 */
const SERVER_RUNNERS = [
  ['python', 'main.py'],
  ['c', 'main.c'],
  ['cpp', 'main.cpp'],
  ['java', 'Main.java'],
  ['javascript', 'main.js'],
  ['typescript', 'main.ts'],
  ['go', 'main.go'],
  ['rust', 'main.rs'],
  ['csharp', 'main.cs'],
  ['php', 'main.php'],
  ['ruby', 'main.rb'],
  ['perl', 'main.pl'],
  ['lua', 'main.lua'],
  ['julia', 'main.jl'],
  ['haskell', 'Main.hs'],
  ['sql', 'main.sql'],
  ['shell', 'main.sh'],
  ['pascal', 'main.pas'],
];

describe('monacoLanguageFor', () => {
  it('maps common source extensions to Monaco language ids', () => {
    expect(monacoLanguageFor('app.js')).toBe('javascript');
    expect(monacoLanguageFor('src/main.tsx')).toBe('typescript');
    expect(monacoLanguageFor('notes.md')).toBe('markdown');
    expect(monacoLanguageFor('pkg.json')).toBe('json');
    expect(monacoLanguageFor('script.py')).toBe('python');
    expect(monacoLanguageFor('main.cpp')).toBe('cpp');
    expect(monacoLanguageFor('a.hpp')).toBe('cpp');
  });

  it('is case-insensitive on the extension', () => {
    expect(monacoLanguageFor('README.MD')).toBe('markdown');
    expect(monacoLanguageFor('Index.HTML')).toBe('html');
  });

  it('handles Windows-style and POSIX paths, and dotfiles', () => {
    expect(monacoLanguageFor('C:\\work\\proj\\Main.java')).toBe('java');
    expect(monacoLanguageFor('/home/user/.git/config')).toBe('plaintext');
  });

  it('classifies a .ts file in a nested folder whose path contains spaces', () => {
    // The exact reported shape: a space in a parent folder name and a nested
    // project directory. The extension — not the folder layout — decides it.
    const p = 'C:\\Users\\amitk\\Desktop\\typescript test\\ts-calculator\\calculator.ts';
    expect(monacoLanguageFor(p)).toBe('typescript');
    expect(runKeyFor(p)).toBe('typescript');
  });

  it('falls back to plaintext for unknown or missing extensions', () => {
    expect(monacoLanguageFor('LICENSE')).toBe('plaintext');
    expect(monacoLanguageFor('weird.qqq')).toBe('plaintext');
    expect(monacoLanguageFor('')).toBe('plaintext');
  });
});

describe('runKeyFor', () => {
  it('returns a backend run key only for supported languages', () => {
    expect(runKeyFor('main.py')).toBe('python');
    expect(runKeyFor('Main.java')).toBe('java');
    expect(runKeyFor('prog.c')).toBe('c');
    expect(runKeyFor('game.cpp')).toBe('cpp');
    expect(runKeyFor('index.js')).toBe('javascript');
    // TypeScript has its own runner key (provider compiles with tsc).
    expect(runKeyFor('app.ts')).toBe('typescript');
  });

  it('returns null for non-runnable files', () => {
    expect(runKeyFor('style.css')).toBeNull();
    expect(runKeyFor('README.md')).toBeNull();
    expect(runKeyFor('untitled:Untitled-1')).toBeNull();
  });
});

describe('baseName / isUntitled', () => {
  it('extracts the trailing segment of a path', () => {
    expect(baseName('/a/b/c/hello.txt')).toBe('hello.txt');
    expect(baseName('C:\\x\\y.rs')).toBe('y.rs');
  });

  it('recognises never-saved in-memory documents', () => {
    expect(isUntitled('untitled:Untitled-3')).toBe(true);
    expect(isUntitled('')).toBe(true);
    expect(isUntitled('/real/file.js')).toBe(false);
  });
});

describe('frontend → backend runner mapping (all 18 online runners)', () => {
  it('every registered backend runner is reachable from its own file name', () => {
    for (const [key, fileName] of SERVER_RUNNERS) {
      expect(runKeyFor(fileName), `runKeyFor(${fileName})`).toBe(key);
      // Also from a realistic nested Windows path, which is what the desktop
      // IDE actually hands the Run action.
      expect(runKeyFor(`C:\\Users\\dev\\proj\\src\\${fileName}`), `nested ${fileName}`).toBe(key);
    }
  });

  it('exposes exactly the backend keys — no invented or dropped runners', () => {
    expect(Object.values(MONACO_TO_RUN_KEY).sort()).toEqual(SERVER_RUNNERS.map(([k]) => k).sort());
    expect(new Set(Object.values(MONACO_TO_RUN_KEY)).size).toBe(SERVER_RUNNERS.length);
  });

  it('only advertises `run` in the capability registry for real backend runners', () => {
    const known = new Set(SERVER_RUNNERS.map(([k]) => k));
    const advertised = LANGUAGES.filter((l) => l.run);
    for (const l of advertised) {
      expect(known.has(l.run), `${l.id} advertises unknown runner "${l.run}"`).toBe(true);
    }
    // 18 unique backend runners must all be advertised in the catalogue.
    expect(new Set(advertised.map((l) => l.run)).size).toBe(SERVER_RUNNERS.length);
  });
});
