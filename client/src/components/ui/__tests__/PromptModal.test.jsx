import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useIdeStore } from '../../../store/ideStore.js';
import PromptModal from '../PromptModal.jsx';

// The store pulls in the theme list, which loads monaco-editor (workers + DOM)
// and cannot resolve under jsdom — the modal only needs the store itself.
vi.mock('../../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
}));

/**
 * The app's own text prompt.
 *
 * Electron does not implement window.prompt (calling it throws), so these tests
 * pin the behaviour the Explorer's Rename / New File / New Folder actions rely
 * on: the modal opens from a store request, answers with the typed text, and
 * answers `null` on every cancel path.
 */
beforeEach(() => {
  useIdeStore.setState({ prompt: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  useIdeStore.setState({ prompt: null });
});

/** Ask a question; the modal's focus pass lands on the next timer tick. */
function ask(opts) {
  let p;
  act(() => {
    p = useIdeStore.getState().requestPrompt(opts);
  });
  return p;
}

const inputOf = () => screen.getByRole('textbox');

describe('PromptModal', () => {
  it('renders nothing until a question is asked', () => {
    render(<PromptModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the title, prefills and focuses the current name', async () => {
    render(<PromptModal />);
    ask({ title: 'Rename to:', defaultValue: 'Main.java' });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Rename to:');
    const input = inputOf();
    await waitFor(() => {
      expect(input).toHaveValue('Main.java');
      expect(document.activeElement).toBe(input);
    });
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
  });

  it('answers with the edited text on Enter and closes', async () => {
    render(<PromptModal />);
    const p = ask({ title: 'New file name:', defaultValue: 'untitled.txt' });
    fireEvent.change(inputOf(), { target: { value: 'Notes.java' } });
    fireEvent.keyDown(window, { key: 'Enter' });
    await expect(p).resolves.toBe('Notes.java');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the OK button answers, and Cancel / Escape answer null', async () => {
    render(<PromptModal />);

    const ok = ask({ title: 'Rename to:', defaultValue: 'a' });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await expect(ok).resolves.toBe('a');

    const viaCancel = ask({ title: 'Rename to:', defaultValue: 'a' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(viaCancel).resolves.toBeNull();

    const viaEscape = ask({ title: 'Rename to:', defaultValue: 'a' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(viaEscape).resolves.toBeNull();
  });

  it('blank input is a cancel, never an empty file name', async () => {
    render(<PromptModal />);
    const p = ask({ title: 'New folder name:', defaultValue: 'new-folder' });
    fireEvent.change(inputOf(), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await expect(p).resolves.toBeNull();
  });

  it('ignores answers when nothing was asked', () => {
    render(<PromptModal />);
    expect(() => useIdeStore.getState().answerPrompt('stray')).not.toThrow();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
