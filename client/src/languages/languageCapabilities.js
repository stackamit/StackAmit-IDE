/**
 * Language capability registry — a single, honest source of truth for what
 * this build genuinely offers per language (60 target catalogue languages +
 * a few practical extras, plus plaintext).
 *
 * Every field reflects a *verified* integration in this repo:
 *  - grammar: 'service' = language ships a real language-service Web Worker
 *      (monaco/monacoSetup.js): TS/JS, JSON, CSS/SCSS/Less, HTML.
 *    'bundled'  = real tokenizer from monaco-editor 0.52 `basic-languages`
 *      (checked against node_modules — never claimed for unbundled ids).
 *    'monarch'  = custom Monarch grammar registered by this app for ids
 *      Monaco does not bundle (languages/customLanguages.js).
 *  - intellisense: 'language-service' only for the worker-backed languages
 *      (completion with details, hover, signature help, definitions,
 *      references, rename, symbols, semantic diagnostics, formatting).
 *      Everything else is 'basic': highlighting, bracket matching, folding,
 *      word-based suggestions and (where flagged) snippets — never more.
 *  - run: the backend execution key (server/src/config/languages.js). Each
 *      non-null run was verified against the LIVE Wandbox catalog on
 *      2026-10-21 with a real hello-world execution. null = no runner.
 *  - local: how a real local toolchain would run this in the desktop
 *      terminal / interactive runner (server probes these commands; nothing
 *      is auto-installed or fabricated). `install` carries the allow-listed
 *      package ids used by the consent-driven runtime installer.
 *  - localRun: the language genuinely executes *inside the packaged desktop
 *      app* with no server and no network, via the Electron main process
 *      (client/electron/services/localRun.ts). Only runtimes that build has
 *      been verified against are listed; a `local` entry alone means "a
 *      toolchain could do this", not "this app runs it offline".
 *  - formatter: 'prettier' (curated extension, real bundled parser) or
 *      'language-service' (worker-provided formatting). Only these two are
 *      claimed; everything else honestly reports "no formatter".
 *  - linter: 'server' = real syntax diagnostics via the backend lint service
 *      (local compiler/interpreter in syntax-only mode); 'native' = Monaco's
 *      own language service; null = none.
 *
 * External language servers: `lsp` is the structured descriptor consumed by
 * the UI and mirrored by the desktop bridge (client/electron/services/
 * languageServer.ts). `lsp.wired === true` means the desktop app really
 * starts that server (spawning the user's own installed binary — never a
 * download); `wired: false` entries are an honest registry of known servers
 * with no provider wiring in this build.
 */

import { CUSTOM_LANGUAGE_IDS } from './customLanguages.js';
import { BROWSER_RUNNABLE } from '../utils/browserRun.js';

export const LS_FEATURES = Object.freeze([
  'completion',
  'hover',
  'signatureHelp',
  'definition',
  'references',
  'rename',
  'documentSymbols',
  'semanticDiagnostics',
  'formatting',
]);

const BASIC_FEATURES = Object.freeze([
  'highlighting',
  'bracketMatching',
  'folding',
  'wordBasedSuggestions',
]);

/**
 * What this build's thin LSP client genuinely maps for a connected server.
 * (Rename is intentionally absent: no rename provider is wired.)
 */
export const LSP_WIRED_FEATURES = Object.freeze([
  'completion',
  'hover',
  'signatureHelp',
  'definition',
  'references',
  'documentSymbols',
  'semanticDiagnostics',
  'formatting',
]);

/** Registry-only entry: a known server, no wiring in this build. */
const lspCandidate = (server, tool) => Object.freeze({
  server,
  tool,
  wired: false,
  features: [],
  rootMarkers: [],
  install: null,
});

