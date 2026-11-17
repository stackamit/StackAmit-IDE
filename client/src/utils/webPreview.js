/**
 * Web-mode in-browser preview builder.
 *
 * A browser genuinely cannot start a local Windows process — so web mode does
 * NOT pretend to. There is no "local server" claim here: the builder reads the
 * virtual workspace, inlines relative stylesheets and classic scripts into one
 * self-contained document, and renders it in a sandboxed iframe (srcDoc).
 *
 * ES modules are supported the way a browser supports them, without a server:
 * every module of the import graph is shipped inside the document as data, and a
 * small in-page loader turns each file into a `blob:` module URL and rewrites the
 * import specifiers to those URLs. `blob:` URLs must be created by the preview
 * document itself (an opaque-origin frame cannot read a blob its parent made),
 * which is why the loader runs inside rather than here.
 *
 * What still cannot work is reported instead of hidden: npm specifiers (no
 * import map, no package resolution), `fetch()` of workspace files (no HTTP
 * origin), and anything a framework build step would have produced.
 */

/** Inserted as a script body via textContent (never innerHTML). */
const FORWARDER = `
(function () {
  function send(type, text) {
    try { parent.postMessage({ __stackamitPreview: 1, type: type, text: String(text).slice(0, 2000) }, '*'); } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    if (e && e.target !== window && e.target.getAttribute && e.target.getAttribute('src')) {
      send('error', 'Failed to load: ' + e.target.getAttribute('src'));
    } else if (e) {
      send('error', (e.message || 'Script error') + ' (' + (e.filename || 'inline') + ':' + (e.lineno || 0) + ')');
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) { send('error', 'Unhandled promise: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)); });
  ['error', 'warn'].forEach(function (lvl) {
    var orig = console[lvl];
    console[lvl] = function () { send(lvl, Array.prototype.slice.call(arguments).join(' ')); if (orig) orig.apply(console, arguments); };
  });
  window.addEventListener('load', function () { send('info', 'document loaded'); });
})();`;

/**
 * The in-page module loader. It reads the JSON module map, materialises each
 * file as a blob URL and rewrites the `__STACKAMIT_MODULE__/<path>` markers the
 * builder left in the specifiers. Errors name the file that failed, because a
 * blob URL in a stack trace would tell the user nothing.
 */
const MODULE_LOADER = `
(function () {
  var node = document.getElementById('stackamit-modules');
  if (!node) return;
  var mods;
  var entries;
  try { var data = JSON.parse(node.textContent); mods = data.modules || {}; entries = data.entries || []; } catch (e) { return; }
  var urls = {};
  var busy = {};
  function mk(abs) {
    if (urls[abs]) return urls[abs];
    if (busy[abs]) throw new Error('Import cycle at ' + abs + ': the in-browser preview cannot link it. The desktop Go Live server serves it the way a real web server does.');
    busy[abs] = 1;
    var body = String(mods[abs].code).replace(/__STACKAMIT_MODULE__\\/([^"'\\\\]*)/g, function (all, p) {
      var key = '/' + String(p).replace(/^\\/+/, '');
      if (!(key in mods)) return all;
      return mk(key);
    });
    delete busy[abs];
    var url = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    urls[abs] = url;
    return url;
  }
  (entries || []).forEach(function (abs) {
    if (!(abs in mods)) return;
    var s = document.createElement('script');
    s.type = 'module';
    try { s.src = mk(abs); } catch (err) {
      parent.postMessage({ __stackamitPreview: 1, type: 'error', text: String(err.message || err) }, '*');
      return;
    }
    s.dataset.stackamitModule = abs;
    document.body.appendChild(s);
  });
})();`;

// Marker written into module sources; the loader replaces it with a blob URL.
const MODULE_TOKEN = '__STACKAMIT_MODULE__/';

function normalizeRel(baseDir, href) {
  const parts = (baseDir + '/' + href).split('/');
  const out = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return '/' + out.join('/');
}

/** Resolve an asset href against the entry dir; '/'-prefixed hrefs are root-relative. */
function resolveAsset(baseDir, href) {
  const h = href.replace(/^\.\/(.*)$/, '$1');
  if (h.startsWith('/')) return normalizeRel('', h);
  return normalizeRel(baseDir, h);
}

/** Absolute VFS path for a module specifier, or null when it is not a file. */
function specifierAbs(dir, spec) {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*?:/.test(spec)) return null; // http:, data:, node: …
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // bare npm name
  return resolveAsset(dir, spec);
}

const SPECIFIER_RE =
  /(\bfrom\s*)(['"])([^'"]+)\2|(\bimport\s*\(\s*)(['"])([^'"]+)\5|(\bimport\s+)(['"])([^'"]+)\8/g;

/**
 * Rewrite the resolvable specifiers of one module to builder tokens, and collect
 * the files it depends on. Unresolvable specifiers are left untouched on
 * purpose: the browser then produces its own real error, which the forwarder
 * shows, instead of the app guessing at the outcome.
 */
