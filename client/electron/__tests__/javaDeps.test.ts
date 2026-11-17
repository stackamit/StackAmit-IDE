import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isValidCoordinate,
  parseCoordinate,
  artifactRelPath,
  groupPath,
  parsePom,
  interpolate,
  resolveGraph,
  resolveJavaDependencies,
  sanitizeClasspath,
  type Coordinate,
  type DepIo,
} from '../services/javaDeps';

/**
 * Maven Central resolution — the deterministic core.
 *
 * The graph walk (`resolveGraph`) is pure with respect to IO: an injected `DepIo`
 * answers POM reads and JAR lookups, so transitive resolution, scope filtering,
 * version mediation, and missing-dependency reporting are all exercised here with
 * zero network. `resolveJavaDependencies` is then driven against a throwaway
 * repository directory and a scripted `fetchImpl`, which proves the real cache +
 * offline behavior without touching the developer's actual `~/.m2`.
 */

const c = (raw: string): Coordinate => {
  const p = parseCoordinate(raw);
  if (!p) throw new Error(`bad fixture coordinate ${raw}`);
  return p;
};

/** Build a believable POM document. */
function pomXml(opts: {
  groupId: string;
  artifactId: string;
  version: string;
  packaging?: string;
  deps?: { g: string; a: string; v?: string; scope?: string; optional?: boolean }[];
  managed?: { g: string; a: string; v: string }[];
  properties?: Record<string, string>;
  parent?: { g: string; a: string; v: string };
}): string {
  const props = opts.properties
    ? `<properties>${Object.entries(opts.properties).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</properties>`
    : '';
  const parent = opts.parent
    ? `<parent><groupId>${opts.parent.g}</groupId><artifactId>${opts.parent.a}</artifactId><version>${opts.parent.v}</version></parent>`
    : '';
  const dm = opts.managed?.length
    ? `<dependencyManagement><dependencies>${opts.managed.map((m) => `<dependency><groupId>${m.g}</groupId><artifactId>${m.a}</artifactId><version>${m.v}</version></dependency>`).join('')}</dependencies></dependencyManagement>`
    : '';
  const deps = opts.deps?.length
    ? `<dependencies>${opts.deps
        .map((d) => {
          const parts = [`<groupId>${d.g}</groupId>`, `<artifactId>${d.a}</artifactId>`];
          if (d.v) parts.push(`<version>${d.v}</version>`);
          if (d.scope) parts.push(`<scope>${d.scope}</scope>`);
          if (d.optional) parts.push('<optional>true</optional>');
          return `<dependency>${parts.join('')}</dependency>`;
        })
        .join('')}</dependencies>`
    : '';
  return `<?xml version="1.0"?><project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>${parent}<groupId>${opts.groupId}</groupId><artifactId>${opts.artifactId}</artifactId><version>${opts.version}</version>${opts.packaging ? `<packaging>${opts.packaging}</packaging>` : ''}${props}${dm}${deps}</project>`;
}

/** A table-driven DepIo: which GAVs exist, their POMs, and whether they ship a JAR. */
function mockIo(
  poms: Record<string, string>,
  { jarGavs, downloads = 0 }: { jarGavs?: Set<string>; downloads?: number } = {},
): DepIo & { calls: string[] } {
  const calls: string[] = [];
  const has = (coord: Coordinate) => `${coord.groupId}:${coord.artifactId}:${coord.version}`;
  return {
    calls,
    stats: { downloads },
    async readPom(coord) {
      const key = has(coord);
      calls.push(`pom:${key}`);
      const xml = poms[key];
      if (!xml) throw new Error(`404 ${key}.pom`);
      return xml;
    },
    async ensureJar(coord) {
      const key = has(coord);
      calls.push(`jar:${key}`);
      // Only "jar" packaging contributes a classpath entry; the walk guards this.
      return jarGavs && !jarGavs.has(key) ? null : path.posix.join('/repo', groupPath(coord.groupId), coord.artifactId, coord.version, `${coord.artifactId}-${coord.version}.jar`);
    },
  };
}

