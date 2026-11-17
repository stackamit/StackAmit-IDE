/**
 * Java dependency resolution (Electron main process).
 *
 * Desktop Mode turns a list of Maven coordinates into a compile + runtime
 * classpath by walking Maven Central POMs and downloading the JARs into the
 * standard `~/.m2/repository` cache. It needs no external `mvn`/Gradle and never
 * runs a downloaded artifact — a JAR here is only ever a classpath *path*.
 *
 * Design notes / honest limits (see the feature README):
 *  - Scope model: `compile` and `runtime` deps are followed; `provided`, `test`,
 *    `system` and `optional` deps are skipped, matching what a plain
 *    `javac`/`java` run needs.
 *  - Version mediation is Maven "nearest-wins": the shallowest declaration of a
 *    `groupId:artifactId` fixes the version; deeper ones are recorded as
 *    conflicts, not silently overridden.
 *  - Exotic builds (BOM-only `import` scope, version *ranges*, multi-module
 *    reactors, classifiers/shaded artifacts) are best-effort: when this resolver
 *    cannot make sense of a POM it reports the coordinate as `missing`/an error
 *    rather than guessing a version. Those cases still work via a manual JAR.
 *  - Everything that touches the network or disk is behind an injectable IO
 *    object, so the graph/POM logic is exercised deterministically in tests with
 *    no network at all.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/** Only this repository is contacted; HTTPS is enforced at fetch time. */
export const MAVEN_CENTRAL_BASE = 'https://repo1.maven.org/maven2';
const MAX_POM_BYTES = 2 * 1024 * 1024; // 2 MiB per POM is far above any real one.
const MAX_JAR_BYTES = 80 * 1024 * 1024; // 80 MiB cap on a single downloaded JAR.
const MAX_DEPTH = 24; // transitive closure guard against pathological graphs.

export type Coordinate = { groupId: string; artifactId: string; version: string; classifier?: string };

/**
 * Strict coordinate grammar: `group:artifact:version` or
 * `group:artifact:version:classifier`. Every segment must be a conservative
 * filesystem- and URL-safe token — notably no `.`/`..` step is possible because
 * a segment may not be only dots and separators are fixed. Rejecting anything
 * else here is what keeps a coordinate from ever escaping the cache directory.
 */
const SEG = '[A-Za-z0-9_][A-Za-z0-9_.\\-]*';
const COORD_RE = new RegExp(`^${SEG}(?:\\.${SEG})*:${SEG}(?:\\.${SEG})*:${SEG}(?::${SEG})?$`);

export function isValidCoordinate(raw: string): boolean {
  if (typeof raw !== 'string' || !COORD_RE.test(raw)) return false;
  // Belt and braces: a resolved path must stay under the cache root.
  const parts = raw.split(':');
  return parts.every((p) => p !== '.' && p !== '..' && !p.includes('/') && !p.includes('\\'));
}

export function parseCoordinate(raw: string): Coordinate | null {
  if (!isValidCoordinate(raw)) return null;
  const [groupId, artifactId, version, classifier] = raw.split(':');
  return { groupId, artifactId, version, ...(classifier ? { classifier } : {}) };
}

export function coordinateKey(groupId: string, artifactId: string): string {
  return `${groupId}:${artifactId}`;
}

export function toGav(coord: Coordinate): string {
  return `${coord.groupId}:${coord.artifactId}:${coord.version}`;
}

/** `group.id` -> `group/id` — used only after the coordinate passed validation. */
export function groupPath(groupId: string): string {
  return groupId.split('.').join('/');
}

/** Path (relative to a repository root) for a coordinate's artifact file. */
export function artifactRelPath(coord: Coordinate, extension: 'jar' | 'pom'): string {
  const classifierSuffix = coord.classifier ? `-${coord.classifier}` : '';
  const file = `${coord.artifactId}-${coord.version}${classifierSuffix}.${extension}`;
  return `${groupPath(coord.groupId)}/${coord.artifactId}/${coord.version}/${file}`.split('/').join(path.sep);
}

// ---- POM model + pure parsing ----------------------------------------------

export type PomDependency = {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;
  optional?: boolean;
  classifier?: string;
  type?: string;
  importScope?: boolean;
};

export type PomModel = {
  coordinate: { groupId: string; artifactId: string; version?: string };
  packaging: string;
  properties: Record<string, string>;
  parent?: { groupId: string; artifactId: string; version: string };
  dependencies: PomDependency[];
  dependencyManagement: PomDependency[];
};

function stripXmlComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Inner text of the first balanced `<tag>…</tag>` at or below `start`. */
function firstElementInner(xml: string, tag: string, from = 0): { inner: string; start: number; end: number } | null {
  const open = new RegExp(`<${escapeRe(tag)}(?:\\s[^>]*)?>`, 'i');
  const rest = xml.slice(from);
  const m = open.exec(rest);
  if (!m) return null;
  const start = from + m.index + m[0].length;
  const closeTag = `</${tag}>`;
  const openTagRe = new RegExp(`<${escapeRe(tag)}(?:\\s[^>]*)?>`, 'gi');
  // Walk forward tracking nesting so a same-named child does not close early.
  let depth = 1;
  let i = start;
  while (i < xml.length && depth > 0) {
    openTagRe.lastIndex = i;
    const nextOpen = openTagRe.exec(xml);
    const nextClose = xml.indexOf(closeTag, i);
    if (nextClose === -1) return null;
    if (nextOpen && nextOpen.index < nextClose) {
      depth += 1;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) return { inner: xml.slice(start, nextClose), start, end: nextClose };
      i = nextClose + closeTag.length;
    }
  }
  return null;
}

function childText(el: string, tag: string): string | undefined {
  const inner = firstElementInner(el, tag);
  return inner ? inner.inner.trim() || undefined : undefined;
}

function parseDependencyBlock(block: string): PomDependency | null {
  const groupId = childText(block, 'groupId');
  const artifactId = childText(block, 'artifactId');
  if (!groupId || !artifactId) return null;
  const scope = childText(block, 'scope');
  const optional = (childText(block, 'optional') || '').toLowerCase() === 'true';
  const d: PomDependency = {
    groupId: groupId.trim(),
    artifactId: artifactId.trim(),
    version: childText(block, 'version')?.trim(),
    scope: scope?.trim(),
    optional,
    classifier: childText(block, 'classifier')?.trim(),
    type: childText(block, 'type')?.trim(),
    importScope: (scope || '').toLowerCase() === 'import',
  };
  return d;
}

function parseDependencyList(container: string): PomDependency[] {
  const deps: PomDependency[] = [];
  const re = /<dependency(?:\s[^>]*)?>([\s\S]*?)<\/dependency>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(container))) {
    const d = parseDependencyBlock(m[1]);
    if (d) deps.push(d);
  }
  return deps;
}

