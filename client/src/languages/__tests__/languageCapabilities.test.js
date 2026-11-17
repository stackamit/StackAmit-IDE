import { describe, it, expect } from 'vitest';
import {
  LANGUAGES,
  LS_FEATURES,
  LSP_WIRED_FEATURES,
  capabilityForMonacoLanguage,
  catalogueEntries,
  describeCapabilities,
  describeIntellisense,
  describeRunForMode,
  browserRunLanguages,
  runnableLanguages,
  previewLanguages,
  localRunLanguages,
  localRunKeyFor,
  lspDescriptorForMonacoLanguage,
  lspLanguages,
} from '../languageCapabilities.js';
import { MONACO_TO_RUN_KEY, monacoLanguageFor } from '../../utils/langForFile.js';
// The Electron main process is the only thing that can really run a program
// offline; importing its plan table here turns "the app runs X locally" from a
// claim into a checked fact.
import { LOCAL_PLANS } from '../../../electron/services/localRun';
// Same idea for language servers: the registry may only advertise `wired`
// for servers the desktop bridge can actually start.
import { LS_DESCRIPTORS } from '../../../electron/services/languageServer';

/**
 * The capability registry is a promise the UI makes to the user; these tests
 * pin it against the *actual* integrations in this repo so it can never
 * overclaim (no "full IntelliSense" for keyword-only languages, no runner for
 * languages the backend does not register).
 */
