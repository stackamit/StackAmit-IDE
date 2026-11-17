import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useIdeStore } from '../../../store/ideStore.js';

/**
 * Explorer rendering/interaction regression tests (file & folder icons).
 *
 * The workspace provider is faked (no real disk), everything else is the real
 * component, the real store and the real lucide icons. These cover the reported
 * failure modes one by one: icons not rendering, wrong type mapping, folder
 * rows not toggling, file rows not opening, disclosure/icon action conflicts,
 * missing accessible names, React key warnings and uncaught renderer errors.
 */
const ROOT = 'C:\\proj';
const LISTINGS = {
  [ROOT]: [
    { name: 'src', path: `${ROOT}\\src`, isDirectory: true },
    { name: 'Main.java', path: `${ROOT}\\Main.java`, isDirectory: false },
    { name: 'pom.xml', path: `${ROOT}\\pom.xml`, isDirectory: false },
    { name: 'mystery.zzz', path: `${ROOT}\\mystery.zzz`, isDirectory: false },
  ],
  [`${ROOT}\\src`]: [{ name: 'App.java', path: `${ROOT}\\src\\App.java`, isDirectory: false }],
};

vi.mock('../../../services/workspace.js', () => ({
  workspace: {
    mode: 'desktop',
    readDirectory: vi.fn(async (dir) => ({ ok: true, entries: LISTINGS[dir] || [] })),
  },
  isDesktopMode: () => true,
}));
// The real themes module pulls in monaco-editor (workers + DOM), which cannot
// load under jsdom; the store only needs the theme lists for validation.
vi.mock('../../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
}));

function makeActions() {
  return {
    openFileByPath: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(async () => ({ ok: true })),
    createFile: vi.fn(),
    createDirectory: vi.fn(),
    openWorkspace: vi.fn(),
    newUntitled: vi.fn(),
  };
}

let actions;
let consoleErrors;