describe('coordinate validation (req 14)', () => {
  it('accepts well-formed g:a:v and g:a:v:classifier', () => {
    expect(isValidCoordinate('org.apache.commons:commons-lang3:3.17.0')).toBe(true);
    expect(isValidCoordinate('a.b.c:d-e_f:1.2.3-SNAPSHOT:sources')).toBe(true);
  });

  it('rejects anything that could escape the cache or is malformed', () => {
    for (const bad of [
      '',
      'just-a-word',
      'two:parts',
      'a:b:',
      'a::c',
      'a:b:c:d:e',
      '../evil:b:c',
      'a:b:../../c',
      'a b:c:d',
      'a:b:c/',
      'a:b:c\\d',
      '.hidden:b:c',
    ]) {
      expect(isValidCoordinate(bad), `must reject ${JSON.stringify(bad)}`).toBe(false);
      expect(parseCoordinate(bad)).toBeNull();
    }
  });

  it('maps a valid coordinate to a traversal-safe repository path', () => {
    expect(groupPath('org.apache.commons')).toBe('org/apache/commons');
    expect(artifactRelPath(c('org.apache.commons:commons-lang3:3.17.0'), 'jar')).toBe(
      path.join('org', 'apache', 'commons', 'commons-lang3', '3.17.0', 'commons-lang3-3.17.0.jar'),
    );
  });
});

describe('parsePom + interpolate', () => {
  it('reads coordinates, packaging, properties, deps, and dependencyManagement', () => {
    const model = parsePom(
      pomXml({
        groupId: 'com.example',
        artifactId: 'app',
        version: '1.0',
        properties: { 'lib.ver': '2.5' },
        managed: [{ g: 'com.example', a: 'managed-lib', v: '${lib.ver}' }],
        deps: [
          { g: 'com.example', a: 'plain', v: '9.9' },
          { g: 'com.example', a: 'managed-lib' },
          { g: 'com.example', a: 'testonly', v: '1', scope: 'test' },
        ],
      }),
    );
    expect(model.coordinate).toEqual({ groupId: 'com.example', artifactId: 'app', version: '1.0' });
    expect(model.packaging).toBe('jar');
    expect(model.properties['lib.ver']).toBe('2.5');
    expect(model.dependencies).toHaveLength(3);
    expect(model.dependencyManagement[0].artifactId).toBe('managed-lib');
  });

  it('keeps the project version when a <parent> block precedes it (inheritance regression)', () => {
    // Maven nests <parent>…<version>73</version></parent> before the artifact's
    // own <version>3.17.0</version>. Reading top-level fields off `root` in
    // document order used to pick up the PARENT's version and corrupt the resolved
    // coordinate/JAR path — the bug that made Commons Lang resolve empty.
    const model = parsePom(
      pomXml({
        groupId: 'org.apache.commons',
        artifactId: 'commons-lang3',
        version: '3.17.0',
        parent: { g: 'org.apache.commons', a: 'commons-parent', v: '73' },
      }),
    );
    expect(model.coordinate).toEqual({ groupId: 'org.apache.commons', artifactId: 'commons-lang3', version: '3.17.0' });
    expect(model.parent).toEqual({ groupId: 'org.apache.commons', artifactId: 'commons-parent', version: '73' });
  });

  it('inherits groupId/version from the parent only where Maven itself would', () => {
    // A child that omits its own <groupId> takes the parent's; an explicit
    // project <version> still wins over the parent's.
    const model = parsePom(
      `<project><modelVersion>4.0.0</modelVersion>` +
        `<parent><groupId>com.acme</groupId><artifactId>bom</artifactId><version>9</version></parent>` +
        `<artifactId>widget</artifactId><version>1.2.3</version></project>`,
    );
    expect(model.coordinate).toEqual({ groupId: 'com.acme', artifactId: 'widget', version: '1.2.3' });
  });

  it('interpolates properties and Maven built-ins, leaving unknown tokens intact', () => {
    const model = parsePom(pomXml({ groupId: 'g', artifactId: 'a', version: '1', properties: { v: '7.7' } }));
    expect(interpolate('${v}', model.properties, model)).toBe('7.7');
    expect(interpolate('${project.version}', {}, model)).toBe('1');
    // An unresolvable reference is left as-is so the caller reports it.
    expect(interpolate('${nope.here}', {}, model)).toBe('${nope.here}');
  });
});

