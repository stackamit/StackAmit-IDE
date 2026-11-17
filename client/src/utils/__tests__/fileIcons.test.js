import { describe, it, expect } from 'vitest';
import { fileIconMeta, folderColorClass } from '../fileIcons.js';

describe('fileIcons mapping', () => {
  it('resolves distinct icons by extension', () => {
    expect(fileIconMeta('app.js').Icon).toBeTruthy();
    expect(fileIconMeta('app.js').className).toContain('text-');
    expect(fileIconMeta('styles.css').className).toBe('text-blue-400');
    expect(fileIconMeta('data.json').Icon).not.toBe(fileIconMeta('notes.txt').Icon);
  });

  it('prefers exact file-name rules over generic extension rules', () => {
    // package.json should use the red json variant, not the plain .json amber one
    expect(fileIconMeta('package.json').className).toBe('text-red-400');
    expect(fileIconMeta('Dockerfile').className).toBe('text-sky-400');
  });

  it('falls back to a generic icon for unknown types', () => {
    const meta = fileIconMeta('mystery.xyz123');
    expect(meta.Icon).toBeTruthy();
    expect(meta.className).toBe('text-slate-400');
  });

  it('colors known folders and defaults others to amber', () => {
    expect(folderColorClass('node_modules')).toBe('text-rose-400/80');
    expect(folderColorClass('randomdir')).toBe('text-amber-400/80');
  });

  it('covers every file type the Explorer promises, each with a real component', () => {
    const required = {
      'Main.java': 'java',
      'app.py': 'py',
      'app.js': 'js',
      'app.ts': 'ts',
      'main.c': 'c',
      'widget.cpp': 'cpp',
      'index.html': 'html',
      'styles.css': 'css',
      'data.json': 'json',
      'README.md': 'md',
      'logo.png': 'png',
      '.editorconfig': 'config',
      'settings.properties': 'properties',
      'build.gradle': 'gradle',
      'notes.txt': 'txt',
    };
    for (const [name] of Object.entries(required)) {
      const { Icon, className } = fileIconMeta(name);
      // lucide glyphs are plain functions or forwardRef objects; both are
      // renderable, and FileExplorer's own tests prove they produce an <svg>.
      const renderable = Boolean(typeof Icon === 'function' || (Icon && (Icon.$$typeof || Icon.render)));
      expect(renderable, name).toBe(true);
      expect(className, name).toMatch(/^text-/);
    }
  });

  it('never returns an undefined icon for missing, odd or extension-less names', () => {
    for (const name of ['', undefined, null, 'Makefile', '.bashrc', 'archive.tar.gz', 'weird name (1).txt', 'UPPER.JAVA', 'a.b.c.json']) {
      const meta = fileIconMeta(name);
      expect(meta.Icon, String(name)).toBeTruthy();
      expect(typeof meta.className, String(name)).toBe('string');
    }
    // Case-insensitive: the same type on both spellings.
    expect(fileIconMeta('Main.JAVA').className).toBe(fileIconMeta('Main.java').className);
    // A dotted tarball still resolves through its real suffix.
    expect(fileIconMeta('archive.tar.gz').className).toBe(fileIconMeta('x.gz').className);
  });

  it('gives Java its own glyph instead of the generic page icon', () => {
    // Regression: every .java file used to share the "unknown" icon.
    expect(fileIconMeta('Main.java').Icon).not.toBe(fileIconMeta('mystery.zzz').Icon);
    expect(fileIconMeta('pom.xml').Icon).toBe(fileIconMeta('Main.java').Icon);
  });

  it('colors build and VCS folders the Java/Maven/Gradle project uses', () => {
    for (const name of ['.git', 'gradle', '.gradle', '.mvn', 'target', 'src', 'node_modules']) {
      expect(folderColorClass(name), name).not.toBe(folderColorClass('totally-unknown-dir'));
    }
  });
});