beforeEach(() => {
  actions = makeActions();
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    consoleErrors.push(String(args[0] || ''));
  });
  useIdeStore.setState({
    root: ROOT,
    rootName: 'proj',
    treeRevision: 0,
    selectedPath: ROOT,
    activePath: null,
    docs: {},
    extensions: { 'file-icons': { installed: true, enabled: true } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderExplorer() {
  const FileExplorer = (await import('../FileExplorer.jsx')).default;
  const view = render(<FileExplorer actions={actions} />);
  // The root folder is expanded on mount, so its listing arrives asynchronously.
  await waitFor(() => expect(screen.getByText('Main.java')).toBeInTheDocument());
  return view;
}

// Windows paths contain backslashes, which a CSS attribute selector would read
// as escape sequences — compare the attribute value instead.
const rowFor = (path) =>
  Array.from(document.querySelectorAll('[data-explorer-path]')).find((r) => r.getAttribute('data-explorer-path') === path);

describe('Explorer tree structure', () => {
  it('renders a named tree with the root expanded and accessible treeitems', async () => {
    await renderExplorer();
    const tree = screen.getByRole('tree', { name: 'File Explorer' });
    expect(within(tree).getAllByRole('treeitem').length).toBeGreaterThan(1);
    const javaRow = rowFor(`${ROOT}\\Main.java`);
    expect(javaRow).toBeTruthy();
    expect(javaRow.getAttribute('aria-label')).toBe('File Main.java');
    expect(javaRow.getAttribute('aria-level')).toBe('2');
    expect(rowFor(ROOT).getAttribute('aria-level')).toBe('1');
    const folderRow = rowFor(`${ROOT}\\src`);
    expect(folderRow.getAttribute('aria-label')).toBe('Folder src');
    expect(folderRow.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders no React key or DOM warnings while listing a mixed tree', async () => {
    await renderExplorer();
    expect(consoleErrors.filter((m) => /unique "key"|Each child in a list|Warning:/.test(m))).toEqual([]);
  });
});

describe('file and folder icons', () => {
  it('gives each file type its own icon and a generic fallback for unknown ones', async () => {
    await renderExplorer();
    const java = rowFor(`${ROOT}\\Main.java`).querySelector('[data-file-icon]');
    const pom = rowFor(`${ROOT}\\pom.xml`).querySelector('[data-file-icon]');
    const unknown = rowFor(`${ROOT}\\mystery.zzz`).querySelector('[data-file-icon]');
    for (const icon of [java, pom, unknown]) {
      expect(icon, 'every file row must carry an icon').toBeTruthy();
      // Decorative: must never leak into the accessibility tree.
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.tagName.toLowerCase()).toBe('svg');
    }
    // .java is not the same glyph as an unrecognized extension.
    expect(java.outerHTML).not.toBe(unknown.outerHTML);
    // …and the Maven build file has its own glyph too (not the plain .xml one).
    expect(pom.outerHTML).not.toBe(unknown.outerHTML);
    expect(pom.getAttribute('data-file-icon')).toBe('xml');
  });

  it('colors folders and switches to the open state when expanded', async () => {
    await renderExplorer();
    // The row holds two glyphs: the disclosure chevron and the folder icon.
    const closed = rowFor(`${ROOT}\\src`).querySelectorAll('svg')[1];
    const closedMarkup = closed.outerHTML;
    fireEvent.click(rowFor(`${ROOT}\\src`));
    await waitFor(() => expect(screen.getByText('App.java')).toBeInTheDocument());
    const openRow = rowFor(`${ROOT}\\src`);
    expect(openRow.getAttribute('aria-expanded')).toBe('true');
    expect(openRow.querySelectorAll('svg')[1].outerHTML).not.toBe(closedMarkup);
  });

  it('falls back to the generic page icon when the file-icons extension is off', async () => {
    useIdeStore.setState({ extensions: { 'file-icons': { installed: true, enabled: false } } });
    await renderExplorer();
    expect(document.querySelectorAll('[data-file-icon]')).toHaveLength(0);
    // Rows still render an icon (nothing may appear "missing").
    expect(rowFor(`${ROOT}\\Main.java`).querySelector('svg')).toBeTruthy();
  });

  it('derives the icon from the path when a provider omits entry.name', async () => {
    LISTINGS[`${ROOT}\\src`].push({ path: `${ROOT}\\src\\Helper.java`, isDirectory: false });
    try {
      await renderExplorer();
      fireEvent.click(rowFor(`${ROOT}\\src`));
      await waitFor(() => expect(screen.getByText('Helper.java')).toBeInTheDocument());
      const row = rowFor(`${ROOT}\\src\\Helper.java`);
      expect(row.getAttribute('aria-label')).toBe('File Helper.java');
      expect(row.querySelector('[data-file-icon="java"]')).toBeTruthy();
    } finally {
      LISTINGS[`${ROOT}\\src`].pop();
    }
  });
});

describe('row interactions', () => {
  it('clicking a file row opens that file and marks it selected', async () => {
    await renderExplorer();
    fireEvent.click(rowFor(`${ROOT}\\Main.java`));
    expect(actions.openFileByPath).toHaveBeenCalledWith(`${ROOT}\\Main.java`);
    expect(useIdeStore.getState().selectedPath).toBe(`${ROOT}\\Main.java`);
    expect(rowFor(`${ROOT}\\Main.java`).getAttribute('aria-selected')).toBe('true');
  });

  it('keyboard Enter opens a file and toggles a folder without touching the other action', async () => {
    await renderExplorer();
    fireEvent.keyDown(rowFor(`${ROOT}\\Main.java`), { key: 'Enter' });
    expect(actions.openFileByPath).toHaveBeenCalledTimes(1);

    const folder = rowFor(`${ROOT}\\src`);
    fireEvent.keyDown(folder, { key: ' ' });
    await waitFor(() => expect(folder.getAttribute('aria-expanded')).toBe('true'));
    expect(actions.openFileByPath).toHaveBeenCalledTimes(1); // folder keys never open files
    fireEvent.keyDown(folder, { key: 'Enter' });
    await waitFor(() => expect(folder.getAttribute('aria-expanded')).toBe('false'));
  });

  it('the row action buttons do not toggle or open the node behind them', async () => {
    await renderExplorer();
    const row = rowFor(`${ROOT}\\src`);
    const wasExpanded = row.getAttribute('aria-expanded');
    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    expect(actions.rename).toHaveBeenCalledWith(`${ROOT}\\src`);
    expect(row.getAttribute('aria-expanded')).toBe(wasExpanded);

    fireEvent.click(within(rowFor(`${ROOT}\\Main.java`)).getByRole('button', { name: 'Delete' }));
    expect(actions.remove).toHaveBeenCalledWith(`${ROOT}\\Main.java`);
    expect(actions.openFileByPath).not.toHaveBeenCalled();
  });

  it('marks an open, unsaved file distinctly and clears it when saved', async () => {
    useIdeStore.setState({
      activePath: `${ROOT}\\Main.java`,
      docs: { [`${ROOT}\\Main.java`]: { path: `${ROOT}\\Main.java`, name: 'Main.java', content: 'x', savedContent: 'y', untitled: false } },
    });
    await renderExplorer();
    const dirtyDot = rowFor(`${ROOT}\\Main.java`).querySelector('[title="Unsaved"]');
    expect(dirtyDot).toBeTruthy();

    useIdeStore.setState({
      docs: { [`${ROOT}\\Main.java`]: { path: `${ROOT}\\Main.java`, name: 'Main.java', content: 'x', savedContent: 'x', untitled: false } },
    });
    await waitFor(() => expect(rowFor(`${ROOT}\\Main.java`).querySelector('[title="Unsaved"]')).toBeNull());
  });
});

describe('toolbar actions', () => {
  it('creates a file and a folder in the selected directory', async () => {
    await renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: 'New File' }));
    expect(actions.createFile).toHaveBeenCalledWith(ROOT);
    fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
    expect(actions.createDirectory).toHaveBeenCalledWith(ROOT);
  });

  it('targets the parent directory of the selected file', async () => {
    await renderExplorer();
    fireEvent.click(rowFor(`${ROOT}\\Main.java`));
    fireEvent.click(screen.getByRole('button', { name: 'New File' }));
    expect(actions.createFile).toHaveBeenCalledWith(ROOT);
  });

  it('refresh re-reads the tree (bumped nonce) without losing the selection', async () => {
    await renderExplorer();
    const { workspace } = await import('../../../services/workspace.js');
    const before = workspace.readDirectory.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(workspace.readDirectory.mock.calls.length).toBeGreaterThan(before));
    expect(rowFor(`${ROOT}\\Main.java`)).toBeTruthy();
  });

  it('shows an actionable empty state instead of a blank panel when no folder is open', async () => {
    useIdeStore.setState({ root: null, rootName: null });
    const FileExplorer = (await import('../FileExplorer.jsx')).default;
    render(<FileExplorer actions={actions} />);
    expect(screen.getByText('No folder open')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open Workspace/i }));
    expect(actions.openWorkspace).toHaveBeenCalled();
  });
});
