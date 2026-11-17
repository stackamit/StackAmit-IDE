/**
 * Project model for the browser workspace.
 *
 * A folder of files is not a project until something describes it, and in Web
 * Mode the app has no package manager and no build: it must therefore *read*
 * what the project declares (`package.json`, `tsconfig.json`, an HTML entry) and
 * report honestly what that means, instead of applying a preset that overrides
 * the user's own configuration.
 *
 * Everything here is pure: given file contents it returns a description and
 * diagnostics. It never claims a dependency exists and never invents a build.
 */

/** Parse JSON that may carry comments/trailing commas (`.jsonc`, real tsconfig). */
export function parseJsonc(text) {
  const raw = String(text ?? '');
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    /* fall through to the tolerant parse */
  }
  // Strip // and /* */ comments, then trailing commas, keeping string literals
  // and their contents untouched.
  let out = '';
  let inStr = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inLine) {
      if (ch === '\n') { inLine = false; out += ch; }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i++; }
      else if (ch === '\n') out += ch; // keep line numbering for error positions
      continue;
    }
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += raw[i + 1] ?? ''; i++; }
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    out += ch;
  }
  const noTrailing = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return { ok: true, value: JSON.parse(noTrailing) };
  } catch (e) {
    return { ok: false, error: e.message || 'Invalid JSON', broken: noTrailing };
  }
}

/** Position N of a JSON.parse message -> 1-based line/column in the document. */
export function positionToLineCol(text, position) {
  const upto = String(text ?? '').slice(0, Math.max(0, Math.min(position, String(text ?? '').length)));
  const lines = upto.split('\n');
  return { line: lines.length, column: (lines[lines.length - 1] || '').length + 1 };
}

const IMPORT_RE = /(?:^|[\s;])(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|(?:^|[\s;])import\s+['"]([^'"]+)['"]|(?:^|[\s;])import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** Every import specifier in a JS/TS module, with the line it appears on. */
export function importSpecifiers(source) {
  const out = [];
  const lines = String(source ?? '').split('\n');
  const re = new RegExp(IMPORT_RE.source, 'g');
  lines.forEach((line, i) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const spec = m[1] || m[2] || m[3];
      if (spec) out.push({ specifier: spec, line: i + 1 });
    }
  });
  return out;
}

/** The package name of a specifier (`@scope/pkg/sub` → `@scope/pkg`). */
export function packageNameOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || /^[a-zA-Z][a-zA-Z\d+.-]*?:/.test(specifier)) {
    return null; // relative / absolute / url-like — resolved by the environment
  }
  const bare = specifier.replace(/^node:/, '');
  const parts = bare.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Describe the project the workspace files declare.
 *
 * `files` is a `{ path, content }` list of the descriptor files that exist.
 * The result is a description only: it never starts, promises or fakes a server.
 */
export function detectProject(files = []) {
  const byName = new Map();
  for (const f of files) {
    const name = String(f.path).split(/[\\/]/).pop().toLowerCase();
    if (!byName.has(name)) byName.set(name, f);
  }
  const pkgFile = byName.get('package.json');
  const tsFile = byName.get('tsconfig.json');
  const pkg = pkgFile ? parseJsonc(pkgFile.content) : { ok: false, value: null };
  const tsconfig = tsFile ? parseJsonc(tsFile.content) : { ok: false, value: null };

  const manifest = pkg.ok ? pkg.value || {} : {};
  const deps = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
  const scripts = Object.keys(manifest.scripts || {});
  const hasReact = Boolean(deps.react);
  const hasVite = Boolean(deps.vite || deps['@vitejs/plugin-react'] || deps.vitest);
  const hasFramework = hasVite || hasReact || Boolean(deps['@angular/core']) || Boolean(deps.svelte) || Boolean(deps.vue) || Boolean(deps.next);

  let kind = 'plain';
  if (hasFramework) kind = 'framework';
  else if (manifest.type === 'module' || manifest.type === 'commonjs') kind = 'node';
  else if (byName.get('index.html')) kind = 'static-web';

  const devServerScript = scripts.find((s) => /^(dev|start|serve|preview)$/.test(s));

  return {
    kind,
    hasPackageJson: Boolean(pkgFile),
    packageJsonPath: pkgFile ? pkgFile.path : null,
    tsconfigPath: tsFile ? tsFile.path : null,
    hasReact,
    packageJsonValid: pkgFile ? pkg.ok : null,
    packageJsonError: pkgFile && !pkg.ok ? pkg.error : null,
    moduleType: manifest.type === 'module' ? 'module' : manifest.type === 'commonjs' ? 'commonjs' : null,
    name: manifest.name || null,
    dependencies: deps,
    dependencyNames: Object.keys(deps),
    scripts,
    devServerScript: devServerScript || null,
    framework: hasVite ? 'vite' : hasReact ? 'react' : deps.next ? 'next' : deps.vue ? 'vue' : deps.svelte ? 'svelte' : deps['@angular/core'] ? 'angular' : null,
    hasTsconfig: Boolean(tsFile),
    tsconfigValid: tsFile ? tsconfig.ok : null,
    tsconfigError: tsFile && !tsconfig.ok ? tsconfig.error : null,
    tsconfigOptions: (tsconfig.value && tsconfig.value.compilerOptions) || {},
    tsconfigModules: (tsconfig.value && tsconfig.value.modules) || null,
  };
}