function rewriteModule(code, absPath, readFile, unsupported) {
  const dir = absPath.slice(0, absPath.lastIndexOf('/'));
  const deps = [];
  const out = String(code).replace(SPECIFIER_RE, (match, p1, q1, s1, p2, q2, s2, p3, q3, s3) => {
    const spec = s1 ?? s2 ?? s3;
    const lead = p1 ?? p2 ?? p3 ?? '';
    const quote = q1 ?? q2 ?? q3 ?? "'";
    const abs = specifierAbs(dir, spec);
    if (!abs) {
      if (!/^[a-zA-Z][a-zA-Z\d+.-]*?:/.test(spec)) {
        unsupported.push(`import '${spec}' in ${absPath}: a browser resolves URLs, not npm package names (no import map is installed)`);
      }
      return match;
    }
    if (readFile(abs) === null) {
      unsupported.push(`import '${spec}' in ${absPath}: that file is not in the browser workspace`);
      return match;
    }
    deps.push(abs);
    return `${lead}${quote}${MODULE_TOKEN}${abs.slice(1)}${quote}`;
  });
  return { code: out, deps };
}

/**
 * Walk the module graph, filling `mods` with path → tokenised source. The entry
 * is recorded before its imports are followed, so a cycle terminates here and
 * the loader reports it as the link failure it is.
 */
function collectModules(entryAbs, readFile, mods, unsupported) {
  if (mods[entryAbs]) return;
  const text = readFile(entryAbs);
  if (text === null) return;
  const { code, deps } = rewriteModule(text, entryAbs, readFile, unsupported);
  mods[entryAbs] = { code };
  for (const d of deps) collectModules(d, readFile, mods, unsupported);
}

/** Escape a string so it can sit inside a <script type="application/json">. */
function embedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
}

/**
 * @param {string} html source of the entry document
 * @param {string} entryPath absolute VFS path of the entry html (for base dir)
 * @param {(absPath: string) => string | null} readFile absolute VFS path → content or null
 * @returns {{ doc: string, inlined: string[], unsupported: string[], modules: string[] }}
 */
export function buildWebPreviewDoc(html, entryPath, readFile) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(html, 'text/html');
  const inlined = [];
  const unsupported = [];
  const baseDir = entryPath.slice(0, entryPath.lastIndexOf('/'));
  const mods = {};
  const moduleEntries = [];

  for (const link of Array.from(dom.querySelectorAll('link[rel="stylesheet"]'))) {
    const href = link.getAttribute('href') || '';
    const abs = resolveAsset(baseDir, href);
    const css = readFile(abs);
    if (css === null) {
      unsupported.push(`stylesheet ${href} (not in the browser workspace)`);
      continue;
    }
    const style = dom.createElement('style');
    style.textContent = css;
    link.replaceWith(style);
    inlined.push(abs);
  }

  for (const script of Array.from(dom.querySelectorAll('script[src]'))) {
    const src = script.getAttribute('src') || '';
    const isModule = script.getAttribute('type') === 'module';
    const abs = resolveAsset(baseDir, src);
    const js = readFile(abs);
    if (js === null) {
      unsupported.push(`script ${src} (not in the browser workspace)`);
      continue;
    }
    if (isModule) {
      // Ship it through the module map: its own imports get resolved too, so a
      // multi-file ESM project genuinely runs with no server.
      collectModules(abs, readFile, mods, unsupported);
      moduleEntries.push(abs);
      script.remove();
      inlined.push(abs);
      continue;
    }
    const out = dom.createElement('script');
    out.textContent = js;
    script.replaceWith(out);
    inlined.push(abs);
    // A classic script with import/export would be a syntax error the browser
    // reports; say which rule applies instead of letting that confuse the user.
    if (/^\s*(?:import|export)\s/m.test(js)) {
      unsupported.push(`${src} uses import/export but is loaded without type="module": use <script type="module" src="…">`);
    }
  }

  if (moduleEntries.length) {
    const data = dom.createElement('script');
    data.type = 'application/json';
    data.id = 'stackamit-modules';
    data.textContent = embedJson({ modules: mods, entries: moduleEntries });
    dom.body.appendChild(data);

    const loader = dom.createElement('script');
    loader.textContent = MODULE_LOADER;
    dom.body.appendChild(loader);
  }

  // Any remaining root-relative asset (img/audio/…) cannot be served without
  // a real HTTP server — report it instead of silently 404ing.
  for (const el of dom.querySelectorAll('img[src]')) {
    const src = el.getAttribute('src') || '';
    if (src.startsWith('/') && readFile(resolveAsset(baseDir, src)) === null) {
      unsupported.push(`image ${src} (not in the browser workspace)`);
    }
  }

  if (!dom.head) dom.documentElement?.appendChild(dom.createElement('head'));
  const marker = dom.createElement('div');
  marker.id = 'stackamit-preview-note';
  marker.style.cssText = 'position:fixed;left:0;right:0;bottom:0;font:11px/1.4 system-ui;background:#0f172acc;color:#94a3b8;padding:2px 8px;z-index:2147483647';
  marker.textContent = moduleEntries.length
    ? 'In-browser preview — modules loaded as blob: URLs, no server was started.'
    : 'In-browser preview — files stay local, no server was started (Go Live is desktop).';
  dom.body?.appendChild(marker);
  const fwd = dom.createElement('script');
  fwd.textContent = FORWARDER;
  dom.head.appendChild(fwd);

  return {
    doc: '<!doctype html>\n' + dom.documentElement.outerHTML,
    inlined,
    unsupported,
    modules: moduleEntries,
  };
}

/**
 * Validate a message forwarded out of the sandboxed preview iframe. Mirrors the
 * check browserRun.js makes: accept the agreed marker *and* require the sender
 * to be the very frame we created, so no other window can inject console lines.
 */
export function isPreviewMessage(event, sourceWindow) {
  const d = event && event.data;
  return Boolean(d && d.__stackamitPreview === 1 && sourceWindow && event.source === sourceWindow);
}

export default buildWebPreviewDoc;
