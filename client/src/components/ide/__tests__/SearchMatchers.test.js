import { describe, it, expect, vi } from 'vitest';

// The Search matchers live in SidebarView.jsx next to the panel UI. Importing
// that module drags in the Monaco theme registry (workers + DOM), which cannot
// load under jsdom; only the theme module needs stubbing to reach the pure
// functions under test.
vi.mock('../../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
}));

import { buildMatcher, matchLine, replaceLine } from '../SidebarView.jsx';

describe('SearchView — buildMatcher', () => {
  it('is case-insensitive by default and literal about punctuation', () => {
    const m = buildMatcher('Foo.bar');
    expect(m.error).toBeNull();
    expect(matchLine('a FOObqx line', m)).toBeNull();
    expect(matchLine('the Foo.bar here', m)).not.toBeNull();
    // The dot was escaped, so it did not match "FooXbar".
    expect(matchLine('FooXbar', m)).toBeNull();
  });

  it('honours case sensitivity', () => {
    const ci = buildMatcher('foo');
    const cs = buildMatcher('foo', { caseSensitive: true });
    expect(matchLine('FOO', ci)).not.toBeNull();
    expect(matchLine('FOO', cs)).toBeNull();
    expect(matchLine('foo', cs)).not.toBeNull();
  });

  it('whole-word does not fire inside a larger identifier', () => {
    const m = buildMatcher('id', { wholeWord: true });
    expect(matchLine('const id = 1', m)).not.toBeNull();
    expect(matchLine('identifier', m)).toBeNull();
    // `$` counts as word-adjacent, so `my$id` is one token and `id` is not
    // standing alone: it must not match there either.
    expect(matchLine('my$id', m)).toBeNull();
    expect(matchLine('let id=2', m)).not.toBeNull();
  });

  it('reports an invalid regex instead of returning no matches', () => {
    const m = buildMatcher('(', { regex: true });
    expect(m.re).toBeNull();
    expect(typeof m.error).toBe('string');
  });

  it('returns null for an empty query', () => {
    expect(buildMatcher('')).toBeNull();
    expect(matchLine('anything', null)).toBeNull();
  });
});

describe('SearchView — matchLine columns', () => {
  it('returns 1-based usable hits with their index and text', () => {
    const m = buildMatcher('ab');
    const hits = matchLine('x ab y ab', m);
    expect(hits.length).toBe(2);
    expect(hits[0]).toEqual({ index: 2, text: 'ab' });
  });

  it('survives a zero-width pattern without spinning', () => {
    const m = buildMatcher('b*', { regex: true });
    const hits = matchLine('abc', m);
    expect(Array.isArray(hits)).toBe(true);
  });
});

describe('SearchView — replaceLine', () => {
  it('treats a literal replacement verbatim (no $& interpretation)', () => {
    const m = buildMatcher('foo');
    expect(replaceLine('foo bar foo', m, 'X$&Y')).toBe('X$&Y bar X$&Y');
  });

  it('lets a regex replacement use capture groups', () => {
    const m = buildMatcher('(\\w+)\\s(\\w+)', { regex: true });
    expect(replaceLine('hello world', m, '$2 $1', { regex: true })).toBe('world hello');
  });
});
