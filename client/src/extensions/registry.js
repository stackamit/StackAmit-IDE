/**
 * Curated, first-party "extensions" for StackAmit-IDE.
 *
 * This is not a VS Code marketplace (foreign extension hosts are incompatible
 * with a custom Monaco renderer). Instead each entry is a real feature module
 * that drives actual Monaco APIs when installed & enabled — there are no
 * decorative toggles. `activate(ctx)` receives `{ monaco, editor, store }` and
 * returns `{ dispose() }`; the runtime calls dispose when the extension is
 * disabled/uninstalled or the editor goes away.
 */

// ---- Prettier (lazy-loaded so it never breaks app boot) ----
const PRETTIER_LANGS = {
  javascript: 'babel',
  typescript: 'typescript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  markdown: 'markdown',
  yaml: 'yaml',
};

async function loadPrettier() {
  const [prettierMod, babel, estree, ts, html, postcss, markdown, yaml] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/html'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/markdown'),
    import('prettier/plugins/yaml'),
  ]);
  const pick = (m) => m.default || m;
  return {
    prettier: pick(prettierMod),
    plugins: [pick(babel), pick(estree), pick(ts), pick(html), pick(postcss), pick(markdown), pick(yaml)],
  };
}

// ---- helpers for pure editor-option extensions ----
function optionExtension(options, revert) {
  return function activate({ editor }) {
    try {
      editor.updateOptions(options);
    } catch {
      /* editor may be tearing down */
    }
    return {
      dispose() {
        try {
          editor.updateOptions(revert);
        } catch {
          /* ignore */
        }
      },
    };
  };
}

