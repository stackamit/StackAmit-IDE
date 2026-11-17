import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addAuthorizedRoot,
  clearAuthorizedRoots,
  readDirectory,
  readFile,
  writeFile,
  createFile,
  createDirectory,
  renamePath,
  deletePath,
} from '../services/workspaceFs';

// These exercise the desktop filesystem guard: the security boundary between
// the (untrusted) renderer and the host. Everything runs against a throwaway
// temp workspace so no real user files are touched.
let root: string;
let outside: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-fs-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'stackamit-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'do not read me');
  clearAuthorizedRoots();
  addAuthorizedRoot(root);
});

afterEach(() => {
  clearAuthorizedRoots();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('workspaceFs path guard', () => {
  it('rejects reading a directory that is outside the authorized root', async () => {
    const res = await readDirectory(outside);
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('FORBIDDEN');
  });

  it('rejects `..` traversal that escapes the workspace', async () => {
    const escape = path.join(root, '..', path.basename(outside), 'secret.txt');
    const res = await readFile(escape);
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('FORBIDDEN');
  });

  it('rejects an absolute path pointing outside the root', async () => {
    const res = await readFile(path.join(outside, 'secret.txt'));
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('FORBIDDEN');
  });

  it('rejects a malformed / empty path', async () => {
    const res = await readDirectory('');
    expect(res.ok).toBe(false);
    expect((res as any).code).toBe('BAD_PATH');
  });
});

describe('workspaceFs operations within the root', () => {
  it('writes, reads and lists a file', async () => {
    const target = path.join(root, 'note.txt');
    const w = await writeFile(target, 'content');
    expect(w.ok).toBe(true);

    const r = await readFile(target);
    expect(r.ok).toBe(true);
    expect((r as any).content).toBe('content');

    const d = await readDirectory(root);
    expect(d.ok).toBe(true);
    expect((d as any).entries.some((e: any) => e.name === 'note.txt')).toBe(true);
  });

  it('creates a file but refuses to clobber an existing one', async () => {
    const first = await createFile(root, 'new.txt');
    expect(first.ok).toBe(true);
    const dup = await createFile(root, 'new.txt');
    expect(dup.ok).toBe(false);
    expect((dup as any).code).toBe('EXISTS');
  });

  it('rejects illegal characters in a created name', async () => {
    const bad = await createFile(root, 'bad:name?.txt');
    expect(bad.ok).toBe(false);
    expect((bad as any).code).toBe('BAD_NAME');
  });

  it('renames inside the workspace and keeps the guard on the target', async () => {
    const src = path.join(root, 'a.txt');
    await writeFile(src, 'x');
    const renamed = await renamePath(src, 'b.txt');
    expect(renamed.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'b.txt'))).toBe(true);
    expect(fs.existsSync(src)).toBe(false);
  });

  it('refuses to delete a non-empty folder unless recursive', async () => {
    const dir = await createDirectory(root, 'folder');
    expect(dir.ok).toBe(true);
    await createFile((dir as any).path, 'inside.txt');

    const blocked = await deletePath((dir as any).path, false);
    expect(blocked.ok).toBe(false);
    expect((blocked as any).code).toBe('NOT_EMPTY');

    const removed = await deletePath((dir as any).path, true);
    expect(removed.ok).toBe(true);
    expect(fs.existsSync((dir as any).path)).toBe(false);
  });
});
