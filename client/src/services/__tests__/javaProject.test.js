import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectJavaProjectMode, isJavaProjectMarker, JAVA_PROJECT_MARKERS } from '../javaProject.js';

/**
 * Standalone-vs-project detection. This decides whether JDT.LS imports a
 * Maven/Gradle descriptor, so getting it wrong either breaks third-party
 * libraries (project treated as standalone) or does nothing harmful.
 */
const listings = new Map();

vi.mock('../workspace.js', () => ({
  workspace: {
    mode: 'desktop',
    readDirectory: vi.fn(async (dir) => {
      const hit = listings.get(dir.toLowerCase());
      if (hit === 'throw') throw new Error('bridge exploded');
      if (hit === 'fail') return { ok: false, message: 'FORBIDDEN' };
      return { ok: true, entries: hit || [] };
    }),
  },
}));

const file = (name) => ({ name, isDirectory: false });
const dir = (name) => ({ name, isDirectory: true });

beforeEach(() => {
  listings.clear();
});

describe('isJavaProjectMarker', () => {
  it('recognizes every build descriptor the server can import', () => {
    for (const name of JAVA_PROJECT_MARKERS) {
      expect(isJavaProjectMarker(name), name).toBe(true);
      expect(isJavaProjectMarker(`C:\\proj\\sub\\${name}`), name).toBe(true);
      expect(isJavaProjectMarker(`C:\\proj\\${name.toUpperCase()}`), name).toBe(true);
    }
    expect(isJavaProjectMarker('Main.java')).toBe(false);
    expect(isJavaProjectMarker('pom.xml.bak')).toBe(false);
    expect(isJavaProjectMarker('')).toBe(false);
  });
});

describe('detectJavaProjectMode', () => {
  it('finds a Maven project from a nested source folder', async () => {
    listings.set('c:\\proj'.toLowerCase(), [dir('src'), file('pom.xml')]);
    listings.set('c:\\proj\\src\\main\\java\\com'.toLowerCase(), [file('Main.java')]);
    expect(await detectJavaProjectMode('C:\\proj\\src\\main\\java\\com\\Main.java', 'C:\\proj')).toBe('project');
  });

  it('finds a Gradle project when the descriptor sits in an intermediate folder', async () => {
    listings.set('c:\\proj'.toLowerCase(), [dir('module-a')]);
    listings.set('c:\\proj\\module-a'.toLowerCase(), [file('build.gradle.kts'), file('App.java')]);
    expect(await detectJavaProjectMode('C:\\proj\\module-a\\App.java', 'C:\\proj')).toBe('project');
  });

  it('reports standalone only when every folder up to the root is provably clean', async () => {
    listings.set('c:\\proj'.toLowerCase(), [dir('notes'), file('README.md')]);
    listings.set('c:\\proj\\notes'.toLowerCase(), [file('Main.java')]);
    expect(await detectJavaProjectMode('C:\\proj\\notes\\Main.java', 'C:\\proj')).toBe('standalone');
  });

  it('treats a listing failure as doubt, so dependency import stays on', async () => {
    listings.set('c:\\proj'.toLowerCase(), 'fail');
    listings.set('c:\\proj\\src'.toLowerCase(), [file('Main.java')]);
    expect(await detectJavaProjectMode('C:\\proj\\src\\Main.java', 'C:\\proj')).toBe('project');
  });

  it('never loses a project because a folder threw', async () => {
    listings.set('c:\\proj'.toLowerCase(), 'throw');
    listings.set('c:\\proj\\deep'.toLowerCase(), [file('build.gradle')]);
    expect(await detectJavaProjectMode('C:\\proj\\deep\\Main.java', 'C:\\proj')).toBe('project');
  });

  it('checks the root even when the file is not under it (absolute-path drift)', async () => {
    listings.set('c:\\proj'.toLowerCase(), [file('settings.gradle')]);
    expect(await detectJavaProjectMode('D:\\other\\Main.java', 'C:\\proj')).toBe('project');
  });

  it('handles forward-slash roots and an unknown root folder', async () => {
    listings.set('/home/me/proj'.toLowerCase(), [file('pom.xml')]);
    expect(await detectJavaProjectMode('/home/me/proj/src/Main.java', '/home/me/proj')).toBe('project');
    // Without a root the walk still finds the descriptor above the file.
    expect(await detectJavaProjectMode('/home/me/proj/src/Main.java', null)).toBe('project');
  });

  it('stops walking at the workspace root (a stray descriptor above is not the project)', async () => {
    listings.set('c:\\users\\me'.toLowerCase(), [file('pom.xml')]);
    listings.set('c:\\users\\me\\desktop\\demo'.toLowerCase(), [file('Main.java')]);
    expect(await detectJavaProjectMode('C:\\users\\me\\desktop\\demo\\Main.java', 'C:\\users\\me\\desktop\\demo')).toBe('standalone');
  });
});