export const EXTENSIONS = [
  {
    id: 'prettier',
    name: 'Prettier',
    publisher: 'StackAmit',
    category: 'Formatters',
    icon: 'Wand2',
    version: '1.0.0',
    license: 'MIT (bundled prettier/standalone)',
    compatibility: ['web', 'desktop'],
    capabilities: ['formatter'],
    description: 'Opinionated formatting for JS, TS, JSON, CSS, SCSS, Less, HTML, Markdown and YAML. Overrides Format Document.',
    keywords: ['format', 'prettier', 'code style'],
    activate({ monaco }) {
      let cancelled = false;
      const disposables = [];
      loadPrettier()
        .then(({ prettier, plugins }) => {
          if (cancelled) return;
          for (const [lang, parser] of Object.entries(PRETTIER_LANGS)) {
            disposables.push(
              monaco.languages.registerDocumentFormattingEditProvider(lang, {
                async provideDocumentFormattingEdits(model) {
                  const text = model.getValue();
                  const formatted = await prettier.format(text, {
                    parser,
                    plugins,
                    semi: true,
                    singleQuote: false,
                    printWidth: 100,
                    tabWidth: model.getOptions ? model.getOptions().tabSize : 4,
                  });
                  return [{ range: model.getFullModelRange(), text: formatted }];
                },
              }),
            );
          }
        })
        .catch((err) => console.warn('[ext:prettier] unavailable:', err?.message || err));
      return {
        dispose() {
          cancelled = true;
          disposables.forEach((d) => {
            try {
              d.dispose();
            } catch {
              /* ignore */
            }
          });
        },
      };
    },
  },
  {
    id: 'extra-themes',
    name: 'Extra Color Themes',
    publisher: 'StackAmit',
    category: 'Themes',
    icon: 'Palette',
    version: '1.0.0',
    license: 'MIT',
    compatibility: ['web', 'desktop'],
    capabilities: ['themes'],
    description: 'Adds Monokai, Dracula and Solarized Light to the theme picker (Settings → Color theme).',
    keywords: ['theme', 'color', 'monokai', 'dracula'],
    // Purely gates PACK_THEMES visibility in the UI; themes are pre-defined.
    activate() {
      return { dispose() {} };
    },
  },
  {
    id: 'todo-tree',
    name: 'Todo Tree',
    publisher: 'StackAmit',
    category: 'Visualization',
    icon: 'ListChecks',
    version: '1.0.0',
    license: 'MIT',
    compatibility: ['web', 'desktop'],
    capabilities: ['decorations'],
    description: 'Highlights TODO / FIXME / HACK / NOTE / XXX comments in the editor and overview ruler.',
    keywords: ['todo', 'fixme', 'annotations'],
    activate({ editor }) {
      const RE = /\b(TODO|FIXME|HACK|NOTE|XXX)\b/;
      // Monaco ICodeEditor has no setDecorations(); use a decorations collection
      // (0.44+) with a deltaDecorations() fallback for older builds.
      const collection =
        typeof editor.createDecorationsCollection === 'function' ? editor.createDecorationsCollection([]) : null;
      let deltaIds = [];
      const applyDecos = (decs) => {
        try {
          if (collection) collection.set(decs);
          else if (typeof editor.deltaDecorations === 'function') deltaIds = editor.deltaDecorations(deltaIds, decs);
        } catch {
          /* editor tearing down */
        }
      };
      const compute = () => {
        const model = typeof editor.getModel === 'function' ? editor.getModel() : null;
        if (!model) {
          applyDecos([]);
          return;
        }
        const decs = [];
        const lines = model.getLineCount();
        for (let i = 1; i <= lines; i += 1) {
          const text = model.getLineContent(i);
          if (RE.test(text)) {
            decs.push({
              // Monaco accepts a plain IRange; OverviewRulerLane.Right === 4.
              range: { startLineNumber: i, startColumn: 1, endLineNumber: i, endColumn: text.length + 1 },
              options: {
                isWholeLine: true,
                className: 'ext-todo-line',
                linesDecorationsClassName: 'ext-todo-glyph',
                overviewRuler: { color: '#cca700', position: 4 },
              },
            });
          }
        }
        applyDecos(decs);
      };
      const d1 = editor.onDidChangeModelContent(compute);
      const d2 = editor.onDidChangeModel(compute);
      compute();
      return {
        dispose() {
          d1.dispose();
          d2.dispose();
          applyDecos([]);
          try {
            collection?.dispose();
          } catch {
            /* ignore */
          }
        },
      };
    },
  },
  {
    id: 'sticky-scroll',
    name: 'Sticky Scroll',
    publisher: 'StackAmit',
    category: 'Editor',
    icon: 'Pin',
    version: '1.0.0',
    license: 'MIT',
    compatibility: ['web', 'desktop'],
    capabilities: ['editor-options'],
    description: 'Pins enclosing scopes (functions, classes) to the top of the editor while you scroll.',
    keywords: ['scroll', 'outline'],
    activate: optionExtension({ stickyScroll: { enabled: true } }, { stickyScroll: { enabled: false } }),
  },
  {
    id: 'indent-guides',
    name: 'Indent Guides',
    publisher: 'StackAmit',
    category: 'Editor',
    icon: 'AlignLeft',
    version: '1.0.0',
    license: 'MIT',
    compatibility: ['web', 'desktop'],
    capabilities: ['editor-options'],
    description: 'Draws vertical guides for indentation levels and active bracket pairs.',
    keywords: ['indent', 'guides'],
    activate: optionExtension(
      { guides: { indentation: true, bracketPairs: true } },
      { guides: { indentation: false, bracketPairs: false } },
    ),
  },
  {
    id: 'color-highlight',
    name: 'Color Highlight',
    publisher: 'StackAmit',
    category: 'Editor',
    icon: 'Droplet',
    version: '1.0.0',
    license: 'MIT',
    compatibility: ['web', 'desktop'],
    capabilities: ['editor-options'],
    description: 'Renders a swatch next to CSS/hex colors like #ff0000 and rgb() values.',
    keywords: ['color', 'css'],
    activate: optionExtension({ colorDecorators: true }, { colorDecorators: false }),
  },
  {
    id: 'file-icons',
    name: 'file-icons',
    publisher: 'StackAmit',
    category: 'Visualization',
    icon: 'FileType',
    version: '1.0.0',
    license: 'MIT',
    compatibility: ['web', 'desktop'],
    capabilities: ['explorer-icons'],
    // Built-in baseline: the Explorer's file/folder icons are part of the
    // editor's identity, not an opt-on-install extra, so this ships installed
    // and enabled on a fresh profile (a user can still turn it off, and that
    // choice persists). See `builtinExtensionDefaults()` below.
    builtin: true,
    description: 'Shows distinct, color-coded icons for file types and folders in the Explorer sidebar.',
    keywords: ['icons', 'explorer', 'files', 'folders'],
    // Purely gates the per-file-type icon mapping in FileExplorer (see utils/fileIcons.js);
    // the icons themselves are real lucide-react glyphs rendered by the Explorer.
    activate() {
      return { dispose() {} };
    },
  },
  {
    id: 'whitespace-visible',
    name: 'Whitespace Visibility',
    publisher: 'StackAmit',
    category: 'Editor',
    icon: 'Pilcrow',
    version: '1.0.0',
    license: 'MIT',
    compatibility: ['web', 'desktop'],
    capabilities: ['editor-options'],
    description: 'Always renders spaces and tabs as visible dots/arrows, not just on selection.',
    keywords: ['whitespace', 'render'],
    activate: optionExtension({ renderWhitespace: 'all' }, { renderWhitespace: 'selection' }),
  },
];

