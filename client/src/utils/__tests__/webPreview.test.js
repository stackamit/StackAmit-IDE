import { describe, it, expect } from 'vitest';
import { buildWebPreviewDoc, isPreviewMessage } from '../webPreview.js';

const FILES = {
  '/site/index.html': null, // provided per test
  '/site/style.css': 'body { background: lime }',
  '/site/app.js': 'console.log("hi")',
  '/site/js/main.js': 'var x = 1',
};

function read(abs) {
  return abs in FILES ? FILES[abs] : null;
}

describe('web in-browser preview builder (no fake server)', () => {
  it('inlines relative stylesheets and classic scripts', () => {
    const html = '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><script src="js/main.js"></script></body></html>';
    const { doc, inlined, unsupported } = buildWebPreviewDoc(html, '/site/index.html', read);
    expect(doc).toContain('background: lime');
    expect(doc).toContain('var x = 1');
    expect(doc).not.toContain('<link');
    expect(inlined).toContain('/site/style.css');
    expect(inlined).toContain('/site/js/main.js');
    expect(unsupported).toEqual([]);
  });

  it('resolves ../ segments and root-relative hrefs against the entry dir', () => {
    const html = '<link rel="stylesheet" href="../shared.css"><script src="/site/app.js"></script>';
    const { inlined } = buildWebPreviewDoc(html, '/site/pages/index.html', (abs) =>
      abs === '/site/shared.css' || abs === '/site/app.js' ? 'x' : null,
    );
    expect(inlined).toEqual(['/site/shared.css', '/site/app.js']);
  });

  it('reports missing files honestly instead of silently dropping them', () => {
    const html = '<link rel="stylesheet" href="ghost.css"><img src="/images/pic.png">';
    const { unsupported } = buildWebPreviewDoc(html, '/site/index.html', read);
    expect(unsupported.join(' ')).toMatch(/ghost\.css/);
    expect(unsupported.join(' ')).toMatch(/pic\.png/);
  });

  it('injects the console/error forwarder and the honest local-preview note', () => {
    const { doc } = buildWebPreviewDoc('<p>x</p>', '/site/index.html', read);
    expect(doc).toContain('__stackamitPreview');
    expect(doc).toContain('postMessage');
    expect(doc).toContain('In-browser preview');
    expect(doc).not.toMatch(/<template>/);
  });

  it('links a module script into the in-page graph and runs it with no server', () => {
    const html = '<script type="module" src="app.js"></script>';
    const { doc, inlined, unsupported, modules } = buildWebPreviewDoc(html, '/site/index.html', read);
    // The module is no longer declared unsupported: it ships through the
    // embedded JSON map, and the loader materialises it as a blob: URL.
    expect(modules).toContain('/site/app.js');
    expect(inlined).toContain('/site/app.js');
    expect(unsupported).toEqual([]);
    expect(doc).toContain('id="stackamit-modules"');
    expect(doc).toContain('URL.createObjectURL');
    expect(doc).toContain('blob:');
    // The marker note says the honest thing for a module project.
    expect(doc).toContain('modules loaded as blob: URLs');
  });

  it('walks a multi-file ESM graph and rewrites relative specifiers to tokens', () => {
    const files = {
      '/site/index.html': null,
      '/site/main.js': "import { greet } from './lib/greet.js'; console.log(greet);",
      '/site/lib/greet.js': "export const greet = 'hi';",
    };
    const read2 = (abs) => (abs in files ? files[abs] : null);
    const { doc, modules, unsupported } = buildWebPreviewDoc(
      '<script type="module" src="main.js"></script>',
      '/site/index.html',
      read2,
    );
    expect(modules).toContain('/site/main.js');
    expect(unsupported).toEqual([]);
    // The child module is collected and the parent's specifier became a token
    // the in-page loader resolves, so a real relative import links offline.
    expect(doc).toContain('/site/lib/greet.js');
    expect(doc).toMatch(/__STACKAMIT_MODULE__\/site\/lib\/greet\.js/);
  });

  it('reports a bare npm specifier honestly instead of silently dropping it', () => {
    const files = {
      '/site/index.html': null,
      '/site/main.js': "import lodash from 'lodash'; console.log(lodash);",
    };
    const read2 = (abs) => (abs in files ? files[abs] : null);
    const { unsupported } = buildWebPreviewDoc(
      '<script type="module" src="main.js"></script>',
      '/site/index.html',
      read2,
    );
    // A page has no package resolution: the import is left for the browser to
    // fail on, and the panel is told why, rather than a fake bundle being made.
    expect(unsupported.join(' ')).toMatch(/lodash/);
    expect(unsupported.join(' ')).toMatch(/npm package names/i);
  });

  it('flags a classic script that uses import/export syntax', () => {
    const files = { '/site/index.html': null, '/site/legacy.js': "import x from 'y'; console.log(x);" };
    const read2 = (abs) => (abs in files ? files[abs] : null);
    const { unsupported } = buildWebPreviewDoc('<script src="legacy.js"></script>', '/site/index.html', read2);
    expect(unsupported.join(' ')).toMatch(/type="module"/);
  });
});

describe('isPreviewMessage (sandboxed iframe postMessage validation)', () => {
  const frame = { id: 'preview-frame' };
  const msg = (data, source) => ({ data, source });

  it('accepts the agreed marker only from the frame that produced it', () => {
    expect(isPreviewMessage(msg({ __stackamitPreview: 1, type: 'error', text: 'boom' }, frame), frame)).toBe(true);
  });

  it('rejects messages from any other window', () => {
    const other = { id: 'unrelated-frame' };
    expect(isPreviewMessage(msg({ __stackamitPreview: 1, type: 'error', text: 'spoof' }, other), frame)).toBe(false);
  });

  it('rejects a missing source window and foreign payloads', () => {
    expect(isPreviewMessage(msg({ __stackamitPreview: 1 }, null), frame)).toBe(false);
    expect(isPreviewMessage(msg({ __stackamitPreview: 1, text: 'x' }, frame), undefined)).toBe(false);
    expect(isPreviewMessage(msg({ hello: 'world' }, frame), frame)).toBe(false);
    expect(isPreviewMessage(undefined, frame)).toBe(false);
  });
});
