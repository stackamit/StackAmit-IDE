import { describe, it, expect } from 'vitest';
import {
  JAVA_LIBRARY_CATALOG,
  CATEGORIES,
  listCatalog,
  getById,
  findByPackage,
  listByCategory,
} from '../javaLibraryCatalog.js';

/**
 * The 100-library catalog is *data*, but its value rests on invariants the rest
 * of the feature assumes. These tests pin them so a future edit cannot quietly
 * break import→dependency mapping or ship a half-filled record:
 *  - exactly 100 entries, unique ids and unique coordinates;
 *  - every entry carries the metadata the UI/resolver reads;
 *  - `webCompatible` is false for all (the provider truth), `desktopCompatible`
 *    true;
 *  - `findByPackage` maps a real import to the artifact that provides it and
 *    ignores comments/unknowns.
 */

describe('javaLibraryCatalog shape', () => {
  it('contains exactly 100 entries (req 1)', () => {
    expect(JAVA_LIBRARY_CATALOG).toHaveLength(100);
    expect(listCatalog()).toHaveLength(100);
  });

  it('has unique ids and unique coordinates (req 1)', () => {
    const ids = JAVA_LIBRARY_CATALOG.map((e) => e.id);
    const coords = JAVA_LIBRARY_CATALOG.map((e) => e.coordinate);
    expect(new Set(ids).size).toBe(100);
    expect(new Set(coords).size).toBe(100);
  });

  it('spans the 20 required categories with the exported list (req 1)', () => {
    expect(CATEGORIES).toHaveLength(20);
    const grouped = listByCategory();
    // Every category key is present (possibly empty), and every entry lands in
    // one of the declared categories.
    for (const c of CATEGORIES) expect(Array.isArray(grouped[c])).toBe(true);
    for (const e of JAVA_LIBRARY_CATALOG) expect(CATEGORIES).toContain(e.category);
    // The grouping is a partition: no entry lost, none duplicated.
    const total = Object.values(grouped).reduce((n, list) => n + list.length, 0);
    expect(total).toBe(100);
  });

  it('every entry carries complete, well-formed metadata (req 2)', () => {
    const COORD = /^[A-Za-z0-9_][A-Za-z0-9_.-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
    for (const e of JAVA_LIBRARY_CATALOG) {
      expect(e.id, `id for ${e.name}`).toBeTruthy();
      expect(e.name, `name for ${e.id}`).toBeTruthy();
      expect(typeof e.description).toBe('string');
      expect(CATEGORIES).toContain(e.category);
      expect(e.groupId).toBeTruthy();
      expect(e.artifactId).toBeTruthy();
      expect(e.version).toBeTruthy();
      // Coordinate is the canonical g:a:v the resolver consumes.
      expect(e.coordinate).toBe(`${e.groupId}:${e.artifactId}:${e.version}`);
      expect(e.coordinate).toMatch(COORD);
      expect(Array.isArray(e.packages) && e.packages.length > 0, `packages for ${e.id}`).toBe(true);
      expect(e.repo).toBe('central');
      // Provider reality: no third-party Maven dep runs in the web provider.
      expect(e.webCompatible).toBe(false);
      expect(e.desktopCompatible).toBe(true);
      // Verification status is honest — verified or pending, never fabricated.
      expect(['verified', 'pending']).toContain(e.verificationStatus);
      expect(e.license).toBeTruthy();
      expect(e.source).toContain('search.maven.org');
    }
  });

  it('records all 100 as verified after the pinned Maven Central check', () => {
    const unverified = JAVA_LIBRARY_CATALOG.filter((e) => e.verificationStatus !== 'verified');
    // If this ever grows, the catalog drifted; re-run scripts/verify-java-catalog.mjs.
    expect(unverified.map((e) => e.id)).toEqual([]);
    const stamp = JAVA_LIBRARY_CATALOG[0].verifiedAt;
    expect(stamp).toBeTruthy();
    for (const e of JAVA_LIBRARY_CATALOG) expect(e.verifiedAt).toBe(stamp);
  });
});

describe('findByPackage (import → dependency mapping)', () => {
  it('maps a known library import to its artifact (req 2)', () => {
    const hits = findByPackage('org.apache.commons.lang3.StringUtils');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].artifactId).toBe('commons-lang3');
  });

  it('maps a wildcard package prefix, not just a class', () => {
    const hits = findByPackage('com.google.common.collect');
    expect(hits.some((e) => e.artifactId === 'guava')).toBe(true);
  });

  it('returns nothing for JDK or unknown packages (never guesses)', () => {
    expect(findByPackage('java.util.List')).toEqual([]);
    expect(findByPackage('javax.swing.JFrame')).toEqual([]);
    expect(findByPackage('com.totally.unknown.ButNotInCatalog')).toEqual([]);
    expect(findByPackage('')).toEqual([]);
    expect(findByPackage(null)).toEqual([]);
  });

  it('prefers the longest matching package prefix', () => {
    // A more specific package should win over a shorter shared prefix.
    const hits = findByPackage('org.springframework.context.ApplicationContext');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].packages.some((p) => p === 'org.springframework')).toBe(true);
  });
});

describe('getById', () => {
  it('returns the entry by id and null for an unknown id', () => {
    const first = JAVA_LIBRARY_CATALOG[0];
    expect(getById(first.id)).toBe(first);
    expect(getById('__nope__')).toBeNull();
  });
});
