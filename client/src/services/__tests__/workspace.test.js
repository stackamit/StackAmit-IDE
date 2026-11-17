import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebProvider } from '../workspace.js';

// The web provider persists to localStorage; jsdom provides it. A fresh
// provider is created per test so in-memory state never leaks across cases.
describe('web workspace provider (virtual filesystem)', () => {
  let ws;
  beforeEach(() => {
    window.localStorage.clear();
    ws = createWebProvider();
  });

  it('opens at the virtual root and seeds a README', async () => {
    const open = await ws.openWorkspace();
    expect(open).toEqual({ ok: true, root: '/' });
    const listing = await ws.readDirectory('/');
    expect(listing.ok).toBe(true);
    expect(listing.entries.some((e) => e.name === 'README.md' && e.isFile)).toBe(true);
  });

  it('creates, reads and writes files', async () => {
    const created = await ws.createFile('/', 'hello.txt');
    expect(created.ok).toBe(true);
    expect(created.path).toBe('/hello.txt');

    const write = await ws.writeFile('/hello.txt', 'hi there');
    expect(write.ok).toBe(true);

    const read = await ws.readFile('/hello.txt');
    expect(read).toMatchObject({ ok: true, content: 'hi there' });
  });

  it('refuses to overwrite an existing file on create', async () => {
    await ws.createFile('/', 'dup.txt');
    const again = await ws.createFile('/', 'dup.txt');
    expect(again.ok).toBe(false);
    expect(again.code).toBe('EXISTS');
  });

  it('reports NOT_FOUND for a missing file', async () => {
    const read = await ws.readFile('/nope.txt');
    expect(read.ok).toBe(false);
    expect(read.code).toBe('NOT_FOUND');
  });

  it('nests folders and lists only direct children', async () => {
    const dir = await ws.createDirectory('/', 'src');
    expect(dir.path).toBe('/src');
    await ws.createFile('/src', 'index.js');
    await ws.createFile('/', 'root.js');

    const rootChildren = await ws.readDirectory('/');
    const names = rootChildren.entries.map((e) => e.name);
    expect(names).toContain('src');
    expect(names).toContain('root.js');
    expect(names).not.toContain('index.js'); // nested, not a direct child
  });

  it('renames a directory and re-points everything under it', async () => {
    await ws.createDirectory('/', 'old');
    await ws.createFile('/old', 'a.txt');
    const renamed = await ws.rename('/old', 'new');
    expect(renamed.ok).toBe(true);
    expect(renamed.path).toBe('/new');

    const moved = await ws.readFile('/new/a.txt');
    expect(moved.ok).toBe(true);
    const gone = await ws.readFile('/old/a.txt');
    expect(gone.ok).toBe(false);
  });

  it('blocks deleting a non-empty folder without recursive, allows with it', async () => {
    await ws.createDirectory('/', 'tmp');
    await ws.createFile('/tmp', 'x.txt');

    const blocked = await ws.remove('/tmp', false);
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('NOT_EMPTY');

    const removed = await ws.remove('/tmp', true);
    expect(removed.ok).toBe(true);
    const after = await ws.readDirectory('/');
    expect(after.entries.some((e) => e.name === 'tmp')).toBe(false);
  });

  it('persists to localStorage across provider instances', async () => {
    await ws.createFile('/', 'persist.txt');
    const fresh = createWebProvider();
    const read = await fresh.readFile('/persist.txt');
    expect(read.ok).toBe(true);
  });

  it('reports a write as failed when browser storage cannot persist it', async () => {
    // Quota / unavailable storage: a browser-workspace write that will not be
    // durably saved must report failure, not silently claim success.
    await ws.createFile('/', 'q.txt');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const res = await ws.writeFile('/q.txt', 'will-not-persist');
    expect(res.ok).toBe(false);
    expect(res.code).toBe('QUOTA');
    // The refused value is rolled back rather than masquerading as saved.
    spy.mockRestore();
    const read = await ws.readFile('/q.txt');
    expect(read.content).not.toBe('will-not-persist');
  });

  it('has no terminal in web mode', () => {
    expect(ws.supportsTerminal).toBe(false);
    expect(ws.terminal).toBeNull();
  });

  // --- importFromDirectory: the atomic, size-capped folder import ----------
  // A real folder handle is the File System Access API; jsdom has none, so a
  // minimal async-iterable handle stands in. The shape matters: values() yields
  // entries with kind/name, and a file entry's getFile() returns a Blob-like.
  function fakeHandle(name, tree) {
    const make = (dir) => ({
      name,
      async *values() {
        for (const [k, v] of Object.entries(dir)) {
          if (typeof v === 'string') {
            yield { kind: 'file', name: k, getFile: async () => fileOf(k, v) };
          } else {
            yield { kind: 'directory', name: k, values: make(v).values };
          }
        }
      },
    });
    return make(tree);
  }
  function fileOf(name, text) {
    return { size: text.length, text: async () => text, name };
  }

  it('refuses to replace a non-empty workspace without confirm, then imports with replace', async () => {
    await ws.createFile('/', 'mine.txt');
    window.showDirectoryPicker = async () => fakeHandle('proj', { 'a.js': 'console.log(1)' });

    const guard = await ws.importFromDirectory();
    expect(guard.ok).toBe(false);
    expect(guard.code).toBe('REPLACE_CONFIRM');
    // The guard fired before anything was touched: the old file is still there.
    expect((await ws.readFile('/mine.txt')).ok).toBe(true);

    const done = await ws.importFromDirectory({ replace: true });
    expect(done.ok).toBe(true);
    expect(done.root).toBe('/proj');
    expect((await ws.readFile('/proj/a.js')).content).toBe('console.log(1)');
    // Replacing genuinely cleared the previous workspace.
    expect((await ws.readFile('/mine.txt')).ok).toBe(false);
  });

  it('leaves the workspace unchanged when a read throws mid-import', async () => {
    await ws.createFile('/', 'keep.txt');
    const boom = {
      name: 'bad',
      async *values() {
        yield { kind: 'file', name: 'x.txt', getFile: async () => { throw new Error('disk'); } };
      },
    };
    window.showDirectoryPicker = async () => boom;

    const res = await ws.importFromDirectory({ replace: true });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('IMPORT_FAILED');
    expect(/unchanged/i.test(res.message)).toBe(true);
    // The prior workspace survived the failed import instead of being wiped.
    expect((await ws.readFile('/keep.txt')).ok).toBe(true);
  });

  it('skips files over the per-file cap instead of silently failing to persist', async () => {
    window.showDirectoryPicker = async () => fakeHandle('big', {
      'small.txt': 'ok',
      'huge.txt': 'x'.repeat(600 * 1024), // > 512KB per-file cap
    });
    const res = await ws.importFromDirectory({ replace: true });
    expect(res.ok).toBe(true);
    expect(res.skipped).toContain('/big/huge.txt');
    expect((await ws.readFile('/big/small.txt')).content).toBe('ok');
    expect((await ws.readFile('/big/huge.txt')).ok).toBe(false);
  });

  it('reports FORBIDDEN when the picker is unavailable', async () => {
    delete window.showDirectoryPicker;
    const res = await ws.importFromDirectory();
    expect(res.ok).toBe(false);
    expect(res.code).toBe('FORBIDDEN');
  });
});
