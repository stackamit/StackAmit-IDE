// Build the Electron main + preload (TypeScript -> CommonJS) with esbuild.
// node-pty and electron stay external (native module / provided by the runtime).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, '..');
const electronDir = path.join(clientRoot, 'electron');
const outdir = path.join(electronDir, 'dist');

/**
 * Resolve the backend API origin to bake into the main process CSP.
 *
 * The renderer reaches the API through `VITE_API_URL` (inlined by Vite), but the
 * main process enforces a `connect-src` CSP and needs to know the SAME origin —
 * otherwise a packaged app pointed at a non-localhost backend is silently
 * blocked from its own API. We read `VITE_API_URL` from the environment when
 * packaging sets it, else fall back to `client/.env`, and reduce it to an
 * origin (empty when unset/relative, which keeps the strict localhost-only CSP).
 */
function readViteApiUrl() {
  if (process.env.VITE_API_URL) return process.env.VITE_API_URL;
  const envFile = path.join(clientRoot, '.env');
  try {
    const text = fs.readFileSync(envFile, 'utf8');
    const line = text.split(/\r?\n/).find((l) => /^\s*VITE_API_URL\s*=/.test(l));
    if (!line) return '';
    const value = line.slice(line.indexOf('=') + 1).trim();
    // strip optional surrounding quotes
    return value.replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

function apiOrigin(value) {
  if (!value) return '';
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

const configuredApiOrigin = apiOrigin(readViteApiUrl());
if (process.env.STACKAMIT_REQUIRE_API_ORIGIN === '1' && !configuredApiOrigin) {
  throw new Error(
    'Packaged desktop builds require VITE_API_URL to be an absolute http(s) API origin. ' +
      'Set it to the verified production backend origin and rebuild; the dev-only /api value cannot work from file://.',
  );
}
if (configuredApiOrigin) console.log(`› Baking API origin into main-process CSP: ${configuredApiOrigin}`);

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  external: ['electron', 'node-pty'],
  logLevel: 'info',
  define: { __STACKAMIT_API_ORIGIN__: JSON.stringify(configuredApiOrigin) },
};

await build({ ...shared, entryPoints: [path.join(electronDir, 'main.ts')], outfile: path.join(outdir, 'main.cjs') });
await build({ ...shared, entryPoints: [path.join(electronDir, 'preload.ts')], outfile: path.join(outdir, 'preload.cjs') });