export const CATEGORIES = ['All', 'Formatters', 'Themes', 'Visualization', 'Editor'];

export function extensionById(id) {
  return EXTENSIONS.find((e) => e.id === id) || null;
}

/** ids of installed+enabled extensions, in registry order. */
export function activeExtensionIds(extensions) {
  return EXTENSIONS.filter((e) => extensions[e.id]?.installed && extensions[e.id]?.enabled).map((e) => e.id);
}

/**
 * Install/enable state that ships with the app: entries flagged `builtin` are
 * installed and enabled unless the stored profile says otherwise. Keeping this
 * as a pure function means a fresh profile (and a packaged build with an empty
 * localStorage) still renders the Explorer icons instead of a wall of identical
 * page glyphs, while an explicit `enabled: false` from the user is honoured.
 */
export function builtinExtensionDefaults() {
  const defaults = {};
  for (const e of EXTENSIONS) {
    if (e.builtin) defaults[e.id] = { installed: true, enabled: true, version: e.version, builtin: true };
  }
  return defaults;
}

/** Merge stored state over the built-in defaults (stored wins when present). */
export function resolveExtensionState(stored) {
  const base = builtinExtensionDefaults();
  const out = { ...base };
  for (const [id, st] of Object.entries(stored || {})) {
    if (!st || typeof st !== 'object') continue;
    out[id] = { ...out[id], ...st };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Registry adapters
//
// The curated catalog above is the only source this build EXECUTES (its
// activate() functions are first-party code reviewed in this repo). Foreign
// registries (e.g. a future Open VSX-style adapter) plug in through
// createRegistryAdapter: their entries are *listed* for discovery but
// sanitized — any activate/code property is stripped and the entry is marked
// quarantined, because running untrusted extension code inside the renderer
// would bypass every isolation boundary we hold to. A real extension host
// (isolated process) is the prerequisite for lifting that restriction.
// ---------------------------------------------------------------------------

export const curatedAdapter = {
  id: 'curated-stackamit',
  name: 'StackAmit curated catalog',
  trust: 'first-party',
  async list() {
    return EXTENSIONS.map((e) => ({ ...e, source: 'curated-stackamit', quarantined: false }));
  },
};

export function createRegistryAdapter({ id, name, fetchManifest }) {
  if (typeof id !== 'string' || typeof fetchManifest !== 'function') {
    throw new Error('A registry adapter needs an id and a fetchManifest() function.');
  }
  return {
    id,
    name: name || id,
    trust: 'untrusted',
    async list() {
      const raw = await fetchManifest();
      const items = Array.isArray(raw) ? raw : Array.isArray(raw?.extensions) ? raw.extensions : [];
      return items
        .filter((e) => e && typeof e.id === 'string' && typeof e.version === 'string')
        .map((e) => {
          const { activate, ...safe } = e; // strip executable surface
          return { ...safe, source: id, quarantined: true, activate: undefined };
        });
    },
  };
}

/** Aggregate a catalog across adapters; curated wins on id collisions. */
export async function listCatalog(adapters = [curatedAdapter]) {
  const byId = new Map();
  const errors = [];
  for (const a of adapters) {
    try {
      for (const e of await a.list()) {
        const prev = byId.get(e.id);
        if (!prev || (prev.quarantined && !e.quarantined)) byId.set(e.id, e);
      }
    } catch (err) {
      errors.push({ adapter: a.id, message: err?.message || 'registry unavailable' });
    }
  }
  return { entries: [...byId.values()], errors };
}

/** Numeric-segment semver-ish compare: >0 when a is newer than b. */
export function compareVersions(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i] || 0);
    const nb = Number(pb[i] || 0);
    if (na !== nb) return na - nb;
  }
  return 0;
}

/**
 * Real update check against the given catalog: an installed extension has an
 * update when the catalog advertises a higher version than the one captured
 * at install time. With the bundled curated catalog the versions are equal —
 * the honest answer is then "up to date", not an invented upgrade.
 */
export function updatesAvailable(catalog, installedState) {
  const updates = [];
  for (const [id, st] of Object.entries(installedState || {})) {
    if (!st?.installed) continue;
    const entry = catalog.find((e) => e.id === id);
    if (entry && st.version && compareVersions(entry.version, st.version) > 0) {
      updates.push({ id, from: st.version, to: entry.version, quarantined: Boolean(entry.quarantined) });
    }
  }
  return updates;
}

export default EXTENSIONS;
