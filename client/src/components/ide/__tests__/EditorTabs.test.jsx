import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useIdeStore } from '../../../store/ideStore.js';

/**
 * Tab strip icons + actions. The Explorer fix also reached the tabs (they used
 * to show no icon at all), so the same mapping is verified here: a Java tab is
 * recognizable, and closing a tab never also activates it.
 */
vi.mock('../../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
}));

const JAVA = 'C:\\proj\\Main.java';
const TXT = 'C:\\proj\\notes.txt';

const doc = (path, name, { dirty = false, saveState, saveError } = {}) => ({
  path,
  name,
  language: 'java',
  content: dirty ? 'changed' : 'same',
  savedContent: 'same',
  untitled: false,
  ...(saveState ? { saveState } : {}),
  ...(saveError ? { saveError } : {}),
});

let actions;
beforeEach(() => {
  actions = { closeTab: vi.fn() };
  useIdeStore.setState({
    order: [JAVA, TXT],
    docs: { [JAVA]: doc(JAVA, 'Main.java'), [TXT]: doc(TXT, 'notes.txt') },
    activePath: JAVA,
    extensions: { 'file-icons': { installed: true, enabled: true } },
  });
});

async function renderTabs() {
  const EditorTabs = (await import('../EditorTabs.jsx')).default;
  return render(<EditorTabs actions={actions} />);
}

/** svgs that are not inside the tab's close button = the file-type glyphs. */
function countFileTypeGlyphs() {
  return screen
    .getAllByRole('tab')
    .reduce((n, tab) => n + Array.from(tab.querySelectorAll('svg')).filter((svg) => !svg.closest('button')).length, 0);
}

describe('EditorTabs', () => {
  it('renders one accessible tab per open document', async () => {
    await renderTabs();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('shows the file-type icon in the tab, marked decorative', async () => {
    await renderTabs();
    expect(countFileTypeGlyphs()).toBe(2);
    const svgs = screen.getAllByRole('tab').map((t) => t.querySelector('svg'));
    for (const svg of svgs) expect(svg).toBeTruthy();
    expect(svgs[0].getAttribute('aria-hidden')).toBe('true');
    // Java and a plain text file are not the same glyph.
    expect(svgs[0].outerHTML).not.toBe(svgs[1].outerHTML);
  });

  it('drops the file-type icon when the file-icons extension is off, without breaking the tab', async () => {
    // The close control is itself an icon, so "no svg at all" is the wrong
    // expectation — the file-type glyph (the svg outside any button) is the
    // one that must disappear while closing keeps working.
    useIdeStore.setState({ extensions: { 'file-icons': { installed: true, enabled: false } } });
    await renderTabs();
    expect(countFileTypeGlyphs()).toBe(0);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].textContent).toContain('Main.java');
    // Still closable.
    fireEvent.click(screen.getByRole('button', { name: 'Close Main.java' }));
    expect(actions.closeTab).toHaveBeenCalledWith(JAVA);
  });

  it('activates on click and never activates when the close button is used', async () => {
    await renderTabs();
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(useIdeStore.getState().activePath).toBe(TXT);

    fireEvent.click(screen.getByRole('button', { name: 'Close Main.java' }));
    expect(actions.closeTab).toHaveBeenCalledWith(JAVA);
    expect(useIdeStore.getState().activePath).toBe(TXT);
  });

  it('marks an unsaved tab and routes its close through the unsaved control', async () => {
    useIdeStore.setState({ docs: { [JAVA]: doc(JAVA, 'Main.java', { dirty: true }), [TXT]: doc(TXT, 'notes.txt') } });
    await renderTabs();
    fireEvent.click(screen.getByRole('button', { name: 'Close (unsaved)' }));
    expect(actions.closeTab).toHaveBeenCalledWith(JAVA);
  });

  it('shows a saving indicator on the tab whose write is in flight', async () => {
    useIdeStore.setState({
      docs: { [JAVA]: doc(JAVA, 'Main.java', { dirty: true, saveState: 'saving' }), [TXT]: doc(TXT, 'notes.txt') },
    });
    await renderTabs();
    expect(screen.getByRole('button', { name: 'Close (unsaved)' }).getAttribute('title')).toBe('Saving…');
  });

  it('surfaces the save error on a failed tab', async () => {
    useIdeStore.setState({
      docs: { [JAVA]: doc(JAVA, 'Main.java', { dirty: true, saveState: 'failed', saveError: 'read-only' }), [TXT]: doc(TXT, 'notes.txt') },
    });
    await renderTabs();
    expect(screen.getByRole('button', { name: 'Close (unsaved)' }).getAttribute('title')).toBe('read-only');
  });

  it('renders nothing at all when no document is open', async () => {
    useIdeStore.setState({ order: [], docs: {}, activePath: null });
    const EditorTabs = (await import('../EditorTabs.jsx')).default;
    const { container } = render(<EditorTabs actions={actions} />);
    expect(container).toBeEmptyDOMElement();
  });
});
