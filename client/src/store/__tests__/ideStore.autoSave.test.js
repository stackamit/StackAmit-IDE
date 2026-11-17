import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The store persists editor buffers through the workspace pipeline and reads the
// Auto Save setting through useEditorPrefs. Both are faked so these tests drive
// persistence deterministically (controllable success/failure/in-flight) and
// control the setting without touching real storage. clampAutoSaveDelay stays
// real so the 500–5000ms range is exercised, not just asserted.
const { mockWriteFile } = vi.hoisted(() => ({ mockWriteFile: vi.fn() }));
let prefs = { autoSave: true, autoSaveDelay: 1000 };

vi.mock('../../services/workspace.js', () => ({
  workspace: {
    mode: 'web',
    writeFile: (...args) => mockWriteFile(...args),
  },
  isDesktopMode: () => false,
}));
vi.mock('../../hooks/useEditorPrefs.js', async (importActual) => {
  const actual = await importActual();
  return { ...actual, readPrefs: () => prefs };
});
// The real themes module pulls in monaco-editor (workers + DOM), which jsdom
// cannot load; the store only needs the theme id constants.
vi.mock('../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
}));
// The store lazily imports lspClient for a Java-descriptor save; stub it so the
// dynamic chunk never resolves the Monaco worker graph in this environment.
vi.mock('../../monaco/lspClient.js', () => ({
  notifyLspFilesChanged: vi.fn(),
  isJavaBuildDescriptor: () => false,
}));

const { useIdeStore, saveStateFor } = await import('../../store/ideStore.js');

const A = '/proj/a.js';
const B = '/proj/b.js';

function openDoc(path, content = 'start') {
  useIdeStore.getState().openDocument({ path, content });
}
function edit(path, content) {
  const s = useIdeStore.getState();
  s.updateContent(path, content);
  s.scheduleAutoSave(path);
}
function doc(path) {
  return useIdeStore.getState().docs[path];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  prefs = { autoSave: true, autoSaveDelay: 1000 };
  mockWriteFile.mockResolvedValue({ ok: true });
  useIdeStore.setState({ docs: {}, order: [], activePath: null });
  useIdeStore.getState().cancelAllAutoSaves();
});

afterEach(() => {
  useIdeStore.getState().cancelAllAutoSaves();
  vi.useRealTimers();
});

