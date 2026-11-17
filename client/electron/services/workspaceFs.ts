/**
 * Workspace-scoped filesystem service (Electron main process).
 *
 * Security model:
 *  - A set of *authorized roots* is maintained. A root is added only when the
 *    user picks a workspace folder via a native dialog, or explicitly saves a
 *    file through a Save-As dialog.
 *  - Every path used by a file operation is resolved to its real, canonical
 *    absolute path (following symlinks) and must live inside an authorized root,
 *    otherwise the request is rejected. This prevents `..` traversal and
 *    symlink-escape outside the workspace.
 *  - Destructive operations (delete/rename) never follow a symlink out of the
 *    workspace and refuse recursive directory deletion unless explicitly asked.
 *  - Errors are returned as structured { ok:false } envelopes; stack traces and
 *    absolute host details are not leaked to the renderer.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DirEntry, Result } from '../shared/ipc.js';

const roots = new Set<string>();

function norm(p: string): string {
  // Windows is case-insensitive; normalize separators + case for comparison.
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function addAuthorizedRoot(root: string): string {
  const abs = path.resolve(root);
  fs.mkdirSync(abs, { recursive: true });
  roots.add(norm(abs));
  return abs;
}

export function clearAuthorizedRoots(): void {
  roots.clear();
}

export function hasAuthorizedRoot(): boolean {
  return roots.size > 0;
}

function fail(code: string, message: string): Result<never> {
  return { ok: false, code, message };
}

/** Resolve and confirm a path stays inside an authorized root (no escape). */
function guardPath(p: string): { ok: true; real: string } | { ok: false; err: Result<never> } {
  if (typeof p !== 'string' || p.length === 0) {
    return { ok: false, err: fail('BAD_PATH', 'Invalid path.') };
  }
  const abs = path.resolve(p);
  // Canonicalize parent dir first (target may not exist yet for create ops).
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch {
    // Target doesn't exist yet: canonicalize the nearest existing ancestor.
    let cur = abs;
    const ancestors: string[] = [];
    while (!fs.existsSync(cur)) {
      ancestors.unshift(path.basename(cur));
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    let base = cur;
    try {
      base = fs.realpathSync(cur);
    } catch {
      /* keep as-is */
    }
    real = path.join(base, ...ancestors);
  }

  const withinRoot = [...roots].some((r) => isSameOrDescendant(norm(real), r));
  if (!withinRoot) {
    return { ok: false, err: fail('FORBIDDEN', 'Operation is outside the authorized workspace.') };
  }
  return { ok: true, real };
}

function isSameOrDescendant(child: string, rootDir: string): boolean {
  const rel = path.relative(rootDir, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Shallow directory listing (folders first, alphabetical). */
export async function readDirectory(dirPath: string): Promise<Result<{ entries: DirEntry[] }>> {
  const g = guardPath(dirPath);
  if (!g.ok) return g.err;
  try {
    const dirents = await fsp.readdir(g.real, { withFileTypes: true });
    const entries: DirEntry[] = dirents
      .map((d) => ({
        name: d.name,
        path: path.join(g.real, d.name),
        isDirectory: d.isDirectory(),
        isFile: d.isFile(),
      }))
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    return { ok: true, entries };
  } catch (err: any) {
    return fail(err.code || 'READ_DIR_FAILED', 'Could not read this folder.');
  }
}

export async function readFile(filePath: string): Promise<Result<{ content: string; path: string }>> {
  if (typeof filePath !== 'string') return fail('BAD_PATH', 'Invalid path.');
  const g = guardPath(filePath);
  if (!g.ok) return g.err;
  try {
    const stat = await fsp.stat(g.real);
    if (stat.size > 8 * 1024 * 1024) return fail('TOO_LARGE', 'File is too large to open in the editor.');
    const content = await fsp.readFile(g.real, 'utf8');
    return { ok: true, content, path: g.real };
  } catch (err: any) {
    if (err.code === 'ENOENT') return fail('NOT_FOUND', 'File no longer exists.');
    return fail(err.code || 'READ_FAILED', 'Could not read this file.');
  }
}

export async function writeFile(filePath: string, content: string): Promise<Result<{ path: string }>> {
  if (typeof content !== 'string') return fail('BAD_CONTENT', 'Invalid file content.');
  const g = guardPath(filePath);
  if (!g.ok) return g.err;
  try {
    await fsp.writeFile(g.real, content, 'utf8');
    return { ok: true, path: g.real };
  } catch (err: any) {
    return fail(err.code || 'WRITE_FAILED', 'Could not save this file.');
  }
}

function validateName(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && !/[\\/:*?"<>|]/.test(name) && name !== '.' && name !== '..';
}

export async function createFile(parentPath: string, name: string): Promise<Result<{ path: string }>> {
  if (!validateName(name)) return fail('BAD_NAME', 'Invalid file name.');
  const g = guardPath(path.join(parentPath, name));
  if (!g.ok) return g.err;
  try {
    // 'wx' fails if the file already exists.
    await fsp.writeFile(g.real, '', { flag: 'wx' });
    return { ok: true, path: g.real };
  } catch (err: any) {
    if (err.code === 'EEXIST') return fail('EXISTS', 'A file with that name already exists.');
    return fail(err.code || 'CREATE_FAILED', 'Could not create the file.');
  }
}

export async function createDirectory(parentPath: string, name: string): Promise<Result<{ path: string }>> {
  if (!validateName(name)) return fail('BAD_NAME', 'Invalid folder name.');
  const g = guardPath(path.join(parentPath, name));
  if (!g.ok) return g.err;
  try {
    await fsp.mkdir(g.real);
    return { ok: true, path: g.real };
  } catch (err: any) {
    if (err.code === 'EEXIST') return fail('EXISTS', 'A folder with that name already exists.');
    return fail(err.code || 'CREATE_FAILED', 'Could not create the folder.');
  }
}

export async function renamePath(oldPath: string, newName: string): Promise<Result<{ path: string }>> {
  if (!validateName(newName)) return fail('BAD_NAME', 'Invalid name.');
  const g = guardPath(oldPath);
  if (!g.ok) return g.err;
  const targetAbs = path.join(path.dirname(g.real), newName);
  const gt = guardPath(targetAbs);
  if (!gt.ok) return gt.err;
  try {
    await fsp.rename(g.real, gt.real);
    return { ok: true, path: gt.real };
  } catch (err: any) {
    if (err.code === 'ENOENT') return fail('NOT_FOUND', 'Item no longer exists.');
    if (err.code === 'EEXIST') return fail('EXISTS', 'An item with that name already exists.');
    return fail(err.code || 'RENAME_FAILED', 'Could not rename the item.');
  }
}

export async function deletePath(targetPath: string, recursive: boolean): Promise<Result<{ path: string }>> {
  const g = guardPath(targetPath);
  if (!g.ok) return g.err;
  try {
    const stat = await fsp.lstat(g.real);
    if (stat.isDirectory()) {
      if (!recursive) {
        const items = await fsp.readdir(g.real);
        if (items.length > 0) return fail('NOT_EMPTY', 'Folder is not empty. Confirm a recursive delete to remove it.');
      }
      await fsp.rm(g.real, { recursive: true, force: false });
    } else {
      await fsp.rm(g.real, { force: false });
    }
    return { ok: true, path: g.real };
  } catch (err: any) {
    if (err.code === 'ENOENT') return fail('NOT_FOUND', 'Item no longer exists.');
    return fail(err.code || 'DELETE_FAILED', 'Could not delete the item.');
  }
}

/** Utility for tests / non-deterministic ids. */
export function newId(): string {
  return randomUUID();
}

/**
 * Public path guard reused by other main-process services (e.g. the preview
 * server): returns the canonical real path only when it stays inside an
 * authorized root, otherwise null. Never throws, never leaks details.
 */
export function resolveWithinRoots(p: string): string | null {
  const g = guardPath(p);
  return g.ok ? g.real : null;
}

/** True when `p` is (or lives under) one of the user-authorized workspace roots. */
export function isWithinAuthorizedRoots(p: string): boolean {
  return resolveWithinRoots(p) !== null;
}
