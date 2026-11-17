/**
 * Java external-import detection (renderer, pure functions).
 *
 * The IDE needs to answer, from the user's own source text: "which third-party
 * libraries does this project reference, and can I offer them?" This module
 * parses `import` statements out of one or more `.java` files and classifies
 * each one. It mirrors the comment/literal scanner in
 * `electron/services/javaRun.ts` so a `// import com.foo.Bar;` or an `import`
 * that only appears inside a string literal is never mistaken for a real one.
 *
 * It NEVER rewrites source and NEVER downloads anything — it only reads. A
 * catalog hit here becomes a dismissible *suggestion* the user can explicitly
 * add; it is never auto-loaded into a program.
 */
import { findByPackage } from '../data/javaLibraryCatalog.js';

/**
 * Remove comments and string/character/text-block literals, keeping newlines so
 * line numbers stay meaningful. Intentionally a near-copy of the JDK-side
 * stripper: the two must agree or the renderer would suggest dependencies the
 * compiler would not actually see.
 */
export function stripJavaCommentsAndLiterals(source) {
  const text = String(source ?? '');
  let out = '';
  let i = 0;
  let state = 'code'; // code | line | block | string | char | text
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
        if (text[i] === '\n') out += '\n';
        i += 1;
      }
      continue;
    }
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

// `java.`/`javax.`/`jdk.`/`sun.` ship with the runtime — never a catalog hit.
const JDK_PREFIXES = ['java.', 'javax.', 'jdk.', 'sun.', 'com.sun.'];

/**
 * Pull every real `import` from cleaned Java source.
 * Handles: `import a.b.C;`, `import static a.b.C.method;`, `import a.b.*;`.
 */
export function extractImports(source) {
  const clean = stripJavaCommentsAndLiterals(source);
  const re = /^[ \t]*import[ \t]+(static[ \t]+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(\.\*)?[ \t]*;/gm;
  const seen = new Set();
  const found = [];
  let m;
  while ((m = re.exec(clean))) {
    const fqn = m[2];
    const wildcard = Boolean(m[3]);
    const isStatic = Boolean(m[1]);
    // Wildcard imports resolve a package (`a.b`), not a type (`a.b.C`); the
    // trailing segment before `.*` is part of the package name, already in m[2].
    const key = `${isStatic ? 's' : ''}${wildcard ? 'w' : ''}${fqn}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ fqn, static: isStatic, wildcard, raw: m[0].trim() });
  }
  return found;
}

/** Collect the `package` names declared across the given sources. */
function projectPackages(sources) {
  const set = new Set();
  for (const s of sources) {
    const clean = stripJavaCommentsAndLiterals(s.content);
    const pkg = clean.match(/^[ \t]*package[ \t]+([\w$]+(?:\.[\w$]+)*)[ \t]*;/m)?.[1];
    if (pkg) set.add(pkg);
  }
  return set;
}

function classify(importItem, packages) {
  const { fqn } = importItem;
  if (JDK_PREFIXES.some((p) => fqn === p.slice(0, -1) || fqn.startsWith(p))) return 'jdk';
  // A project type lives in a package this project itself declares. For a
  // wildcard import the package is `fqn`; otherwise the owning package is
  // `fqn` minus its last (type-name) segment.
  const owningPackage = importItem.wildcard ? fqn : fqn.split('.').slice(0, -1).join('.');
  if (packages.has(owningPackage) || [...packages].some((p) => owningPackage === p || owningPackage.startsWith(`${p}.`))) return 'project';
  const catalog = findByPackage(fqn);
  if (catalog.length > 0) return 'catalog';
  return 'unknown';
}

/**
 * Analyze one or more files. `files` is an array of `{ path?, name?, content }`.
 * Returns `{ imports, catalog, unknown, project, jdk, unresolved }` where each
 * import record carries its `kind` and, for catalog hits, the matching entries
 * (longest prefix first) so an ambiguous import keeps every candidate for the
 * user to choose rather than the detector silently guessing.
 */
export function analyzeJavaImports(files) {
  const list = Array.isArray(files) ? files : [files];
  const sources = list.map((f) => ({ content: String(f?.content ?? '') }));
  const packages = projectPackages(sources);

  const imports = [];
  const seenGlobal = new Set();
  for (const f of list) {
    for (const item of extractImports(f?.content)) {
      const dedupeKey = `${item.static ? 's' : ''}${item.wildcard ? 'w' : ''}${item.fqn}`;
      const existing = seenGlobal.has(dedupeKey) ? imports.find((r) => r.dedupeKey === dedupeKey) : null;
      if (existing) {
        if (f?.path && !existing.files.includes(f.path)) existing.files.push(f.path);
        continue;
      }
      const kind = classify(item, packages);
      const record = {
        dedupeKey,
        fqn: item.fqn,
        static: item.static,
        wildcard: item.wildcard,
        raw: item.raw,
        kind,
        catalog: kind === 'catalog' ? findByPackage(item.fqn) : [],
        files: f?.path ? [f.path] : [],
      };
      seenGlobal.add(dedupeKey);
      imports.push(record);
    }
  }

  const external = imports.filter((r) => r.kind !== 'jdk' && r.kind !== 'project');
  return {
    imports,
    jdk: imports.filter((r) => r.kind === 'jdk'),
    project: imports.filter((r) => r.kind === 'project'),
    catalog: imports.filter((r) => r.kind === 'catalog'),
    unknown: imports.filter((r) => r.kind === 'unknown'),
    // Anything the compiler could not resolve from the JDK or the project: the
    // set a run must satisfy before it can compile.
    unresolved: external,
  };
}