describe('resolveGraph (reqs 5, 7, 8, 12, 13)', () => {
  it('resolves a single dependency to its JAR (req 5, mocked)', async () => {
    const io = mockIo({
      'org.apache.commons:commons-lang3:3.17.0': pomXml({ groupId: 'org.apache.commons', artifactId: 'commons-lang3', version: '3.17.0' }),
    });
    const out = await resolveGraph([c('org.apache.commons:commons-lang3:3.17.0')], io);
    expect(out.ok).toBe(true);
    expect(out.classpath).toHaveLength(1);
    expect(out.classpath[0]).toContain('commons-lang3-3.17.0.jar');
  });

  it('turns an explicit root whose JAR is absent into an actionable failure (req 7)', async () => {
    const io = mockIo(
      { 'com.example:app:1.0': pomXml({ groupId: 'com.example', artifactId: 'app', version: '1.0' }) },
      { jarGavs: new Set() }, // ensureJar returns null for every coordinate
    );
    const out = await resolveGraph([c('com.example:app:1.0')], io);
    expect(out.ok).toBe(false);
    expect(out.classpath).toHaveLength(0);
    expect(out.missing.some((m) => m.coordinate === 'com.example:app:1.0' && /JAR was not found/i.test(m.reason))).toBe(true);
  });

  it('includes transitive compile/runtime deps and excludes provided/test/optional (req 8)', async () => {
    const poms = {
      'com.example:app:1.0': pomXml({
        groupId: 'com.example',
        artifactId: 'app',
        version: '1.0',
        deps: [
          { g: 'com.example', a: 'compile-dep', v: '1.0' },
          { g: 'com.example', a: 'runtime-dep', v: '1.0', scope: 'runtime' },
          { g: 'com.example', a: 'provided-dep', v: '1.0', scope: 'provided' },
          { g: 'com.example', a: 'test-dep', v: '1.0', scope: 'test' },
          { g: 'com.example', a: 'optional-dep', v: '1.0', optional: true },
        ],
      }),
      'com.example:compile-dep:1.0': pomXml({
        groupId: 'com.example',
        artifactId: 'compile-dep',
        version: '1.0',
        deps: [{ g: 'com.example', a: 'transitive-deep', v: '2.0' }],
      }),
      'com.example:runtime-dep:1.0': pomXml({ groupId: 'com.example', artifactId: 'runtime-dep', version: '1.0' }),
      'com.example:transitive-deep:2.0': pomXml({ groupId: 'com.example', artifactId: 'transitive-deep', version: '2.0' }),
    };
    const io = mockIo(poms);
    const out = await resolveGraph([c('com.example:app:1.0')], io);
    const arts = out.resolved.map((r) => r.artifactId);
    expect(arts).toContain('compile-dep');
    expect(arts).toContain('runtime-dep');
    expect(arts).toContain('transitive-deep');
    expect(arts).not.toContain('provided-dep');
    expect(arts).not.toContain('test-dep');
    expect(arts).not.toContain('optional-dep');
    // app is a pom-less aggregator here it still has a jar; depth ordering:
    expect(out.resolved.find((r) => r.artifactId === 'transitive-deep')!.depth).toBe(2);
  });

  it('applies nearest-wins mediation and records the skipped version as a conflict (req 8)', async () => {
    const poms = {
      'com.example:app:1.0': pomXml({
        groupId: 'com.example',
        artifactId: 'app',
        version: '1.0',
        deps: [
          { g: 'com.example', a: 'shared', v: '1.0' }, // nearer
          { g: 'com.example', a: 'middle', v: '1.0' },
        ],
      }),
      'com.example:middle:1.0': pomXml({ groupId: 'com.example', artifactId: 'middle', version: '1.0', deps: [{ g: 'com.example', a: 'shared', v: '9.0' }] }),
      'com.example:shared:1.0': pomXml({ groupId: 'com.example', artifactId: 'shared', version: '1.0' }),
      'com.example:shared:9.0': pomXml({ groupId: 'com.example', artifactId: 'shared', version: '9.0' }),
    };
    const io = mockIo(poms);
    const out = await resolveGraph([c('com.example:app:1.0')], io);
    const kept = out.resolved.find((r) => r.artifactId === 'shared')!;
    expect(kept.version).toBe('1.0'); // the shallow declaration wins
    expect(out.conflicts.some((k) => k.coordinate === 'com.example:shared' && k.kept === '1.0' && k.skipped === '9.0')).toBe(true);
  });

  it('turns an unresolvable dependency into an actionable missing entry (req 7)', async () => {
    const poms = {
      'com.example:app:1.0': pomXml({ groupId: 'com.example', artifactId: 'app', version: '1.0', deps: [{ g: 'com.example', a: 'gone', v: '1.0' }] }),
      // com.example:gone:1.0 has NO pom in the fixture table → readPom throws.
    };
    const io = mockIo(poms);
    const out = await resolveGraph([c('com.example:app:1.0')], io);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.coordinate === 'com.example:gone:1.0')).toBe(true);
    expect(out.missing.some((m) => m.coordinate === 'com.example:gone:1.0')).toBe(true);
  });

  it('reports a version-less dependency (BOM-only) instead of guessing a version', async () => {
    const poms = {
      'com.example:app:1.0': pomXml({ groupId: 'com.example', artifactId: 'app', version: '1.0', deps: [{ g: 'com.example', a: 'from-bom' }] }),
    };
    const io = mockIo(poms);
    const out = await resolveGraph([c('com.example:app:1.0')], io);
    expect(out.ok).toBe(false);
    expect(out.missing.some((m) => m.coordinate === 'com.example:from-bom' && /BOM|no version/i.test(m.reason))).toBe(true);
  });

  it('marks a fully-cached walk as fromCacheOnly (reqs 12, 13 pure)', async () => {
    const poms = { 'com.example:lib:1.0': pomXml({ groupId: 'com.example', artifactId: 'lib', version: '1.0' }) };
    const io = mockIo(poms, { downloads: 0 });
    const out = await resolveGraph([c('com.example:lib:1.0')], io);
    expect(out.fromCacheOnly).toBe(true);
  });
});

