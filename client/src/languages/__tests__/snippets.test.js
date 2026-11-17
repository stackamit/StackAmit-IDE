import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SNIPPETS, registerSnippetProviders } from '../snippets.js';
import { LANGUAGES } from '../languageCapabilities.js';

/** Minimal stand-in for the parts of the Monaco API the provider touches. */
function fakeMonaco() {
  const registered = [];
  return {
    registered,
    languages: {
      registerCompletionItemProvider: (id, provider) => {
        registered.push({ id, provider });
        return { dispose: vi.fn() };
      },
      CompletionItemKind: { Snippet: 26 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
  };
}

const fakeModel = (wordUntil = { startColumn: 1, endColumn: 1 }) => ({
  getWordUntilPosition: () => wordUntil,
});

describe('snippet completion providers', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('covers exactly the registry languages flagged `snippets: true`', () => {
    const fromRegistry = LANGUAGES.filter((l) => l.snippets).map((l) => l.monaco).sort();
    expect(Object.keys(SNIPPETS).sort()).toEqual(fromRegistry);
  });

  it('every snippet uses valid tab-stop syntax and has a label', () => {
    for (const list of Object.values(SNIPPETS)) {
      for (const s of list) {
        expect(s.prefix).toBeTruthy();
        expect(s.label).toBeTruthy();
        expect(s.body).toBeTruthy();
        // Only $0-$9 / ${n} placeholders — nothing that would insert literally.
        expect(s.body).not.toMatch(/\$(?:10|\{1[0-9]\})/);
      }
    }
  });

  it('registers one real provider per language and returns snippet items', () => {
    const monaco = fakeMonaco();
    registerSnippetProviders(monaco);
    expect(new Set(monaco.registered.map((r) => r.id))).toEqual(new Set(Object.keys(SNIPPETS)));
    const { provider } = monaco.registered[0];
    const res = provider.provideCompletionItems(fakeModel(), { lineNumber: 1, column: 1 });
    expect(res.suggestions.length).toBeGreaterThan(0);
    expect(res.suggestions[0].insertTextRules).toBe(4); // InsertAsSnippet
    expect(res.suggestions[0].kind).toBe(26); // Snippet
  });

  it('is idempotent per Monaco instance and honours the pref switch', () => {
    const monaco = fakeMonaco();
    registerSnippetProviders(monaco);
    registerSnippetProviders(monaco); // second call must not double-register
    expect(monaco.registered.length).toBe(Object.keys(SNIPPETS).length);
    window.localStorage.setItem('stackamit:editor-prefs', JSON.stringify({ snippets: false }));
    const res = monaco.registered[0].provider.provideCompletionItems(fakeModel(), { lineNumber: 1, column: 1 });
    expect(res.suggestions).toEqual([]);
  });
});