describe('language capability registry', () => {
  it('has unique ids, labels, and shares a Monaco grammar only via variantOf', () => {
    const ids = LANGUAGES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Group by Monaco grammar (declaration order is irrelevant): a grammar may
    // back several entries only as one canonical entry + documented variants.
    const groups = new Map();
    for (const l of LANGUAGES) {
      if (!groups.has(l.monaco)) groups.set(l.monaco, []);
      groups.get(l.monaco).push(l);
      expect(l.label.length).toBeGreaterThan(0);
    }
    for (const [monaco, entries] of groups) {
      const parents = entries.filter((l) => !l.variantOf);
      expect(parents.length, `grammar ${monaco} needs exactly one canonical entry`).toBe(1);
      for (const l of entries) {
        if (l === parents[0]) continue;
        expect(l.variantOf, `${l.id} reuses ${monaco} without variantOf`).toBe(parents[0].id);
      }
    }
    for (const l of LANGUAGES) {
      if (l.variantOf) expect(LANGUAGES.some((p) => p.id === l.variantOf), `unknown variant parent ${l.variantOf}`).toBe(true);
    }
  });

  it('only grants language-service tier to the workers monacoSetup actually registers', () => {
    // Keep this list in sync with getWorker() in src/monaco/monacoSetup.js.
    const SERVICE_LANGS = ['javascript', 'typescript', 'json', 'css', 'scss', 'less', 'html'];
    const withService = [...new Set(LANGUAGES.filter((l) => l.intellisense === 'language-service').map((l) => l.monaco))];
    expect(withService.sort()).toEqual(SERVICE_LANGS.slice().sort());
    for (const id of withService) {
      const cap = capabilityForMonacoLanguage(id);
      expect(cap.features).toBe(LS_FEATURES);
    }
  });

  it('never claims a runner the client run-key mapping does not support', () => {
    for (const l of runnableLanguages()) {
      expect(MONACO_TO_RUN_KEY[l.monaco]).toBe(l.run);
    }
    // The registry must not *omit* a language the runner does support.
    for (const [monacoId, key] of Object.entries(MONACO_TO_RUN_KEY)) {
      expect(capabilityForMonacoLanguage(monacoId)?.run).toBe(key);
    }
  });

  it('assigns every extension exactly once (no ambiguous routing)', () => {
    const seen = new Map();
    for (const l of LANGUAGES) {
      for (const ext of l.extensions) {
        expect(seen.has(ext), `duplicate extension .${ext}`).toBe(false);
        seen.set(ext, l.monaco);
      }
    }
    // And the file-name router really resolves every registered extension to
    // the entry that declares it — not to plaintext, not to another language.
    for (const l of LANGUAGES) {
      for (const ext of l.extensions) {
        expect(monacoLanguageFor(`dir/a.${ext}`), `.${ext} should open as ${l.monaco}`).toBe(l.monaco);
      }
      for (const name of l.filenames || []) {
        expect(monacoLanguageFor(`dir/${name}`), name).toBe(l.monaco);
      }
    }
    // File paths resolve to a registered capability for the priority languages.
    for (const p of ['a.py', 'a.js', 'a.ts', 'a.java', 'a.c', 'a.cpp', 'a.cs', 'a.go', 'a.rs', 'a.php', 'a.rb', 'a.kt', 'a.swift', 'a.dart', 'a.sql', 'a.html', 'a.css', 'a.json', 'a.yml', 'a.xml', 'a.md', 'a.sh', 'a.ps1', 'Dockerfile', 'a.vue', 'a.svelte', 'a.astro', 'a.toml', 'a.mk', 'a.hcl', 'a.proto', 'a.sol', 'a.wat', 'a.erl', 'a.hs', 'a.ml', 'a.f90', 'a.cob', 'a.asm', 'a.mlx', 'a.groovy', 'a.pls', 'a.r', 'a.jl', 'a.pl', 'a.lua', 'a.scala', 'a.m', 'a.fs', 'a.vb', 'a.exs', 'a.clj', 'a.tf', 'a.graphql', 'a.pas', 'a.bat', 'a.tcl', 'a.ini', 'a.conf', 'a.svg', 'a.jsx', 'a.tsx']) {
      const monaco = monacoLanguageFor(p);
      expect(capabilityForMonacoLanguage(monaco), `no capability entry for ${p} -> ${monaco}`).toBeTruthy();
    }
  });

  it('basic-tier languages list only genuinely available features', () => {
    const rb = capabilityForMonacoLanguage('ruby');
    expect(rb.intellisense).toBe('basic');
    expect(rb.features).not.toContain('definition');
    expect(rb.features).not.toContain('semanticDiagnostics');
    expect(rb.features).toContain('wordBasedSuggestions');
    expect(describeIntellisense('ruby')).toMatch(/Syntax highlighting/);
    expect(describeIntellisense('ruby')).not.toMatch(/Full IntelliSense/);
  });

  it('language-server tier claims LS features only and reflects the live connection state', () => {
    const py = capabilityForMonacoLanguage('python');
    expect(py.intellisense).toBe('language-server');
    // The advertised set is exactly what the thin LSP client maps — rename is
    // deliberately not among them, so the registry can never overclaim.
    expect(py.features).toBe(LSP_WIRED_FEATURES);
    expect(py.features).toContain('definition');
    expect(py.features).toContain('semanticDiagnostics');
    expect(py.features).not.toContain('rename');
    // No connection state => never claims more than highlighting.
    expect(describeIntellisense('python')).toMatch(/Syntax highlighting/);
    expect(describeIntellisense('python')).not.toMatch(/Full IntelliSense/);
    expect(describeIntellisense('python')).toMatch(/needs the pyright language server/);
    // Ready => describes exactly the connected server's mapped features.
    expect(describeIntellisense('python', 'ready')).toMatch(/connected via pyright/);
    expect(describeIntellisense('python', 'ready')).not.toMatch(/rename/);
    // Missing tool => honest fallback wording.
    expect(describeIntellisense('python', 'missing-tool')).toMatch(/not installed/);
  });

  it('every lsp descriptor is well-formed', () => {
    for (const l of LANGUAGES) {
      if (!l.lsp) continue;
      expect(typeof l.lsp.server, l.id).toBe('string');
      expect(l.lsp.server.length, l.id).toBeGreaterThan(0);
      expect(typeof l.lsp.tool, l.id).toBe('string');
      expect(typeof l.lsp.wired, l.id).toBe('boolean');
      expect(Array.isArray(l.lsp.features), l.id).toBe(true);
      expect(Array.isArray(l.lsp.rootMarkers), l.id).toBe(true);
      if (!l.lsp.wired) {
        // Registry-only candidates claim no features and no editor tier.
        expect(l.lsp.features, l.id).toEqual([]);
        expect(l.intellisense, l.id).not.toBe('language-server');
      } else {
        expect(l.lsp.features, l.id).toBe(LSP_WIRED_FEATURES);
        expect(l.intellisense, l.id).toBe('language-server');
      }
    }
  });

  it('wired lsp entries mirror exactly the main-process bridge descriptors', () => {
    const wired = lspLanguages().map((l) => l.monaco).sort();
    expect(wired).toEqual(Object.keys(LS_DESCRIPTORS).sort());
    for (const l of lspLanguages()) {
      const d = LS_DESCRIPTORS[l.monaco];
      // Same tool the desktop app would actually spawn — one source of truth.
      expect(l.lsp.tool, l.monaco).toBe(d.tool);
      expect(l.lsp.server, l.monaco).toBe(d.id);
      expect(lspDescriptorForMonacoLanguage(l.monaco)).toBeTruthy();
    }
    // Languages the bridge cannot start must never be advertised as wired.
    expect(lspDescriptorForMonacoLanguage('go')).toBeNull();
    expect(lspDescriptorForMonacoLanguage('ruby')).toBeNull();
  });

  it('bundled worker languages keep the Monaco service and are not rerouted', () => {
    // JS/TS/JSON/CSS/SCSS/Less/HTML must not gain an external server wiring.
    for (const id of ['javascript', 'typescript', 'json', 'css', 'scss', 'less', 'html']) {
      const cap = capabilityForMonacoLanguage(id);
      expect(cap.intellisense, id).toBe('language-service');
      expect(cap.lsp, id).toBeNull();
      expect(lspDescriptorForMonacoLanguage(id), id).toBeNull();
    }
  });

  it('describes language-service tiers as full IntelliSense', () => {
    expect(describeIntellisense('typescript')).toMatch(/Full IntelliSense/);
    expect(describeIntellisense('nonexistent-lang')).toMatch(/No grammar bundled/);
  });

  it('marks exactly the static-web languages as preview participants', () => {
    const ids = previewLanguages().map((l) => l.monaco).sort();
    expect(ids).toEqual(['css', 'html', 'javascript', 'less', 'scss'].sort());
  });

  it('only promises offline desktop runs the Electron main process can actually execute', () => {
    const claimed = localRunLanguages().map((l) => l.localRun);
    // Every advertised offline key must have a real plan in localRun.ts, or the
    // desktop "Run" would promise an execution that cannot happen.
    for (const key of claimed) {
      expect(LOCAL_PLANS[key], `renderer claims offline "${key}" but localRun.ts has no plan`).toBeTruthy();
    }
    // And the main process must not gain a plan the registry forgot to advertise.
    for (const key of Object.keys(LOCAL_PLANS)) {
      expect(claimed, `localRun.ts can run "${key}" but no registry entry advertises it`).toContain(key);
    }
    // Exactly the runtimes verified offline (the P2 set + the Java, C++ and
    // TypeScript run work), nothing more: C/Go and friends still have a terminal
    // toolchain, not a plan. C++ is here because the compiler is located and run,
    // and the multi-file project is planned from its own build descriptor.
    // TypeScript is here because the project's own tsc compiles the file and the
    // emitted JavaScript is run on Node (a .tsx module is honestly refused).
    expect([...new Set(claimed)].sort()).toEqual(['cpp', 'java', 'javascript', 'powershell', 'python', 'typescript']);
    // The lookup the Run action uses agrees with the registry entry.
    expect(localRunKeyFor('python')).toBe('python');
    expect(localRunKeyFor('javascript')).toBe('javascript');
    expect(localRunKeyFor('powershell')).toBe('powershell');
    expect(localRunKeyFor('java')).toBe('java');
    expect(localRunKeyFor('cpp')).toBe('cpp');
    expect(localRunKeyFor('typescript')).toBe('typescript');
    // A language that only has a terminal toolchain is NOT advertised as offline.
    expect(localRunKeyFor('c')).toBeNull();
    expect(localRunKeyFor('go')).toBeNull();
  });

  it('names a separately configurable compiler only for the offline run that needs one', () => {
    // clangd answers IntelliSense for C++; g++ answers the build. They are
    // different programs, so the run gets its own path setting — and a language
    // that runs through an interpreter must not claim one.
    expect(capabilityForMonacoLanguage('cpp').compiler).toMatchObject({ tool: 'g++ / clang++' });
    expect(capabilityForMonacoLanguage('java').compiler).toBeNull();
    expect(capabilityForMonacoLanguage('python').compiler).toBeNull();
    // Every entry advertising a compiler path must be an offline run too.
    for (const cap of catalogueEntries()) {
      if (cap.compiler) expect(cap.localRun, cap.id).toBeTruthy();
    }
  });

  it('keeps execution capability independent of the language server', () => {
    // The reported status bar said "C++ - highlighting - online runner" while
    // g++ was installed: the LS chip must not decide what Run is allowed to do.
    const cap = capabilityForMonacoLanguage('cpp');
    expect(cap.localRun).toBe('cpp');
    expect(describeCapabilities(cap, 'missing-tool')).toMatch(/offline in desktop app/);
    expect(describeCapabilities(cap, 'ready')).toMatch(/offline in desktop app/);
  });
});