describe('resolveJavaDependencies against a real cache + scripted HTTPS (reqs 5, 12, 13, 14)', () => {
  function tempRepo(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'java-deps-repo-'));
  }

  // A one-artifact Maven Central: only commons-lang3's pom + jar exist.
  function lang3Fetch() {
    const POM = pomXml({ groupId: 'org.apache.commons', artifactId: 'commons-lang3', version: '3.17.0' });
    return async (url: string) => {
      if (url.endsWith('commons-lang3-3.17.0.pom')) {
        return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(POM).buffer };
      }
      if (url.endsWith('commons-lang3-3.17.0.jar')) {
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer };
      }
      return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    };
  }

  it('downloads on first resolve and serves the second entirely from cache (offline)', async () => {
    const repo = tempRepo();
    const coords = ['org.apache.commons:commons-lang3:3.17.0'];

    let fetchCount = 0;
    const countingFetch = async (url: string) => {
      fetchCount += 1;
      return lang3Fetch()(url);
    };

    const first = await resolveJavaDependencies({ coordinates: coords, repositoryRoot: repo, fetchImpl: countingFetch as unknown as typeof fetch });
    expect(first.ok).toBe(true);
    expect(first.fromCacheOnly).toBe(false);
    expect(first.classpath).toHaveLength(1);
    expect(first.classpath[0].endsWith(`commons-lang3-3.17.0.jar`)).toBe(true);
    expect(fs.existsSync(first.classpath[0])).toBe(true);
    expect(fetchCount).toBeGreaterThan(0);

    // Second pass: offline. No fetch is allowed to happen; the cached files win.
    let offlineFetchUsed = 0;
    const neverFetch = async () => {
      offlineFetchUsed += 1;
      throw new Error('offline resolve must not hit the network');
    };
    const second = await resolveJavaDependencies({ coordinates: coords, repositoryRoot: repo, offline: true, fetchImpl: neverFetch as unknown as typeof fetch });
    expect(second.ok).toBe(true);
    expect(second.fromCacheOnly).toBe(true);
    expect(offlineFetchUsed).toBe(0);
    expect(second.classpath).toEqual(first.classpath);
  });

  it('never reaches the network for invalid coordinates — they come back as errors (req 14)', async () => {
    const repo = tempRepo();
    let fetchUsed = 0;
    const spyFetch = (async () => {
      fetchUsed += 1;
      throw new Error('should not fetch');
    }) as unknown as typeof fetch;
    const out = await resolveJavaDependencies({ coordinates: ['../../bad:x:1', 'a:b', 'a b:c:d'], repositoryRoot: repo, fetchImpl: spyFetch });
    // Every coordinate is invalid, so none is walked and none is fetched.
    expect(out.ok).toBe(false);
    expect(out.errors.filter((e) => /invalid Maven coordinate/.test(e.message)).length).toBe(3);
    expect(fetchUsed).toBe(0);
  });
});

describe('sanitizeClasspath (a run only ever gets managed JARs)', () => {
  it('keeps only .jar paths under the extra roots it was given', () => {
    const root = path.resolve(os.tmpdir(), 'managed-repo');
    const inside = path.join(root, 'a', 'lib.jar');
    const outsider = path.resolve(os.tmpdir(), 'elsewhere', 'evil.jar');
    const notAJar = path.join(root, 'notes.txt');
    const out = sanitizeClasspath([inside, outsider, notAJar, null, 42, ''], [root]);
    expect(out).toEqual([inside]);
  });

  it('drops everything when the array is not a managed repository', () => {
    expect(sanitizeClasspath(['/tmp/x.jar'], [path.resolve(os.tmpdir(), 'unrelated-root')])).toEqual([]);
    expect(sanitizeClasspath('not-an-array')).toEqual([]);
  });
});