/**
 * Diagnostics a browser-only IDE can state with certainty from the project
 * files it holds. Deliberately narrow: a missing `node_modules` is not a code
 * error, so it is reported as what it is (the browser has no package manager),
 * and nothing here duplicates Monaco's own TypeScript syntactic checking.
 */
export function projectDiagnostics({ project, documents = [] } = {}) {
  const markers = [];
  const push = (path, line, column, message, severity = 'error', code = 'stackamit-project') => {
    if (!path) return;
    markers.push({ path, line: line || 1, column: column || 1, message, severity, code });
  };

  if (project.hasPackageJson && !project.packageJsonValid) {
    push(project.packageJsonPath, 1, 1, `package.json is not valid JSON: ${project.packageJsonError}`);
  }
  if (project.hasTsconfig && !project.tsconfigValid) {
    push(project.tsconfigPath, 1, 1, `tsconfig.json is not valid JSON: ${project.tsconfigError}`);
  }

  const declared = new Set(project.dependencyNames || []);
  const missing = new Set();

  for (const doc of documents) {
    if (!/\.(m|c)?[jt]sx?$/i.test(doc.path)) continue;
    const isJs = /\.m?jsx?$/i.test(doc.path);
    const specs = importSpecifiers(doc.content);
    for (const { specifier, line } of specs) {
      if (specifier.startsWith('node:')) {
        push(doc.path, line, 1, `'${specifier}' is a Node.js built-in module. The browser cannot resolve it; run this file through the API server (Node) or the desktop app.`, 'warning', 'stackamit-node-builtin');
        continue;
      }
      const pkg = packageNameOf(specifier);
      if (!pkg) continue;
      if (project.hasPackageJson && !declared.has(pkg)) {
        missing.add(pkg);
        push(doc.path, line, 1, `Cannot find package '${pkg}': it is imported here but is not listed in package.json dependencies. Install it with \`npm install ${pkg}\`.`, 'error', 'stackamit-missing-dependency');
      }
    }

    const usesEsm = specs.length > 0 || /\bexport\s+(default|const|function|class)/.test(doc.content);
    const usesCjs = /\brequire\s*\(/.test(doc.content) || /\bmodule\.exports\b/.test(doc.content);
    if (project.moduleType === 'module' && usesCjs && isJs) {
      push(doc.path, 1, 1, 'package.json sets "type": "module", so this .js file is an ES module and require() is unavailable. Use import, or rename to .cjs.', 'error', 'stackamit-module-type');
    }
    if (project.moduleType === 'commonjs' && usesEsm && isJs && !/\.mjs$/i.test(doc.path)) {
      push(doc.path, 1, 1, 'package.json sets "type": "commonjs", so this .js file is treated as CommonJS; import/export needs "type": "module" or a .mjs extension.', 'error', 'stackamit-module-type');
    }
    if (project.moduleType === null && usesEsm && isJs && project.kind === 'static-web') {
      // Static web folder: an import in a classic <script> never runs; the tag
      // needs type="module". Only stated where the project really is a plain
      // web folder, so a Node project is not told about a browser rule.
      push(doc.path, 1, 1, 'A plain HTML <script> does not support import/export. Load it with <script type="module">, which the Live Preview honours.', 'info', 'stackamit-module-script');
    }
    if (/\.(jsx|tsx)$/i.test(doc.path) && !project.hasPackageJson) {
      push(doc.path, 1, 1, `${doc.path.split(/[\\/]/).pop()} is JSX, which no browser runs directly: it needs a framework build (e.g. Vite) or the desktop app's toolchain.`, 'warning', 'stackamit-jsx');
    } else if (/\.(jsx|tsx)$/i.test(doc.path) && !project.hasReact) {
      push(doc.path, 1, 1, 'A JSX file is present but package.json does not declare react, so a framework build would not find it.', 'warning', 'stackamit-jsx');
    }
  }

  // The same message per package, not per import line — one problem, one line.
  const seen = new Set();
  return markers.filter((m) => {
    const k = `${m.path}:${m.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Whether the Live Preview can honestly show this project in the browser, or
 * whether it needs a development server a page cannot start.
 */
export function previewStrategyFor(project) {
  if (project.kind === 'framework') {
    return {
      mode: 'needs-dev-server',
      reason: `This is a ${project.framework || project.kind} project. Its modules are compiled by a development server (\`npm run ${project.devServerScript || 'dev'}\`), which a browser tab cannot start or install. The desktop app's Go Live runs it.`,
    };
  }
  return { mode: 'static', reason: 'Rendered from the workspace files in the browser; no server was started.' };
}