/** Parse a POM's raw XML into a `PomModel`. Pure: no IO, deterministic. */
export function parsePom(xml: string): PomModel {
  const body = stripXmlComments(xml);
  const project = firstElementInner(body, 'project');
  const root = project ? project.inner : body;

  // Anything inside <dependencyManagement> is handled separately, so remove it
  // before harvesting the project's own direct <dependencies>.
  const dm = firstElementInner(root, 'dependencyManagement');
  let dependencyManagement: PomDependency[] = [];
  if (dm) {
    const dmDeps = firstElementInner(dm.inner, 'dependencies');
    if (dmDeps) dependencyManagement = parseDependencyList(dmDeps.inner);
  }
  const rootWithoutDm = dm ? root.replace(/<dependencyManagement[\s\S]*<\/dependencyManagement>/i, '') : root;
  const direct = firstElementInner(rootWithoutDm, 'dependencies');
  const dependencies = direct ? parseDependencyList(direct.inner) : [];

  const parentBlock = firstElementInner(root, 'parent');
  const parent = parentBlock
    ? {
        groupId: (childText(parentBlock.inner, 'groupId') || '').trim(),
        artifactId: (childText(parentBlock.inner, 'artifactId') || '').trim(),
        version: (childText(parentBlock.inner, 'version') || '').trim(),
      }
    : undefined;

  // A POM nests its inherited coordinates inside <parent> *before* the project's
  // own <groupId>/<artifactId>/<version>. `firstElementInner` returns the first
  // match in document order, so reading the top-level fields straight off `root`
  // would pick up the parent's version (e.g. commons-lang3 inherits
  // commons-parent <version>73</version> while the artifact is really 3.17.0).
  // Strip the parent block so the project's own coordinates are read, then fall
  // back to the parent only where Maven itself inherits (groupId/version omitted).
  const rootWithoutParent = parentBlock ? root.replace(/<parent(?:\s[^>]*)?>[\s\S]*?<\/parent>/i, '') : root;

  const properties: Record<string, string> = {};
  const propsBlock = firstElementInner(root, 'properties');
  if (propsBlock) {
    const tagRe = /<([\w.$-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;
    let p: RegExpExecArray | null;
    while ((p = tagRe.exec(propsBlock.inner))) {
      const key = p[1];
      if (key === 'properties') continue;
      properties[key] = p[2].trim();
    }
  }

  return {
    coordinate: {
      groupId: (childText(rootWithoutParent, 'groupId') || parent?.groupId || '').trim(),
      artifactId: (childText(rootWithoutParent, 'artifactId') || '').trim(),
      version: (childText(rootWithoutParent, 'version') || parent?.version || '').trim() || undefined,
    },
    packaging: (childText(rootWithoutParent, 'packaging') || 'jar').trim(),
    properties,
    ...(parent && parent.groupId && parent.artifactId && parent.version ? { parent } : {}),
    dependencies,
    dependencyManagement,
  };
}

const INTERP_RE = /\$\{([^}]+)\}/g;

/**
 * Interpolate `${...}` using the given property table. Recognises the handful of
 * Maven built-ins a bare POM relies on (`project.*`, `pom.*`, `groupId`,
 * `artifactId`, `version`). An unresolvable reference is left as-is so callers
 * can detect and report it rather than resolve to an empty string.
 */
export function interpolate(value: string | undefined, props: Record<string, string>, self: PomModel): string | undefined {
  if (!value || !value.includes('${')) return value;
  const builtins: Record<string, string | undefined> = {
    'project.groupId': self.coordinate.groupId,
    'project.artifactId': self.coordinate.artifactId,
    'project.version': self.coordinate.version,
    'pom.groupId': self.coordinate.groupId,
    'pom.artifactId': self.coordinate.artifactId,
    'pom.version': self.coordinate.version,
    groupId: self.coordinate.groupId,
    artifactId: self.coordinate.artifactId,
    version: self.coordinate.version,
  };
  return value.replace(INTERP_RE, (whole, key: string) => {
    const k = key.trim();
    if (Object.prototype.hasOwnProperty.call(builtins, k) && builtins[k] != null) return builtins[k] as string;
    if (Object.prototype.hasOwnProperty.call(props, k)) return props[k];
    return whole;
  });
}

function hasUnresolved(value?: string): boolean {
  return !!value && value.includes('${');
}

// ---- resolution graph (pure, IO injected) ----------------------------------

export type ResolvedArtifact = {
  coordinate: string;
  groupId: string;
  artifactId: string;
  version: string;
  /** Absolute path to the JAR, when the artifact contributes one. */
  jarPath?: string;
  /** 'jar' | 'pom' | other packaging actually seen. */
  packaging: string;
  /** Depth at which it entered the graph (0 = a requested root). */
  depth: number;
  /** Why it is present, for the UI ("via okhttp"). */
  requestedBy: string;
};

export type ResolveIssue = { coordinate: string; reason: string };

export type ResolveOutcome = {
  ok: boolean;
  classpath: string[];
  resolved: ResolvedArtifact[];
  missing: ResolveIssue[];
  conflicts: { coordinate: string; kept: string; skipped: string }[];
  errors: { coordinate: string; message: string }[];
  /** True when every artifact came from cache without a single fetch. */
  fromCacheOnly: boolean;
};

/** IO the graph walk needs; the concrete impl talks to disk + HTTPS. */
export type DepIo = {
  /** Read a POM's XML text, downloading/caching as needed. Throws on failure. */
  readPom(coord: Coordinate): Promise<string>;
  /** Ensure the JAR is cached; returns its absolute path, or null if absent. */
  ensureJar(coord: Coordinate): Promise<string | null>;
  /** Incremented on every real network download so callers can detect a pure cache hit. */
  stats?: { downloads: number };
  log?: (message: string) => void;
};

/** Merge a POM model with its (already-fetched) ancestor chain data. */
function effectiveProperties(model: PomModel, parentProps: Record<string, string>): Record<string, string> {
  return { ...parentProps, ...model.properties };
}

/** Look up a dependency's managed version from dependencyManagement (g:a match). */
function managedVersion(managed: PomDependency[], dep: PomDependency): string | undefined {
  const hit = managed.find((m) => m.groupId === dep.groupId && m.artifactId === dep.artifactId);
  return hit?.version;
}

/**
 * The heart of the resolver: a breadth-first, nearest-wins walk. It is pure with
 * respect to IO (injected) so it can be driven by POM fixtures in tests.
 */
export async function resolveGraph(
  roots: Coordinate[],
  io: DepIo,
  opts: { offline?: boolean } = {},
): Promise<ResolveOutcome> {
  const log = io.log ?? (() => {});
  const resolved = new Map<string, ResolvedArtifact>();
  const gaVersions = new Map<string, string>(); // "g:a" -> chosen version (nearest wins)
  const missing: ResolveIssue[] = [];
  const conflicts: ResolveOutcome['conflicts'] = [];
  const errors: { coordinate: string; message: string }[] = [];

  type Task = { coord: Coordinate; depth: number; requestedBy: string; parentProps: Record<string, string>; parentManaged: PomDependency[] };
  const queue: Task[] = roots.map((c) => ({ coord: c, depth: 0, requestedBy: 'project', parentProps: {}, parentManaged: [] }));

  // Deduplicate identical (g:a:version) visits at the same or greater depth.
  const seen = new Set<string>();

  while (queue.length) {
    const task = queue.shift()!;
    const { coord, depth, requestedBy, parentProps, parentManaged } = task;
    if (depth > MAX_DEPTH) {
      missing.push({ coordinate: toGav(coord), reason: `exceeded the ${MAX_DEPTH}-level dependency depth limit` });
      continue;
    }
    const ga = coordinateKey(coord.groupId, coord.artifactId);

    // Nearest-wins mediation: once a g:a version is chosen at a shallower (or
    // equal) depth, deeper/duplicate declarations are recorded and skipped.
    // A BFS queue yields non-decreasing depth, so the first sighting is nearest.
    if (gaVersions.has(ga)) {
      const kept = gaVersions.get(ga)!;
      if (kept !== coord.version) conflicts.push({ coordinate: ga, kept, skipped: coord.version });
      continue;
    }
    if (seen.has(`${ga}:${coord.version}`)) continue;
    seen.add(`${ga}:${coord.version}`);
    gaVersions.set(ga, coord.version);

    // Fetch + parse the POM.
    let model: PomModel;
    try {
      const xml = await io.readPom(coord);
      model = parsePom(xml);
    } catch (err) {
      errors.push({ coordinate: toGav(coord), message: (err as Error).message });
      missing.push({ coordinate: toGav(coord), reason: 'POM could not be downloaded' });
      continue;
    }

    // Fold in the parent's properties + dependencyManagement so a child that
    // relies on `${revision}` or a managed version resolves correctly.
    const props = effectiveProperties(model, parentProps);
    let managed = [...parentManaged, ...model.dependencyManagement];
    if (model.parent && (!model.dependencyManagement.length || Object.keys(model.properties).length === 0)) {
      try {
        const pxml = await io.readPom({ ...model.parent });
        const pmodel = parsePom(pxml);
        const merged = effectiveProperties(model, pmodel.properties);
        for (const k of Object.keys(merged)) if (!(k in props)) props[k] = merged[k];
        managed = [...pmodel.dependencyManagement, ...managed];
      } catch {
        /* parent POM unavailable — proceed best-effort */
      }
    }

    // Resolve this artifact's own effective version (a request already carries
    // one, but re-derive defensively) and pick up its JAR.
    const effVersion = interpolate(model.coordinate.version || coord.version, props, model) || coord.version;
    let jarPath: string | null = null;
    if (model.packaging === 'jar') {
      try {
        jarPath = await io.ensureJar({ ...coord, version: effVersion });
      } catch (err) {
        errors.push({ coordinate: toGav({ ...coord, version: effVersion }), message: (err as Error).message });
      }
      // A jar-less (classifier/module) transitive is tolerable, but a root the
      // user explicitly added must yield a JAR: if Maven Central has no artifact
      // at that coordinate it is a real, actionable failure, not a silent
      // empty classpath that only shows up later as "cannot find symbol".
      if (!jarPath && depth === 0 && !errors.some((e) => e.coordinate === toGav({ ...coord, version: effVersion }))) {
        missing.push({
          coordinate: toGav({ ...coord, version: effVersion }),
          reason: 'the JAR was not found in the repository — check the groupId:artifactId:version',
        });
      }
    }

    resolved.set(ga, {
      coordinate: `${ga}:${effVersion}`,
      groupId: coord.groupId,
      artifactId: coord.artifactId,
      version: effVersion,
      ...(jarPath ? { jarPath } : {}),
      packaging: model.packaging,
      depth,
      requestedBy,
    });

    // Queue compile/runtime children, resolving versions via properties then
    // dependencyManagement; skip scopes that a plain run does not need.
    for (const dep of model.dependencies) {
      if (dep.optional) continue;
      const scope = (dep.scope || 'compile').toLowerCase();
      if (scope === 'provided' || scope === 'test' || scope === 'system' || scope === 'import') continue;
      const g = interpolate(dep.groupId, props, model) || dep.groupId;
      const a = interpolate(dep.artifactId, props, model) || dep.artifactId;
      if (hasUnresolved(g) || hasUnresolved(a)) {
        missing.push({ coordinate: `${g}:${a}:?`, reason: 'unresolvable groupId/artifactId property' });
        continue;
      }
      const rawVersion = dep.version || managedVersion(managed, { ...dep, groupId: g, artifactId: a });
      const version = rawVersion ? interpolate(rawVersion, props, model) : undefined;
      if (!version || hasUnresolved(version)) {
        missing.push({
          coordinate: `${g}:${a}`,
          reason: rawVersion && hasUnresolved(rawVersion) ? `unresolved version property ${rawVersion}` : 'no version (declared via a BOM/parent this resolver cannot expand)',
        });
        continue;
      }
      // Reject version ranges outright (best-effort, documented limitation).
      if (/^[[(]/.test(version)) {
        missing.push({ coordinate: `${g}:${a}:${version}`, reason: 'version ranges are not supported; pin a concrete version or add the JAR manually' });
        continue;
      }
      queue.push({
        coord: { groupId: g, artifactId: a, version, ...(dep.classifier ? { classifier: dep.classifier } : {}) },
        depth: depth + 1,
        requestedBy: coord.artifactId,
        parentProps: props,
        parentManaged: managed,
      });
    }
  }

  const classpath = [...resolved.values()]
    .filter((r) => r.jarPath)
    .sort((a, b) => (a.depth - b.depth) || a.coordinate.localeCompare(b.coordinate))
    .map((r) => r.jarPath as string);

  const ok = missing.length === 0 && errors.length === 0;
  return {
    ok,
    classpath,
    resolved: [...resolved.values()],
    missing,
    conflicts,
    errors,
    fromCacheOnly: (io.stats?.downloads ?? 0) === 0,
  };
}

// ---- concrete IO: ~/.m2 cache + HTTPS --------------------------------------

/** Live resolver backed by the local repository and Maven Central over HTTPS. */
class HttpCacheIo implements DepIo {
  constructor(
    private readonly repoRoot: string,
    private readonly fetchImpl: typeof fetch,
    private readonly baseUrl: string,
    private readonly offline: boolean,
    readonly log?: (m: string) => void,
  ) {}

  readonly stats = { downloads: 0 };

  private abs(rel: string): string {
    const abs = path.resolve(this.repoRoot, rel);
    // Path-traversal guard: the resolved target must remain inside the repo.
    const rootNoSep = this.repoRoot.endsWith(path.sep) ? this.repoRoot : this.repoRoot + path.sep;
    if (abs !== this.repoRoot && !abs.startsWith(rootNoSep)) throw new Error(`illegal artifact path escaped the cache root: ${rel}`);
    return abs;
  }

  private async fetchBuffer(url: string, maxBytes: number): Promise<Buffer> {
    if (!url.startsWith('https://')) throw new Error(`refusing non-HTTPS fetch: ${url}`);
    if (this.offline) throw new Error('offline: artifact is not in the local cache');
    const res = await this.fetchImpl(url, { redirect: 'follow' });
    if (res.status === 404) {
      const err = new Error('not found in repository (404)') as Error & { notFound?: boolean };
      err.notFound = true;
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error(`artifact exceeds size limit (${buf.byteLength} > ${maxBytes} bytes)`);
    this.stats.downloads += 1;
    return buf;
  }

  /** Atomically write `data` to `abs`, creating parent dirs; never clobber partially. */
  private async atomicWrite(abs: string, data: Buffer): Promise<void> {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, abs);
  }

  async readPom(coord: Coordinate): Promise<string> {
    const rel = artifactRelPath(coord, 'pom');
    const abs = this.abs(rel);
    if (fs.existsSync(abs)) return fs.readFileSync(abs, 'utf8');
    const pomUrl = `${this.baseUrl}/${artifactRelPath(coord, 'pom').split(path.sep).join('/')}`;
    const buf = await this.fetchBuffer(pomUrl, MAX_POM_BYTES);
    await this.atomicWrite(abs, buf);
    return buf.toString('utf8');
  }

  async ensureJar(coord: Coordinate): Promise<string | null> {
    const rel = artifactRelPath(coord, 'jar');
    const abs = this.abs(rel);
    if (fs.existsSync(abs)) return abs;
    const jarUrl = `${this.baseUrl}/${artifactRelPath(coord, 'jar').split(path.sep).join('/')}`;
    try {
      const buf = await this.fetchBuffer(jarUrl, MAX_JAR_BYTES);
      await this.atomicWrite(abs, buf);
      return abs;
    } catch (err) {
      // A jar-less classifier/module is not necessarily fatal.
      if ((err as Error & { notFound?: boolean }).notFound) return null;
      throw err;
    }
  }
}

export type DefaultRepositoryRoot = string;

/** The standard local repository location: `~/.m2/repository`. */
export function defaultRepositoryRoot(): string {
  return path.join(os.homedir(), '.m2', 'repository');
}

/**
 * Guard a classpath array handed back from the renderer. Only absolute paths
 * that live inside the managed repository (or an explicit extra root) survive —
 * the renderer names *which* dependencies it wants, but can never smuggle an
 * arbitrary executable/path onto a run. Anything else is dropped silently.
 */
export function sanitizeClasspath(paths: unknown, extraRoots: string[] = []): string[] {
  if (!Array.isArray(paths)) return [];
  const repoRoot = defaultRepositoryRoot();
  const roots = [repoRoot, ...extraRoots].map((r) => (r.endsWith(path.sep) ? r : r + path.sep));
  const out: string[] = [];
  for (const p of paths) {
    if (typeof p !== 'string' || !p.trim()) continue;
    const abs = path.resolve(p);
    if (!abs.endsWith('.jar')) continue;
    const inside = roots.some((r) => abs.startsWith(r));
    if (inside && !out.includes(abs)) out.push(abs);
  }
  return out;
}

/**
 * Report the local repository location and whether it exists. Never lists the
 * user's whole cache — the UI only needs "where do artifacts live / is it there".
 */
export function cacheStatus(repositoryRoot = defaultRepositoryRoot()): { repositoryRoot: string; exists: boolean } {
  return { repositoryRoot, exists: fs.existsSync(repositoryRoot) };
}

/**
 * Remove *only* the given coordinates' cached `.jar`/`.pom` files. This is a
 * targeted clear for "this dependency is stale" — it deliberately does NOT wipe
 * the shared `~/.m2`, which the user's own Maven builds may rely on.
 */
export async function removeCachedCoordinates(raws: string[], repositoryRoot = defaultRepositoryRoot()): Promise<{ removed: string[] }> {
  const removed: string[] = [];
  for (const raw of raws) {
    const coord = parseCoordinate(raw);
    if (!coord) continue;
    for (const ext of ['jar', 'pom'] as const) {
      const abs = path.resolve(repositoryRoot, artifactRelPath(coord, ext));
      const rootNoSep = repositoryRoot.endsWith(path.sep) ? repositoryRoot : repositoryRoot + path.sep;
      if (!abs.startsWith(rootNoSep)) continue; // traversal guard
      if (fs.existsSync(abs)) {
        await fsp.rm(abs, { force: true }).catch(() => {});
        removed.push(abs);
      }
    }
  }
  return { removed };
}

export type ResolveRequest = {
  /** `group:artifact:version[:classifier]` strings, validated before use. */
  coordinates: string[];
  offline?: boolean;
  repositoryRoot?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  log?: (m: string) => void;
};

/**
 * Public entry: validate the requested coordinates, build the IO, and walk the
 * graph. Invalid coordinates never reach the network or the filesystem — they
 * come back in `errors`, so the UI can show a precise message.
 */
export async function resolveJavaDependencies(req: ResolveRequest): Promise<ResolveOutcome> {
  const invalid = req.coordinates.filter((c) => !parseCoordinate(c));
  const valid: Coordinate[] = [];
  for (const c of req.coordinates) {
    const parsed = parseCoordinate(c);
    if (parsed) valid.push(parsed);
  }
  const io = new HttpCacheIo(
    req.repositoryRoot || defaultRepositoryRoot(),
    req.fetchImpl || fetch,
    req.baseUrl || MAVEN_CENTRAL_BASE,
    Boolean(req.offline),
    req.log,
  );
  const outcome = await resolveGraph(valid, io, { offline: req.offline });
  if (invalid.length) {
    outcome.errors = [
      ...invalid.map((c) => ({ coordinate: c, message: 'invalid Maven coordinate (expected groupId:artifactId:version)' })),
      ...outcome.errors,
    ];
    outcome.ok = false;
  }
  return outcome;
}