/** Wired desktop entry: the main process really spawns `tool` if installed. */
const lspWired = (server, tool, { install, rootMarkers, prerequisite = null, jdk = null }) => Object.freeze({
  server,
  tool,
  wired: true,
  features: LSP_WIRED_FEATURES,
  rootMarkers: Object.freeze([...rootMarkers]),
  install: Object.freeze(install),
  prerequisite,
  // { minMajor, note } — the server itself must run on a full JDK, discovered
  // (or overridden) separately from the tool path.
  jdk: jdk ? Object.freeze({ minMajor: jdk.minMajor, note: jdk.note || '' }) : null,
});

const lang = (id, monaco, label, extensions, opts = {}) => ({
  id,
  monaco,
  label,
  extensions,
  filenames: opts.filenames || null,
  // 'service' | 'bundled' | 'monarch' | 'none' — where the tokenizer comes from.
  grammar: opts.grammar || (opts.intellisense === 'language-service' ? 'service' : monaco === 'plaintext' ? 'none' : CUSTOM_LANGUAGE_IDS.includes(monaco) ? 'monarch' : 'bundled'),
  intellisense: opts.intellisense || 'basic',
  features:
    opts.intellisense === 'language-service'
      ? LS_FEATURES
      : opts.intellisense === 'language-server'
        ? LSP_WIRED_FEATURES
        : BASIC_FEATURES,
  snippets: Boolean(opts.snippets),
  run: opts.run || null, // remote execution key (verified against live provider)
  local: opts.local || null, // { cmd, install?, note? } — local toolchain metadata
  localRun: opts.localRun || null, // offline desktop execution key (Electron main process)
  // Build tool an offline desktop run compiles with first — a *different*
  // executable from the language server (g++ vs clangd), so it gets its own
  // user-configurable path. null when the run needs no separate compiler.
  compiler: opts.compiler || null, // { tool, placeholder, note }
  formatter: opts.formatter || null,
  linter: opts.linter || null,
  runtimeNote: opts.runtimeNote || null,
  web: opts.web !== false,
  desktop: opts.desktop !== false,
  preview: opts.preview || null, // 'static' — participates in the Live Preview surface
  lsp: opts.lsp || null, // structured language-server descriptor (see header)
  variantOf: opts.variantOf || null, // editor mode sharing another entry's grammar
  // External-package story per mode, so the UI states a fact rather than a
  // guess: { desktop: 'resolvable'|'unsupported', web: 'resolvable'|'unsupported' }.
  // Only Java declares it today; null means "this language has no managed
  // third-party dependency flow in this app".
  externalDependencies: opts.externalDependencies || null,
});

