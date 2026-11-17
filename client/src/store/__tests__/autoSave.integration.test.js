import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// End-to-end Auto Save against the REAL browser workspace provider — no mocked
// filesystem. This is the Web Mode proof that a debounced save reaches the
// localStorage-backed virtual storage through the exact singleton the store
// writes to, and survives closing and reopening the document.
vi.mock('../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
}));
vi.mock('../../monaco/lspClient.js', () => ({
  notifyLspFilesChanged: vi.fn(),
  isJavaBuildDescriptor: () => false,
}));

const { useIdeStore, saveStateFor } = await import('../../store/ideStore.js');
// The same provider singleton the store persists through, plus a factory for a
// genuinely independent instance to prove durability across "sessions".
const { workspace, createWebProvider } = await import('../../services/workspace.js');

const PATH = '/auto-save-target.js';

beforeEach(async () => {
  vi.useFakeTimers();
  window.localStorage.clear();
  await workspace.writeFile(PATH, 'original'); // seed real browser storage
  useIdeStore.setState({ docs: {}, order: [], activePath: null });
  useIdeStore.getState().cancelAllAutoSaves();
});

afterEach(() => {
  useIdeStore.getState().cancelAllAutoSaves();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Auto Save — Web Mode integration through the real browser workspace', () => {
  it('persists edited content to browser storage so a reopen sees the latest bytes', async () => {
    const seeded = await workspace.readFile(PATH);
    useIdeStore.getState().openDocument({ path: PATH, content: seeded.content });

    // Type, then let the debounce elapse.
    const s = useIdeStore.getState();
    s.updateContent(PATH, 'typed-by-user');
    s.scheduleAutoSave(PATH);
    expect(saveStateFor(useIdeStore.getState().docs[PATH])).toBe('modified'); // not yet written
    await vi.advanceTimersByTimeAsync(1000);

    // 'saved' only after the real write resolves.
    expect(saveStateFor(useIdeStore.getState().docs[PATH])).toBe('saved');

    // A fresh provider instance reads the same localStorage: content truly persisted.
    const reopened = await createWebProvider().readFile(PATH);
    expect(reopened.content).toBe('typed-by-user');

    // Close and reopen the editor tab from disk: the buffer shows the saved text.
    useIdeStore.getState().closeTab(PATH);
    const fresh = await workspace.readFile(PATH);
    useIdeStore.getState().openDocument({ path: PATH, content: fresh.content });
    const doc = useIdeStore.getState().docs[PATH];
    expect(doc.content).toBe('typed-by-user');
    expect(saveStateFor(doc)).toBe('saved');
  });

  it('a refused storage write never reports Saved, and keeps the editor text', async () => {
    useIdeStore.getState().openDocument({ path: PATH, content: 'original' });
    // Make the singleton the store uses reject the write (quota / read-only).
    vi.spyOn(workspace, 'writeFile').mockResolvedValue({ ok: false, code: 'QUOTA', message: 'Browser storage is full.' });
    const s = useIdeStore.getState();
    s.updateContent(PATH, 'unsurviving');
    s.scheduleAutoSave(PATH);
    await vi.advanceTimersByTimeAsync(1000);
    const doc = useIdeStore.getState().docs[PATH];
    expect(saveStateFor(doc)).toBe('failed');
    expect(doc.content).toBe('unsurviving'); // editor keeps the text for a retry
    expect(doc.savedContent).toBe('original'); // nothing falsely committed
  });
});