describe('mode-aware Run sentences (the browser is not the desktop app)', () => {
  it('describes JavaScript differently per mode', () => {
    const js = capabilityForMonacoLanguage('javascript');
    expect(describeRunForMode(js, 'web')).toMatch(/in this browser/i);
    expect(describeRunForMode(js, 'web')).toMatch(/not Node\.js/i);
    expect(describeRunForMode(js, 'desktop')).toMatch(/offline/i);
  });

  it('never claims a native language runs inside the browser', () => {
    for (const id of ['cpp', 'java', 'python', 'go', 'rust']) {
      const cap = capabilityForMonacoLanguage(id);
      if (!cap) continue;
      const web = describeRunForMode(cap, 'web');
      expect(web, id).not.toMatch(/in this browser/i);
    }
  });

  it('lists only JavaScript as browser-runnable', () => {
    // Two registry entries share the `javascript` Monaco id (plain and the JSX
    // variant); both are JavaScript, and nothing else is browser-runnable.
    expect([...new Set(browserRunLanguages().map((l) => l.monaco))]).toEqual(['javascript']);
  });

  it('threads the mode through describeCapabilities', () => {
    const js = capabilityForMonacoLanguage('javascript');
    expect(describeCapabilities(js, undefined, 'web')).toMatch(/in this browser/i);
  });
});
