import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Portability guard: no shipped source may embed a personal-machine path.
 *
 * Well-known OS install roots (C:\\Program Files\\Java, C:\\Windows\\System32,
 * /usr/bin, /opt/homebrew, …) are legitimate discovery candidates and stay;
 * what must never appear is a path that only exists on one developer's box —
 * user homes, Desktop/Downloads folders, or a username. That class of bug is
 * what broke `scripts/verify-packaged-lsp.mjs` (it hardcoded the checkout's
 * absolute path), and a text search after the fix is exactly this test.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(here, '..', '..'); // client/

/** Roots to scan, relative to client/ — production code and scripts only. */
const SCAN_ROOTS = ['electron', 'src', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'release', '__tests__', 'coverage', '.vite', 'public']);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

const PERSONAL_PATH = /[A-Za-z]:[\\/](Users|Home|Documents|Desktop|Downloads)[\\/]/i;
const POSIX_HOME = /\/home\/[a-z]{3,}\b|\/Users\/[a-z]{3,}\b/i;

function* sources(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sources(full);
    } else if (SOURCE_EXT.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
      yield full;
    }
  }
}

describe('no personal-machine paths in shipped sources', () => {
  it('client code, scripts and electron sources contain no user-home or Desktop paths', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const dir = path.join(clientRoot, root);
      if (!fs.existsSync(dir)) continue;
      for (const file of sources(dir)) {
        const text = fs.readFileSync(file, 'utf8');
        const line = text.split('\n').findIndex((l) => PERSONAL_PATH.test(l) || POSIX_HOME.test(l));
        if (line >= 0) offenders.push(`${path.relative(clientRoot, file)}:${line + 1}`);
      }
    }
    expect(offenders, `hardcoded personal paths found in ${offenders.join(', ')}`).toEqual([]);
  });

  it('the packaged-app verifier resolves its targets from its own location or env', () => {
    // Regression for the exact bug that motivated this file.
    const script = fs.readFileSync(path.join(clientRoot, 'scripts', 'verify-packaged-lsp.mjs'), 'utf8');
    expect(script).toMatch(/fileURLToPath\(import\.meta\.url\)/);
    expect(script).toMatch(/process\.env\.VERIFY_EXE/);
    expect(script).toMatch(/process\.env\.VERIFY_PYRIGHT/);
    expect(PERSONAL_PATH.test(script)).toBe(false);
  });
});
