import { describe, it, expect } from 'vitest';
import {
  parseJsonc,
  positionToLineCol,
  importSpecifiers,
  packageNameOf,
  detectProject,
  projectDiagnostics,
  previewStrategyFor,
} from '../projectModel.js';

describe('projectModel — JSONC parsing (real tsconfig/package.json)', () => {
  it('parses plain JSON and reports positions cleanly', () => {
    expect(parseJsonc('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('tolerates comments and trailing commas without touching string contents', () => {
    const src = '{\n  // a comment\n  "url": "https://x//y", /* block */\n  "n": 1,\n}';
    const res = parseJsonc(src);
    expect(res.ok).toBe(true);
    expect(res.value.url).toBe('https://x//y'); // the // inside the string survived
    expect(res.value.n).toBe(1);
  });

  it('reports invalid JSON as invalid rather than throwing', () => {
    const res = parseJsonc('{ oops }');
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe('string');
  });

  it('maps a byte position to a 1-based line/column', () => {
    const text = 'one\ntwo\nthree';
    expect(positionToLineCol(text, 0)).toEqual({ line: 1, column: 1 });
    expect(positionToLineCol(text, 4)).toEqual({ line: 2, column: 1 });
    expect(positionToLineCol(text, 8)).toEqual({ line: 3, column: 1 });
    expect(positionToLineCol(text, 9)).toEqual({ line: 3, column: 2 });
  });
});

describe('projectModel — import scanning', () => {
  it('lists every specifier with the line it appears on', () => {
    const src = "import a from 'x';\n// import b from 'y';\nimport c from './z.js';\nexport * from 'w';";
    const specs = importSpecifiers(src);
    expect(specs.some((s) => s.specifier === 'x' && s.line === 1)).toBe(true);
    expect(specs.some((s) => s.specifier === 'w')).toBe(true);
  });

  it('resolves scoped and subpath packages to their manifest name', () => {
    expect(packageNameOf('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(packageNameOf('lodash.get')).toBe('lodash.get');
    expect(packageNameOf('./rel.js')).toBeNull();
    expect(packageNameOf('/abs.js')).toBeNull();
    expect(packageNameOf('https://cdn/m.js')).toBeNull();
  });
});

describe('projectModel — detectProject', () => {
  it('classifies a plain static-web folder', () => {
    const p = detectProject([{ path: '/w/index.html', content: '<p>x</p>' }]);
    expect(p.kind).toBe('static-web');
    expect(p.hasPackageJson).toBe(false);
    expect(p.framework).toBeNull();
  });

  it('recognises a Vite/React project and its dev script', () => {
    const pkg = JSON.stringify({
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { react: '^18', 'react-dom': '^18' },
      devDependencies: { vite: '^5' },
    });
    const p = detectProject([{ path: '/w/package.json', content: pkg }]);
    expect(p.kind).toBe('framework');
    expect(p.framework).toBe('vite');
    expect(p.hasReact).toBe(true);
    expect(p.moduleType).toBe('module');
    expect(p.devServerScript).toBe('dev');
  });

  it('flags a malformed package.json instead of pretending it is absent', () => {
    const p = detectProject([{ path: '/w/package.json', content: '{ broken' }]);
    expect(p.hasPackageJson).toBe(true);
    expect(p.packageJsonValid).toBe(false);
  });
});

describe('projectModel — browser-honest diagnostics', () => {
  it('names a missing dependency the project imports', () => {
    const pkg = JSON.stringify({ dependencies: { react: '^18' } });
    const project = detectProject([{ path: '/w/package.json', content: pkg }]);
    const markers = projectDiagnostics({
      project,
      documents: [{ path: '/w/App.jsx', content: "import _ from 'lodash'; export default () => null;" }],
    });
    const missing = markers.find((m) => m.code === 'stackamit-missing-dependency');
    expect(missing).toBeTruthy();
    expect(missing.message).toMatch(/lodash/);
    expect(missing.message).toMatch(/npm install lodash/);
  });

  it('does not invent a missing-dependency error with no package.json', () => {
    const project = detectProject([{ path: '/w/index.html', content: '' }]);
    const markers = projectDiagnostics({
      project,
      documents: [{ path: '/w/main.js', content: "import _ from 'lodash';" }],
    });
    // No manifest → nothing to compare against; the browser cannot install, but
    // a bare import in a static folder is a different, module-script note.
    expect(markers.some((m) => m.code === 'stackamit-missing-dependency')).toBe(false);
  });

  it('warns about a Node built-in being imported in the browser', () => {
    const project = detectProject([{ path: '/w/package.json', content: '{}' }]);
    const markers = projectDiagnostics({
      project,
      documents: [{ path: '/w/s.js', content: "import fs from 'node:fs';" }],
    });
    expect(markers.some((m) => m.code === 'stackamit-node-builtin')).toBe(true);
  });

  it('explains the require()/ESM mismatch a "type":"module" project hits', () => {
    const pkg = JSON.stringify({ type: 'module' });
    const project = detectProject([{ path: '/w/package.json', content: pkg }]);
    const markers = projectDiagnostics({
      project,
      documents: [{ path: '/w/legacy.js', content: "const x = require('y');" }],
    });
    expect(markers.some((m) => m.code === 'stackamit-module-type')).toBe(true);
  });
});

describe('projectModel — preview strategy', () => {
  it('says a framework project needs a dev server a page cannot start', () => {
    const pkg = JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^5' } });
    const project = detectProject([{ path: '/w/package.json', content: pkg }]);
    const s = previewStrategyFor(project);
    expect(s.mode).toBe('needs-dev-server');
    expect(s.reason).toMatch(/development server/);
  });

  it('lets a static folder preview in the browser', () => {
    const project = detectProject([{ path: '/w/index.html', content: '' }]);
    expect(previewStrategyFor(project).mode).toBe('static');
  });
});
