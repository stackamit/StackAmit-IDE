/**
 * Map a file path to a Monaco language id and a runnable language key.
 *
 * Shared by the multi-file editor, the status bar, and quick-open so the same
 * extension rules drive syntax highlighting and the Run action. The extension
 * table below and `languageCapabilities.js` are pinned against each other by
 * tests — adding a language means touching exactly those two places.
 *
 * Grammar sources:
 *  - ids like 'kotlin', 'julia', 'hcl' ship with monaco-editor's own
 *    `basic-languages` set (real bundled tokenizers).
 *  - ids like 'vue', 'toml', 'makefile' are registered by this app through
 *    custom Monarch grammars (see languages/customLanguages.js).
 *  - 'jsx'/'tsx'/'svg' are *editor modes* over the javascript/typescript/xml
 *    bundled grammars — the underlying language relationship is documented in
 *    the capability registry, not faked with duplicate tokenizers.
 */

const EXT_TO_MONACO = {
  // ---- bundled Monaco grammars ----
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json',
  py: 'python', pyw: 'python', pyi: 'python',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', inl: 'cpp',
  java: 'java',
  html: 'html', htm: 'html',
  css: 'css',
  scss: 'scss', sass: 'scss',
  less: 'less',
  md: 'markdown', markdown: 'markdown',
  xml: 'xml', svg: 'xml',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  yml: 'yaml', yaml: 'yaml',
  php: 'php', php4: 'php', php5: 'php', phtml: 'php',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  sql: 'sql',
  cs: 'csharp',
  kt: 'kotlin', kts: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'bat', cmd: 'bat',
  ini: 'ini', cfg: 'ini', properties: 'ini',
  txt: 'plaintext',
  r: 'r', rd: 'r',
  jl: 'julia',
  pl: 'perl', pm: 'perl', pod: 'perl',
  lua: 'lua',
  scala: 'scala', sc: 'scala',
  m: 'objective-c', mm: 'objective-c',
  fs: 'fsharp', fsi: 'fsharp', fsx: 'fsharp', fsscript: 'fsharp',
  vb: 'vb', vbs: 'vb',
  ex: 'elixir', exs: 'elixir',
  clj: 'clojure', cljs: 'clojure', cljc: 'clojure', edn: 'clojure',
  // Monaco's own ids for these two formats are the short ones ('sol', 'proto').
  sol: 'sol',
  graphql: 'graphql', gql: 'graphql',
  tf: 'hcl', hcl: 'hcl',
  proto: 'proto',
  pas: 'pascal', pp: 'pascal', inc: 'pascal',
  tcl: 'tcl',

  // ---- custom Monarch grammars (registered by customLanguages.js) ----
  // (.m belongs to Objective-C above; MATLAB uses .mlx/.mat/.mex.)
  mlx: 'matlab', mat: 'matlab', mex: 'matlab', fig: 'matlab',
  groovy: 'groovy', gvy: 'groovy', gy: 'groovy', gradle: 'groovy',
  erl: 'erlang', hrl: 'erlang', es: 'erlang',
  hs: 'haskell', lhs: 'haskell',
  ml: 'ocaml', mli: 'ocaml',
  f: 'fortran', for: 'fortran', f77: 'fortran', f90: 'fortran', f95: 'fortran', f03: 'fortran', f08: 'fortran',
  cob: 'cobol', cbl: 'cobol', cpy: 'cobol',
  asm: 'asm', s: 'asm', nasm: 'asm',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',
  toml: 'toml',
  conf: 'nginx',
  wat: 'wat', wast: 'wat',
  mk: 'makefile',
  pls: 'plsql', plsql: 'plsql', pck: 'plsql', bdy: 'plsql', spc: 'plsql',
  // Note: `.conf` is intentionally generic; Nginx owns it here because no other
  // registered format claims it, and the capability registry documents the
  // association as "Nginx configuration".
};

// Monaco language -> the backend execution key (server/src/config/languages.js).
// Exported so the capability registry can be validated against the same truth.
// Every entry here was verified against the live Wandbox catalog on 2026-10-21.
export const MONACO_TO_RUN_KEY = {
  python: 'python',
  c: 'c',
  cpp: 'cpp',
  java: 'java',
  javascript: 'javascript',
  typescript: 'typescript', // compiled with tsc by the provider before running
  go: 'go',
  rust: 'rust',
  csharp: 'csharp',
  php: 'php',
  ruby: 'ruby',
  perl: 'perl',
  lua: 'lua',
  julia: 'julia',
  haskell: 'haskell',
  sql: 'sql', // executes as a SQLite script
  shell: 'shell', // executes as a bash script
  pascal: 'pascal',
};

function extOf(path) {
  const name = String(path || '').split(/[\\/]/).pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

// Extension-less well-known files, matched case-insensitively.
const SPECIAL_FILENAMES = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  'jenkinsfile': 'groovy',
};

export function monacoLanguageFor(path) {
  const name = (String(path || '').split(/[\\/]/).pop() || '').toLowerCase();
  if (SPECIAL_FILENAMES[name]) return SPECIAL_FILENAMES[name];
  return EXT_TO_MONACO[extOf(path)] || 'plaintext';
}

export function runKeyFor(path) {
  const monaco = monacoLanguageFor(path);
  return MONACO_TO_RUN_KEY[monaco] || null;
}

export function baseName(path) {
  return String(path || '').split(/[\\/]/).pop() || '';
}

/** True for a brand-new in-memory document that has never touched disk. */
export function isUntitled(path) {
  return !path || path.startsWith('untitled:');
}