export const LANGUAGES = Object.freeze([
  // ---- real language services (bundled Monaco workers) ----
  lang('javascript', 'javascript', 'JavaScript', ['js', 'mjs', 'cjs'], { intellisense: 'language-service', run: 'javascript', formatter: 'language-service', linter: 'native', preview: 'static', local: { cmd: 'node', install: 'OpenJS.NodeJS.LTS', note: 'Node.js' }, localRun: 'javascript' }),
  lang('typescript', 'typescript', 'TypeScript', ['ts'], { intellisense: 'language-service', run: 'typescript', formatter: 'language-service', linter: 'native', local: { cmd: 'node', note: 'Runs remotely (tsc-then-Node); offline the project’s own tsc compiles then Node runs the output' }, localRun: 'typescript', compiler: { tool: 'tsc (TypeScript)', placeholder: 'C:\\path\\to\\typescript (folder or bin\\tsc.js)', note: 'A node_modules/typescript inside the opened project is used first, then a global install; both are validated by running `node tsc --version`, and a configured path is honoured.' }, runtimeNote: 'Offline desktop run: a .ts file is compiled with the detected/configured tsc (the project’s tsconfig.json is used when present) and the emitted JavaScript runs on Node. A type/compile error stops the run with real file:line:col diagnostics — never a fake success. .tsx (React/JSX) is not run as a standalone program; build/preview the project instead.' }),
  lang('json', 'json', 'JSON', ['json', 'jsonc'], { intellisense: 'language-service', formatter: 'prettier', linter: 'native', runtimeNote: 'Schema-aware validation and completion.' }),
  lang('css', 'css', 'CSS', ['css'], { intellisense: 'language-service', formatter: 'language-service', linter: 'native', preview: 'static' }),
  lang('scss', 'scss', 'SCSS / Sass', ['scss', 'sass'], { intellisense: 'language-service', formatter: 'prettier', preview: 'static' }),
  lang('less', 'less', 'Less', ['less'], { intellisense: 'language-service', formatter: 'prettier', preview: 'static' }),
  lang('html', 'html', 'HTML', ['html', 'htm'], { intellisense: 'language-service', formatter: 'language-service', preview: 'static', runtimeNote: 'Entry point for Go Live static preview.' }),

  // ---- editor-mode variants (same underlying grammar; documented, not inflated) ----
  lang('jsx', 'javascript', 'JSX', ['jsx'], { variantOf: 'javascript', intellisense: 'language-service', run: 'javascript', formatter: 'language-service', linter: 'native' }),
  lang('tsx', 'typescript', 'TSX', ['tsx'], { variantOf: 'typescript', intellisense: 'language-service', run: 'typescript', formatter: 'language-service', linter: 'native' }),
  lang('svg', 'xml', 'SVG', ['svg'], { variantOf: 'xml', runtimeNote: 'Highlighted with the bundled XML grammar.' }),

  // ---- general-purpose languages: bundled Monaco grammars ----
  lang('python', 'python', 'Python', ['py', 'pyw', 'pyi'], { run: 'python', snippets: true, linter: 'server', intellisense: 'language-server', lsp: lspWired('pyright', 'pyright-langserver', { install: { npm: 'pyright', winget: null }, rootMarkers: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile', 'setup.cfg', '.git'] }), local: { cmd: 'python', install: 'Python.Python.3.12', note: 'python / py launcher' }, localRun: 'python', runtimeNote: 'Remote runner (CPython 3.11) + offline desktop run when Python is installed.' }),
  lang('c', 'c', 'C', ['c', 'h'], { run: 'c', snippets: true, linter: 'server', intellisense: 'language-server', lsp: lspWired('clangd', 'clangd', { install: { npm: null, winget: 'LLVM.LLVM' }, rootMarkers: ['compile_commands.json', '.clangd', '.clang-tidy'] }), local: { cmd: 'gcc', install: 'BrechtSanders.WinLibs.POSIX.UCRT', note: 'MinGW-w64 gcc' } }),
  lang('cpp', 'cpp', 'C++', ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'inl'], { run: 'cpp', snippets: true, linter: 'server', intellisense: 'language-server', lsp: lspWired('clangd', 'clangd', { install: { npm: null, winget: 'LLVM.LLVM' }, rootMarkers: ['compile_commands.json', '.clangd', '.clang-tidy'] }), local: { cmd: 'g++', install: 'BrechtSanders.WinLibs.POSIX.UCRT', note: 'MinGW-w64 g++' }, localRun: 'cpp', compiler: { tool: 'g++ / clang++', placeholder: 'C:\\path\\to\\g++.exe (or the bin folder)', note: 'Found on PATH first, then in the usual install folders; the registry PATH is re-read, so a compiler installed after the app launched is still found.' }, runtimeNote: 'Remote runner (GCC/Clang via the online provider) + offline desktop run with a located compiler: the project root is discovered around the file, its CMakeLists.txt targets and include directories are read, and the sources are compiled and linked together — a multi-file project builds without CMake installed.' }),
  lang('java', 'java', 'Java', ['java'], { run: 'java', snippets: true, linter: 'server', intellisense: 'language-server', externalDependencies: { desktop: 'resolvable', web: 'unsupported' }, lsp: lspWired('jdtls', 'jdtls', { install: { npm: null, winget: null, note: 'Eclipse JDT.LS: download the tarball from download.eclipse.org/jdtls, unpack it (the folder holds plugins/ + config_win/), then point "Custom tool path" at that folder or its bin/jdtls launcher. Nothing is on PATH by default — jdtls is not an installer.' }, rootMarkers: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', '.git'], prerequisite: 'JDK 17+ (to run the server itself — a JRE cannot resolve java.* imports)', jdk: { minMajor: 17, note: 'Found via JAVA_HOME, PATH, ~/.jdks and the usual Program Files folders; Maven/Gradle dependencies resolve from the local cache (offline) and third-party libraries need a pom.xml or build.gradle.' } }), local: { cmd: 'java', install: 'Microsoft.OpenJDK.21', note: 'java + javac' }, localRun: 'java', runtimeNote: 'Remote runner (JDK) + offline desktop run on a discovered JDK: source-file mode for a standalone class, javac → java for packages and multi-file projects. The standard library always works; in Desktop Mode third-party libraries from the Java Dependencies catalog are resolved to ~/.m2 and placed on the compile + runtime classpath. In Web Mode the execution provider cannot add Maven dependencies, so a third-party import is reported honestly rather than faked.' }),
  lang('csharp', 'csharp', 'C#', ['cs'], { run: 'csharp', snippets: true, lsp: lspCandidate('OmniSharp/Roslyn', 'omnisharp'), local: { cmd: 'dotnet', install: 'Microsoft.DotNet.SDK.8', note: 'remote run verified; local needs `dotnet run` in a project' } }),
  lang('go', 'go', 'Go', ['go'], { run: 'go', snippets: true, linter: 'server', lsp: lspCandidate('gopls', 'gopls'), local: { cmd: 'go', install: 'GoLang.Go' } }),
  lang('rust', 'rust', 'Rust', ['rs'], { run: 'rust', snippets: true, lsp: lspCandidate('rust-analyzer', 'rust-analyzer'), local: { cmd: 'rustc', install: 'Rustlang.Rustup' } }),
  lang('php', 'php', 'PHP', ['php', 'php4', 'php5', 'phtml'], { run: 'php', snippets: true, linter: 'server', lsp: lspCandidate('intelephense', 'intelephense'), local: { cmd: 'php', install: 'PHP.PHP.8.3' } }),
  lang('ruby', 'ruby', 'Ruby', ['rb'], { run: 'ruby', snippets: true, linter: 'server', local: { cmd: 'ruby', install: 'RubyInstaller.Ruby.MSYS2' } }),
  lang('kotlin', 'kotlin', 'Kotlin', ['kt', 'kts'], { snippets: true, lsp: lspCandidate('Kotlin Language Server', 'kotlin-language-server'), local: { cmd: 'kotlinc', install: 'JetBrains.Kotlin', note: 'requires JDK' }, runtimeNote: 'No remote runner (provider images broken); local kotlinc via terminal.' }),
  lang('swift', 'swift', 'Swift', ['swift'], { runtimeNote: 'No runner wired up; Apple toolchain required (not on Windows).' }),
  lang('dart', 'dart', 'Dart', ['dart'], { local: { cmd: 'dart', note: 'Dart SDK' }, runtimeNote: 'No remote runner verified; local Dart via terminal.' }),
  lang('r', 'r', 'R', ['r', 'rd'], { runtimeNote: 'No runner wired up; local R via terminal.' }),
  lang('julia', 'julia', 'Julia', ['jl'], { run: 'julia', snippets: false, local: { cmd: 'julia' }, runtimeNote: 'Remote runner (Julia 1.10).' }),
  lang('perl', 'perl', 'Perl', ['pl', 'pm', 'pod'], { run: 'perl', snippets: true, local: { cmd: 'perl', note: 'Strawberry Perl on Windows' } }),
  lang('lua', 'lua', 'Lua', ['lua'], { run: 'lua', snippets: true, lsp: lspCandidate('Lua LS', 'lua-language-server'), local: { cmd: 'lua', note: 'Lua 5.4' } }),
  lang('scala', 'scala', 'Scala', ['scala', 'sc'], { snippets: true, lsp: lspCandidate('Metals', 'metals'), runtimeNote: 'No remote runner (provider image broken); local sbt via terminal.' }),
  lang('objective-c', 'objective-c', 'Objective-C', ['m', 'mm'], { lsp: lspCandidate('clangd', 'clangd') }),
  lang('fsharp', 'fsharp', 'F#', ['fs', 'fsi', 'fsx', 'fsscript'], { snippets: true, lsp: lspCandidate('F# Language Server', 'fsautocomplete'), local: { cmd: 'dotnet', install: 'Microsoft.DotNet.SDK.8' } }),
  lang('vb', 'vb', 'Visual Basic .NET', ['vb', 'vbs'], { runtimeNote: 'No runner wired up; use the terminal with vbnc/dotnet.' }),
  lang('elixir', 'elixir', 'Elixir', ['ex', 'exs'], { snippets: true, lsp: lspCandidate('Elixir LS', 'elixir-ls'), local: { cmd: 'elixir', note: 'via winget/kiex; not on this provider today' }, runtimeNote: 'No remote runner verified (provider image broken); local Elixir via terminal.' }),
  lang('erlang', 'erlang', 'Erlang', ['erl', 'hrl', 'es'], { grammar: 'monarch', runtimeNote: 'Custom Monarch grammar; no runner (provider image broken).' }),
  lang('clojure', 'clojure', 'Clojure', ['clj', 'cljs', 'cljc', 'edn'], { snippets: true, lsp: lspCandidate('clojure-lsp', 'clojure-lsp'), runtimeNote: 'No runner wired up; local Lein/Calva not bundled.' }),

  // ---- live-verified runners with custom grammars ----
  lang('haskell', 'haskell', 'Haskell', ['hs', 'lhs'], { grammar: 'monarch', run: 'haskell', snippets: true, lsp: lspCandidate('HLS', 'haskell-language-server-wrapper'), local: { cmd: 'runghc', note: 'GHC' } }),
  lang('ocaml', 'ocaml', 'OCaml', ['ml', 'mli'], { grammar: 'monarch', runtimeNote: 'Custom Monarch grammar; no remote runner (provider image broken).' }),
  lang('sql', 'sql', 'SQL (SQLite)', ['sql'], { run: 'sql', snippets: true, lsp: lspCandidate('sqlfluff/LS', 'sqlfluff'), local: { cmd: 'sqlite3', note: 'remote run verified via sqlite3 CLI' } }),
  lang('plsql', 'plsql', 'PL/SQL', ['pls', 'plsql', 'pck', 'bdy', 'spc'], { grammar: 'monarch', runtimeNote: 'Custom Monarch grammar; needs a real Oracle/PG server — no runner.' }),
  lang('shell', 'shell', 'Shell (Bash)', ['sh', 'bash', 'zsh'], { run: 'shell', snippets: true, linter: 'server', local: { cmd: 'bash', note: 'Git Bash / WSL on Windows' }, runtimeNote: 'Remote runner (bash) verified; desktop terminal for local.' }),
  lang('powershell', 'powershell', 'PowerShell', ['ps1', 'psm1', 'psd1'], { snippets: true, lsp: lspCandidate('PowerShell LS', 'PowerShellEditorServices'), local: { cmd: 'pwsh', note: 'powershell.exe also probed' }, localRun: 'powershell', runtimeNote: 'Offline desktop run (Windows PowerShell 5.1 or pwsh); no remote runner.' }),
  lang('pascal', 'pascal', 'Pascal', ['pas', 'pp', 'inc'], { run: 'pascal', local: { cmd: 'fpc', note: 'Free Pascal' }, runtimeNote: 'Remote runner (FPC 3.2) verified.' }),

  // ---- legacy / systems languages (custom grammars, editing only) ----
  lang('fortran', 'fortran', 'Fortran', ['f', 'for', 'f77', 'f90', 'f95', 'f03', 'f08'], { grammar: 'monarch', runtimeNote: 'No runner wired up; local gfortran via terminal.' }),
  lang('cobol', 'cobol', 'COBOL', ['cob', 'cbl', 'cpy'], { grammar: 'monarch', runtimeNote: 'No runner wired up (not offered by the provider).' }),
  lang('asm', 'asm', 'Assembly (x86)', ['asm', 's', 'nasm'], { grammar: 'monarch', runtimeNote: 'Custom Monarch grammar; assemble locally via NASM/GAS in the terminal.' }),
  lang('matlab', 'matlab', 'MATLAB', ['mlx', 'mat', 'mex', 'fig'], { grammar: 'monarch', runtimeNote: 'Custom Monarch grammar (.m belongs to Objective-C); MATLAB itself is proprietary — no runner.' }),
  lang('groovy', 'groovy', 'Groovy', ['groovy', 'gvy', 'gy', 'gradle'], { grammar: 'monarch', local: { cmd: 'groovy' }, runtimeNote: 'Custom Monarch grammar; Jenkinsfile also opens as Groovy.' }),

  // ---- web framework file formats (custom grammars) ----
  lang('vue', 'vue', 'Vue', ['vue'], { grammar: 'monarch', preview: null, runtimeNote: 'Custom Monarch grammar; Vue projects run through the Vite dev-server preview.' }),
  lang('svelte', 'svelte', 'Svelte', ['svelte'], { grammar: 'monarch', runtimeNote: 'Custom Monarch grammar; SvelteKit projects run through the dev-server preview.' }),
  lang('astro', 'astro', 'Astro', ['astro'], { grammar: 'monarch', runtimeNote: 'Custom Monarch grammar; Astro projects run through the dev-server preview.' }),

  // ---- data, config & infrastructure formats ----
  lang('markdown', 'markdown', 'Markdown', ['md', 'markdown'], { snippets: true, formatter: 'prettier' }),
  lang('yaml', 'yaml', 'YAML', ['yml', 'yaml'], { formatter: 'prettier' }),
  lang('xml', 'xml', 'XML', ['xml'], {}),
  lang('toml', 'toml', 'TOML', ['toml'], { grammar: 'monarch' }),
  lang('ini', 'ini', 'INI / Properties', ['ini', 'cfg', 'properties'], {}),
  lang('dockerfile', 'dockerfile', 'Dockerfile', [], { filenames: ['Dockerfile', 'Containerfile'], runtimeNote: 'Builds run through the desktop terminal (docker/podman).' }),
  lang('makefile', 'makefile', 'Makefile', ['mk'], { grammar: 'monarch', filenames: ['Makefile', 'GNUmakefile'], runtimeNote: 'make runs through the desktop terminal (e.g. via MinGW/WSL).' }),
  lang('hcl', 'hcl', 'Terraform / HCL', ['tf', 'hcl'], { lsp: lspCandidate('terraform LS', 'terraform-ls'), runtimeNote: 'No runner wired up; use terraform/tofu in the terminal.' }),
  lang('nginx', 'nginx', 'Nginx configuration', ['conf'], { grammar: 'monarch', runtimeNote: 'Custom Monarch grammar; validate with `nginx -t` on the server.' }),
  // Monaco registers these two under short ids ('proto', 'sol') — verified
  // against monaco-editor 0.52 in src/languages/__tests__/monacoGrammars.test.js.
  lang('protobuf', 'proto', 'Protocol Buffers', ['proto'], { lsp: lspCandidate('protols', 'protols'), runtimeNote: 'Generate with protoc in the terminal.' }),
  lang('wat', 'wat', 'WebAssembly Text', ['wat', 'wast'], { grammar: 'monarch', runtimeNote: 'Custom Monarch grammar; tools (wabt) via terminal.' }),
  lang('graphql', 'graphql', 'GraphQL', ['graphql', 'gql'], { runtimeNote: 'Schema-aware IntelliSense needs a GraphQL LS (not bundled).' }),
  lang('solidity', 'sol', 'Solidity', ['sol'], { lsp: lspCandidate('solc LS', 'solc'), runtimeNote: 'No runner wired up; use Foundry/Hardhat in the terminal.' }),

  // ---- other real languages included for breadth (bundled grammars) ----
  lang('bat', 'bat', 'Batch', ['bat', 'cmd'], { snippets: true, runtimeNote: 'Desktop terminal only.' }),
  lang('tcl', 'tcl', 'Tcl', ['tcl'], { runtimeNote: 'No runner wired up.' }),

  lang('plaintext', 'plaintext', 'Plain Text', ['txt'], { grammar: 'none' }),
]);

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));
// First entry wins so a variant (jsx/tsx/svg) never shadows its parent grammar
// in status-bar lookups keyed by Monaco id.
const BY_MONACO = new Map();
for (const l of LANGUAGES) if (!BY_MONACO.has(l.monaco)) BY_MONACO.set(l.monaco, l);

export function capabilityForMonacoLanguage(monacoId) {
  return BY_MONACO.get(monacoId) || null;
}

export function languageForId(id) {
  return BY_ID.get(id) || null;
}

// Backend run key -> first registry entry declaring it. Variants (jsx/tsx) are
// deliberately resolved after their parent language so the key maps to the real
// language entry.
const FIRST_BY_RUN_KEY = new Map();
for (const l of LANGUAGES) if (l.run && !FIRST_BY_RUN_KEY.has(l.run)) FIRST_BY_RUN_KEY.set(l.run, l);

/** Capability entry for a backend execution key (`python`, `shell`, …). */
export function capabilityForRunKey(key) {
  return FIRST_BY_RUN_KEY.get(key) || null;
}

/** True when the id has a real tokenizer in this build (bundled, service or custom). */
export function hasSyntaxHighlighting(cap) {
  return cap && cap.grammar !== 'none';
}

/** Short, truthful description for the status bar / tooltips. Never claims
 *  IntelliSense beyond what the bundled language service (or, for
 *  language-server languages, the *connected* server) actually provides.
 *  `lspState` is the live connection state ('ready' | 'starting' |
 *  'missing-tool' | 'error' | undefined) from the desktop bridge. */
export function describeIntellisense(monacoId, lspState) {
  const cap = BY_MONACO.get(monacoId);
  if (!cap) return 'No grammar bundled — plain text only';
  if (cap.intellisense === 'language-service') {
    return 'Full IntelliSense via the bundled language service (completion, hover, signature help, definitions, references, rename, symbols, diagnostics, formatting)';
  }
  const extras = [cap.snippets ? 'snippets' : null].filter(Boolean);
  const base = extras.length
    ? `Syntax highlighting + word suggestions + ${extras.join(', ')}`
    : 'Syntax highlighting + word suggestions';
  if (cap.intellisense === 'language-server' && cap.lsp) {
    const server = cap.lsp.server;
    if (lspState === 'ready') {
      return `${base} — live IntelliSense connected via ${server} (completion, hover, signature help, definitions, references, symbols, diagnostics, formatting)`;
    }
    if (lspState === 'starting') return `${base} — connecting to the ${server} language server…`;
    if (lspState === 'missing-tool') {
      const why = cap.lsp.jdk ? ` (needs a JDK ${cap.lsp.jdk.minMajor}+ and the ${server} install folder — see Languages & Capabilities)` : '';
      return `${base} — ${server} is not installed/usable on this machine${why}; the editor falls back to highlighting + snippets`;
    }
    if (lspState === 'error') return `${base} — the ${server} language server reported an error; falling back to highlighting`;
    return `${base} — full IntelliSense needs the ${server} language server (desktop app, installed tool required)`;
  }
  return cap.lsp ? `${base} (no language service yet — candidate: ${cap.lsp.server})` : base;
}

/** One-line capability summary for the catalogue view. */
export function describeCapabilities(cap, lspState, mode) {
  const parts = [];
  parts.push(cap.grammar === 'none' ? 'Plain text' : `Editing: ${cap.grammar === 'monarch' ? 'custom grammar' : cap.grammar === 'service' ? 'language service' : 'bundled grammar'}`);
  if (cap.intellisense === 'language-service') parts.push('IntelliSense: full (semantic)');
  else if (cap.intellisense === 'language-server') {
    parts.push(`IntelliSense: ${lspState === 'ready' ? `live via ${cap.lsp?.server} (semantic)` : `needs ${cap.lsp?.server || 'a language server'}${lspState === 'missing-tool' ? ' — missing tool' : ''}`}`);
  } else parts.push('IntelliSense: basic');
  if (cap.formatter) parts.push(`Format: ${cap.formatter}`);
  if (cap.linter) parts.push(`Lint: ${cap.linter === 'server' ? 'syntax checks' : 'native'}`);
  parts.push(describeRunForMode(cap, mode));
  if (cap.preview) parts.push('Live preview');
  return parts.join(' · ');
}

/**
 * The honest Run sentence for the mode the app is really in.
 *
 * In the browser an offline desktop run does not exist, and the in-page
 * JavaScript engine does — so the two modes must not print the same sentence
 * about the same entry. Nothing here claims a native language runs in a page.
 */
export function describeRunForMode(cap, mode = null) {
  if (mode === 'web') {
    if (BROWSER_RUNNABLE.includes(cap.monaco)) return 'Run: in this browser (JavaScript engine, not Node.js)';
    if (cap.run) return 'Run: online (needs the API server)';
    return 'Run: none in the browser';
  }
  return cap.localRun
    ? 'Run: offline in desktop app'
    : cap.run
      ? 'Run: online (verified)'
      : cap.local
        ? 'Run: local toolchain via terminal'
        : 'Run: none';
}

/** Languages the web/desktop Run action can actually execute remotely. */
export function runnableLanguages() {
  return LANGUAGES.filter((l) => l.run);
}

/**
 * Monaco language id -> offline desktop run key (`python`, `javascript`,
 * `powershell`). The desktop Run action consults this to keep local execution
 * separate from online execution; keys must match the plans declared in
 * `client/electron/services/localRun.ts` (pinned by a test).
 */
export function localRunKeyFor(monacoId) {
  return BY_MONACO.get(monacoId)?.localRun || null;
}

/** Entries the packaged desktop app can run without any server or network. */
export function localRunLanguages() {
  return LANGUAGES.filter((l) => l.localRun);
}

/**
 * Languages the browser's own engine runs with no server and no desktop app.
 * JavaScript only — a page has no C++/Java/Python interpreter, and the app must
 * never imply otherwise.
 */
export function browserRunLanguages() {
  return LANGUAGES.filter((l) => BROWSER_RUNNABLE.includes(l.monaco));
}

/** Languages that participate in the static-web Live Preview surface. */
export function previewLanguages() {
  return LANGUAGES.filter((l) => l.preview === 'static');
}

/** Entries whose IntelliSense comes from an external language server. */
export function lspLanguages() {
  return LANGUAGES.filter((l) => l.lsp && l.lsp.wired);
}

/**
 * Whether this build wires a real language-server bridge for the Monaco id.
 * Keeps provider registration and the UI on the same honest source of truth:
 * only `lsp.wired` entries may ever start a server.
 */
export function lspDescriptorForMonacoLanguage(monacoId) {
  const cap = BY_MONACO.get(monacoId);
  return cap && cap.lsp && cap.lsp.wired ? cap.lsp : null;
}

/** Catalogue entries (variants included) for the language browser UI. */
export function catalogueEntries() {
  return LANGUAGES.filter((l) => l.id !== 'plaintext');
}

export default LANGUAGES;
