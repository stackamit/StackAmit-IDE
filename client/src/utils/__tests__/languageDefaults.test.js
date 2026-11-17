import { describe, it, expect } from 'vitest';
import { DEFAULT_LANGUAGES, languageByKey, DEFAULT_LANGUAGE_KEY } from '../languageDefaults.js';
import { catalogueEntries } from '../../languages/languageCapabilities.js';

describe('language defaults', () => {
  it('covers the five required languages', () => {
    const keys = DEFAULT_LANGUAGES.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(['python', 'c', 'cpp', 'java', 'javascript']));
    expect(DEFAULT_LANGUAGE_KEY).toBe('python');
  });

  it('mirrors the capability registry exactly — no extra, no missing runner', () => {
    const fromRegistry = catalogueEntries()
      .filter((cap) => cap.run && !cap.variantOf)
      .map((cap) => cap.run)
      .sort();
    expect(DEFAULT_LANGUAGES.map((l) => l.key).sort()).toEqual(fromRegistry);
  });

  it('maps each language to a valid Monaco id and starter code', () => {
    for (const lang of DEFAULT_LANGUAGES) {
      expect(typeof lang.monaco).toBe('string');
      expect(lang.monaco.length).toBeGreaterThan(0);
      expect(lang.starter).toContain('\n'); // multiline starter programs
      expect(lang.fileName).toBeTruthy();
    }
  });

  it('preserves C string escapes inside the starter (printf newline)', () => {
    const c = languageByKey(DEFAULT_LANGUAGES, 'c');
    // The editor text should literally contain a backslash-n for printf.
    expect(c.starter).toContain('printf("Hello, World!\\n");');
  });

  it('languageByKey falls back to the first entry for unknown keys', () => {
    expect(languageByKey(DEFAULT_LANGUAGES, 'not-a-language')).toBe(DEFAULT_LANGUAGES[0]);
  });
});
