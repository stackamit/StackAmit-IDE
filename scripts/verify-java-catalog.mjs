/**
 * Live-verify the 100-entry Java catalog against Maven Central.
 *
 * For every entry we:
 *   1. HEAD/GET the artifact `.pom` at repo1.maven.org to confirm the pinned
 *      version actually exists (a 200/404 is the ground truth — we never assume).
 *   2. Parse `<licenses>` out of the `.pom` to record the real declared license.
 *   3. Ask the Maven Central search API for the newest released version so we can
 *      flag entries whose pin is behind the current stable (informational only).
 *
 * The script does NOT rewrite the catalog. It emits a report
 * (`scripts/java-catalog-verification.json`) plus a console summary; a human (or
 * the follow-up patch step) applies corrections honestly. Entries that cannot be
 * reached stay `pending` rather than asserting anything unproven.
 *
 * Usage:  & "$env:ProgramFiles\nodejs\node.exe" scripts\verify-java-catalog.mjs
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = path.join(__dirname, '..', 'client', 'src', 'data', 'javaLibraryCatalog.js');
const REPORT_FILE = path.join(__dirname, 'java-catalog-verification.json');

const CENTRAL = 'https://repo1.maven.org/maven2';
const SEARCH = 'https://search.maven.org/solrsearch/select';
const CONCURRENCY = 8;
const PER_TIMEOUT_MS = 15000;

// The catalog is an ESM `.js` file. Node parses `.js` as CommonJS here, so we
// import it through a throwaway `.mjs` copy — no string->code compilation, the
// module is evaluated by Node's own ESM loader from a file we trust.
async function loadCatalog() {
  const source = readFileSync(CATALOG_FILE, 'utf8');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jacat-'));
  const tmp = path.join(dir, 'catalog.mjs');
  try {
    writeFileSync(tmp, source);
    const mod = await import(pathToFileURL(tmp).href);
    return mod.JAVA_LIBRARY_CATALOG;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function pomUrl(groupId, artifactId, version) {
  return `${CENTRAL}/${groupId.replace(/\./g, '/')}/${artifactId}/${version}/${artifactId}-${version}.pom`;
}

async function fetchWithTimeout(url, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Pull license <name> strings out of a pom (crude but adequate for reporting).
function extractLicenses(pomText) {
  const names = [];
  const block = /<licenses>([\s\S]*?)<\/licenses>/i.exec(pomText);
  const scope = block ? block[1] : pomText;
  const re = /<license>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/license>/gi;
  let m;
  while ((m = re.exec(scope))) names.push(m[1].trim());
  return names;
}

async function verifyOne(entry) {
  const result = {
    id: entry.id,
    coordinate: entry.coordinate,
    pinnedVersion: entry.version,
    pomStatus: null,
    exists: false,
    licensesFromPom: [],
    latestVersion: null,
    behindLatest: false,
    error: null,
  };
  try {
    const res = await fetchWithTimeout(pomUrl(entry.groupId, entry.artifactId, entry.version));
    result.pomStatus = res.status;
    if (res.status === 200) {
      result.exists = true;
      const text = await res.text();
      result.licensesFromPom = extractLicenses(text);
    }
  } catch (e) {
    result.error = `pom: ${e.message}`;
  }
  try {
    const q = encodeURIComponent(`g:"${entry.groupId}" AND a:"${entry.artifactId}"`);
    const sres = await fetchWithTimeout(`${SEARCH}?q=${q}&rows=1&core=gav&wt=json`);
    if (sres.status === 200) {
      const json = await sres.json();
      const doc = json?.response?.docs?.[0];
      if (doc?.v) {
        result.latestVersion = doc.v;
        result.behindLatest = doc.v !== entry.version;
      }
    }
  } catch (e) {
    result.error = (result.error ? result.error + '; ' : '') + `search: ${e.message}`;
  }
  return result;
}

async function runPool(items, size, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function lane() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await worker(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return results;
}

const catalog = await loadCatalog();
console.log(`Verifying ${catalog.length} catalog entries against Maven Central...`);
const started = Date.now();
const results = await runPool(catalog, CONCURRENCY, verifyOne);
const verifiedAt = new Date().toISOString();

const ok = results.filter((r) => r.exists);
const missing = results.filter((r) => !r.exists && !r.error);
const errored = results.filter((r) => r.error);
const behind = results.filter((r) => r.exists && r.behindLatest);

writeFileSync(
  REPORT_FILE,
  JSON.stringify({ verifiedAt, total: catalog.length, verified: ok.length, missing: missing.map((r) => r.id), errored: errored.map((r) => ({ id: r.id, error: r.error })), behindLatest: behind.map((r) => ({ id: r.id, pinned: r.pinnedVersion, latest: r.latestVersion })), results }, null, 2),
);

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  VERIFIED (pom 200): ${ok.length}/${catalog.length}`);
console.log(`  NOT FOUND         : ${missing.length} ${missing.map((r) => `${r.id}(${r.pomStatus})`).join(', ')}`);
console.log(`  NETWORK ERRORS    : ${errored.length} ${errored.map((r) => r.id).join(', ')}`);
console.log(`  BEHIND LATEST     : ${behind.length}`);
for (const r of behind) console.log(`      - ${r.id}: pinned ${r.pinnedVersion} -> latest ${r.latestVersion}`);
console.log(`\nReport written: ${REPORT_FILE}`);
