import { describe, it, expect, beforeAll } from 'vitest';
// Editor API + every language contribution the app registers, i.e. the same
// language set src/monaco/monacoSetup.js exposes at runtime (basic-languages +
// the four real language services). The full `editor.main` entry additionally
// boots standalone UI contributions that jsdom cannot host, so it is avoided
// here without dropping any language registration.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/css/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/html/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import { CUSTOM_LANGUAGES, registerCustomLanguages } from '../customLanguages.js';
import { LANGUAGES, capabilityForMonacoLanguage } from '../languageCapabilities.js';

// Snapshot before our own registration runs: what monaco-editor ships on its
// own, with nothing added by this app.
const MONACO_OWN_IDS = new Set(monaco.languages.getLanguages().map((l) => l.id));

/**
 * These tests run against the REAL monaco-editor package (not the fakeMonaco
 * contract double) so that "we ship a grammar for language X" is actually
 * proven, not asserted from a comment in the registry:
 *
 *  1. every registry entry marked 'bundled'/'service' really exists inside
 *     monaco-editor's own language set;
 *  2. every custom Monarch grammar registers, tokenizes representative code,
 *     and produces the token types the grammar claims;
 *  3. no custom grammar collapses a sample into pure `invalid` output.
 */

// Per-grammar probe: source snippet + token types it must produce.
const GRAMMAR_PROBES = {
  matlab: { code: "% comment\nfunction y = f(x)\n  y = 1;\nend", expect: ['comment', 'keyword', 'number'] },
  groovy: { code: "// comment\ndef x = 42\nclass A { def n = 'abc' }", expect: ['comment', 'keyword', 'string.quote'] },
  erlang: { code: "% comment\n-module(hello).\nmain -> io:format(\"~p\", [42]).", expect: ['comment', 'keyword', 'string'] },
  haskell: { code: "-- comment\nmain = do\n  print (1 :: Int)", expect: ['comment', 'keyword', 'number'] },
  ocaml: { code: "(* comment *)\nlet x = 42\nmodule M = struct end", expect: ['comment', 'keyword', 'number'] },
  fortran: { code: "! comment\nprogram p\n  integer :: i = 1\nend program", expect: ['comment', 'keyword', 'number'] },
  cobol: { code: "* comment\n       IDENTIFICATION DIVISION.", expect: ['comment', 'keyword'] },
  asm: { code: "; comment\nsection .text\nmov eax, 1", expect: ['comment', 'keyword', 'variable.name'] },
  vue: { code: "<!-- c -->\n<template><div id=\"a\">{{ x }}</div></template>\n<script>export default { data() { return {} } }</script>", expect: ['comment', 'tag', 'attribute.name', 'keyword'] },
  svelte: { code: "<!-- c -->\n{#if x}<p>hi</p>{/if}", expect: ['comment', 'keyword', 'tag'] },
  astro: { code: "---\nconst a = 1;\n---\n<!-- c -->\n<div>hi</div>", expect: ['comment', 'tag'] },
  toml: { code: "# comment\n[package]\nname = \"x\"\nflag = true\nversion = 1", expect: ['comment', 'type.identifier', 'attribute.name', 'string', 'keyword'] },
  nginx: { code: "# comment\nserver {\n  listen 80;\n  server_name example.com;\n}", expect: ['comment', 'keyword', 'number'] },
  wat: { code: ";; comment\n(module (func (export \"a\") (result i32) i32.const 1))", expect: ['comment', 'keyword', 'string'] },
  makefile: { code: "# comment\nbuild:\n\t$(CXX) -o app main.c\nCXX = g++", expect: ['comment', 'keyword.target', 'variable'] },
  plsql: { code: "-- comment\nBEGIN\n  DBMS_OUTPUT.PUT_LINE('x');\nEND;", expect: ['comment', 'keyword', 'string'] },
};

beforeAll(() => {
  registerCustomLanguages(monaco);
});

describe('custom Monarch grammars against real Monaco', () => {
  it('registers every custom id and every custom grammar is used by the registry', () => {
    const registered = new Set(monaco.languages.getLanguages().map((l) => l.id));
    for (const id of Object.keys(CUSTOM_LANGUAGES)) {
      expect(registered.has(id), `${id} not registered with Monaco`).toBe(true);
      expect(capabilityForMonacoLanguage(id)?.grammar, `${id} registry grammar`).toBe('monarch');
    }
  });

  it.each(Object.entries(GRAMMAR_PROBES))('%s tokenizes comments, keywords and structure', (id, { code, expect: wanted }) => {
    const lines = monaco.editor.tokenize(code, id);
    const flat = lines.flatMap((line) => line.map((t) => t.type));
    expect(flat.length).toBeGreaterThan(0);
    for (const want of wanted) {
      expect(flat.some((t) => t === want || t.startsWith(`${want}.`)), `${id}: no "${want}" token in [${flat.join(' ')}]`).toBe(true);
    }
    expect(flat.every((t) => !t.startsWith('invalid'))).toBe(true);
  });

  it.each(Object.keys(CUSTOM_LANGUAGES))('%s has a language configuration with brackets', (id) => {
    // setLanguageConfiguration is private to the API surface, so verify the
    // spec directly: brackets + auto-closing pairs must be declared.
    const def = CUSTOM_LANGUAGES[id];
    expect(Array.isArray(def.config.brackets) && def.config.brackets.length > 0).toBe(true);
    expect(Array.isArray(def.config.autoClosingPairs) && def.config.autoClosingPairs.length > 0).toBe(true);
  });
});

describe('registry claims match the real Monaco bundle', () => {
  it('every bundled-tier language id exists in monaco-editor itself', () => {
    const claimed = LANGUAGES.filter((l) => l.grammar === 'bundled' || l.grammar === 'service').map((l) => l.monaco);
    const missing = [...new Set(claimed)].filter((id) => !MONACO_OWN_IDS.has(id));
    expect(missing, `registry claims grammars Monaco does not ship: ${missing.join(', ')}`).toEqual([]);
  });

  it('every monarch-tier language id is one of our custom registrations', () => {
    const claimed = [...new Set(LANGUAGES.filter((l) => l.grammar === 'monarch').map((l) => l.monaco))];
    expect(claimed.sort()).toEqual(Object.keys(CUSTOM_LANGUAGES).sort());
  });

  it('only registers custom grammars where Monaco genuinely ships none', () => {
    const collisions = Object.keys(CUSTOM_LANGUAGES).filter((id) => MONACO_OWN_IDS.has(id));
    expect(collisions, `duplicates of a real Monaco grammar: ${collisions.join(', ')}`).toEqual([]);
    for (const id of Object.keys(CUSTOM_LANGUAGES)) {
      expect(typeof CUSTOM_LANGUAGES[id].monarch.tokenizer.root).toBe('object');
    }
  });

  it('resolves a capability for every language id Monaco knows that we claim', () => {
    for (const l of LANGUAGES) {
      if (l.grammar === 'none') continue;
      expect(capabilityForMonacoLanguage(l.monaco), l.monaco).toBeTruthy();
    }
  });
});