describe('ideStore — debounced Auto Save', () => {
  it('an edit schedules a save that fires only after the debounce delay', async () => {
    openDoc(A, 'v1');
    edit(A, 'v2');
    // Nothing written before the delay elapses.
    await vi.advanceTimersByTimeAsync(999);
    expect(mockWriteFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(A, 'v2');
    expect(doc(A).savedContent).toBe('v2');
    expect(saveStateFor(doc(A))).toBe('saved');
  });

  it('collapses a burst of edits into one write carrying the latest content', async () => {
    openDoc(A, 'v1');
    edit(A, 'v2');
    await vi.advanceTimersByTimeAsync(500);
    edit(A, 'v3');
    await vi.advanceTimersByTimeAsync(500); // still below the reset delay
    edit(A, 'final');
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(A, 'final');
    expect(doc(A).savedContent).toBe('final');
  });

  it('honours the configured delay', async () => {
    prefs.autoSaveDelay = 3000;
    openDoc(A);
    edit(A, 'later');
    await vi.advanceTimersByTimeAsync(2999);
    expect(mockWriteFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('clamps an out-of-range delay to the minimum bound', async () => {
    prefs.autoSaveDelay = 10; // below 500 → clamped to 500
    openDoc(A);
    edit(A, 'x');
    await vi.advanceTimersByTimeAsync(499);
    expect(mockWriteFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('does not write automatically when Auto Save is disabled', async () => {
    prefs.autoSave = false;
    openDoc(A);
    useIdeStore.getState().updateContent(A, 'dirty');
    useIdeStore.getState().scheduleAutoSave(A);
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(saveStateFor(doc(A))).toBe('modified');
  });

  it('skips untitled buffers (no persistence target to auto-write)', async () => {
    openDoc('untitled:Untitled-1', 'scratch');
    useIdeStore.getState().scheduleAutoSave('untitled:Untitled-1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('saves each tab independently', async () => {
    openDoc(A, 'a1');
    openDoc(B, 'b1');
    edit(A, 'a2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenLastCalledWith(A, 'a2');
    edit(B, 'b2');
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenLastCalledWith(B, 'b2');
    expect(saveStateFor(doc(A))).toBe('saved');
    expect(saveStateFor(doc(B))).toBe('saved');
  });
});

describe('ideStore — saveFile concurrency and status', () => {
  it('manual saveFile persists even with Auto Save disabled', async () => {
    prefs.autoSave = false;
    openDoc(A, 'a');
    useIdeStore.getState().updateContent(A, 'b');
    const res = await useIdeStore.getState().saveFile(A);
    expect(res.ok).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledWith(A, 'b');
    expect(saveStateFor(doc(A))).toBe('saved');
  });

  it('a successful write marks the document saved', async () => {
    openDoc(A, 'a');
    useIdeStore.getState().updateContent(A, 'b');
    await useIdeStore.getState().saveFile(A);
    expect(doc(A).saveState).toBe('saved');
    expect(saveStateFor(doc(A))).toBe('saved');
  });

  it('a failed write leaves the document dirty and reports the error', async () => {
    mockWriteFile.mockResolvedValue({ ok: false, message: 'read-only' });
    openDoc(A, 'a');
    useIdeStore.getState().updateContent(A, 'b');
    const res = await useIdeStore.getState().saveFile(A);
    expect(res.ok).toBe(false);
    expect(doc(A).saveError).toBe('read-only');
    expect(saveStateFor(doc(A))).toBe('failed');
    expect(doc(A).content).toBe('b'); // editor content is never discarded
    expect(doc(A).savedContent).toBe('a'); // still dirty against the last good save
  });

  it('retrying a failed save succeeds once storage becomes available', async () => {
    mockWriteFile.mockResolvedValueOnce({ ok: false, message: 'disk full' });
    openDoc(A, 'a');
    useIdeStore.getState().updateContent(A, 'b');
    await useIdeStore.getState().saveFile(A);
    expect(saveStateFor(doc(A))).toBe('failed');
    mockWriteFile.mockResolvedValueOnce({ ok: true });
    const res = await useIdeStore.getState().saveFile(A); // retry
    expect(res.ok).toBe(true);
    expect(saveStateFor(doc(A))).toBe('saved');
  });

  it('serialises concurrent writes and persists content edited mid-write', async () => {
    openDoc(A, 'a');
    useIdeStore.getState().updateContent(A, 'v1');
    let resolveFirst;
    mockWriteFile
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; })) // in-flight
      .mockResolvedValue({ ok: true });
    const first = useIdeStore.getState().saveFile(A); // starts, awaits writeFile
    await Promise.resolve(); // let _persistOnce enter the await
    expect(doc(A).saveState).toBe('saving');
    // A newer edit arrives while the first write is still running.
    useIdeStore.getState().updateContent(A, 'v2');
    const second = useIdeStore.getState().saveFile(A); // joins the drain
    resolveFirst({ ok: true });
    await Promise.all([first, second]);
    // Two writes: v1 then the coalesced latest v2 — never a lost update.
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenNthCalledWith(1, A, 'v1');
    expect(mockWriteFile).toHaveBeenNthCalledWith(2, A, 'v2');
    expect(doc(A).savedContent).toBe('v2');
    expect(saveStateFor(doc(A))).toBe('saved');
  });

  it('never shows Saved while a write is still in flight', async () => {
    openDoc(A, 'a');
    useIdeStore.getState().updateContent(A, 'b');
    let resolveWrite;
    mockWriteFile.mockImplementationOnce(() => new Promise((r) => { resolveWrite = r; }));
    const p = useIdeStore.getState().saveFile(A);
    await Promise.resolve();
    expect(saveStateFor(doc(A))).toBe('saving');
    resolveWrite({ ok: true });
    await p;
    expect(saveStateFor(doc(A))).toBe('saved');
  });
});

describe('ideStore — lifecycle', () => {
  it('closing a tab cancels its pending debounce so nothing is written', async () => {
    openDoc(A, 'a');
    edit(A, 'b');
    useIdeStore.getState().closeTab(A);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('a write finishing after the document closed commits nothing', async () => {
    openDoc(A, 'a');
    useIdeStore.getState().updateContent(A, 'b');
    let resolveWrite;
    mockWriteFile.mockImplementationOnce(() => new Promise((r) => { resolveWrite = r; }));
    const p = useIdeStore.getState().saveFile(A);
    await Promise.resolve();
    useIdeStore.getState().closeTab(A); // gone before the write resolves
    resolveWrite({ ok: true });
    const res = await p;
    expect(res.closed).toBe(true);
    expect(useIdeStore.getState().docs[A]).toBeUndefined();
  });

  it('rename re-points pending auto-save work to the new path', async () => {
    openDoc(A, 'a');
    edit(A, 'b'); // debounce scheduled on A
    useIdeStore.getState().reassignPath(A, '/proj/c.js');
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockWriteFile).toHaveBeenCalledWith('/proj/c.js', 'b');
    expect(mockWriteFile).not.toHaveBeenCalledWith(A, 'b');
  });

  it('flushAllAutoSaves immediately writes every pending debounce', async () => {
    openDoc(A, 'a');
    openDoc(B, 'b');
    edit(A, 'a2');
    edit(B, 'b2');
    await useIdeStore.getState().flushAllAutoSaves();
    const written = mockWriteFile.mock.calls.map(([p]) => p).sort();
    expect(written).toEqual([A, B]);
    expect(saveStateFor(doc(A))).toBe('saved');
    expect(saveStateFor(doc(B))).toBe('saved');
  });
});

describe('saveStateFor — derived per-document status', () => {
  const base = { content: 'x', savedContent: 'x', untitled: false };
  it('is saved when content matches and no state is set', () => {
    expect(saveStateFor({ ...base })).toBe('saved');
  });
  it('is modified when content diverges', () => {
    expect(saveStateFor({ ...base, content: 'y' })).toBe('modified');
  });
  it('is saving while a write is in flight', () => {
    expect(saveStateFor({ ...base, content: 'y', saveState: 'saving' })).toBe('saving');
  });
  it('is failed until a retry clears it', () => {
    expect(saveStateFor({ ...base, content: 'y', saveState: 'failed' })).toBe('failed');
  });
  it('a newer edit during a save is not misrepresented as saved', () => {
    // Older content committed, but a fresh keystroke diverged again.
    expect(saveStateFor({ ...base, saveState: 'saved', content: 'new', savedContent: 'old' })).toBe('modified');
  });
});
