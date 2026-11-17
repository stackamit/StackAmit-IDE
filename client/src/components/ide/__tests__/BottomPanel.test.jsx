import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import BottomPanel from '../BottomPanel.jsx';
import { useIdeStore } from '../../../store/ideStore.js';

// The integrated terminal pulls in xterm, which cannot load under jsdom; the
// Output tab never renders it, so it is stubbed out. The real themes module
// drags in monaco-editor (workers + DOM), which the store only needs as lists.
vi.mock('../TerminalPanel.jsx', () => ({ default: () => null }));
vi.mock('../../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
}));

const actions = {
  runActive: vi.fn(),
  stopActiveRun: vi.fn(),
  saveActive: vi.fn(),
  clearOutput: vi.fn(),
  answerPendingPrompt: vi.fn(),
  cancelPendingPrompt: vi.fn(),
};

function renderOutput() {
  useIdeStore.getState().setBottomTab('output');
  return render(<BottomPanel isDark actions={actions} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useIdeStore.setState({
    docs: { '/main.py': { path: '/main.py', language: 'python', content: 'print(1)', savedContent: 'print(1)' } },
    activePath: '/main.py',
    output: [],
    runState: 'idle',
    runHandle: null,
    runPrompt: null,
    runStdin: '',
  });
});

describe('BottomPanel — Web Mode pre-run stdin', () => {
  it('offers a pre-run stdin editor for a remote-runnable language and stages input', () => {
    renderOutput();
    const box = screen.getByRole('textbox', { name: /pre-run standard input/i });
    fireEvent.change(box, { target: { value: 'Alice\n42' } });
    expect(useIdeStore.getState().runStdin).toBe('Alice\n42');
  });

  it('does not show the batch stdin editor while a run is executing', () => {
    useIdeStore.setState({ runState: 'running', runHandle: { mode: 'remote', language: 'python', name: 'main.py' } });
    renderOutput();
    expect(screen.queryByRole('textbox', { name: /pre-run standard input/i })).toBeNull();
  });
});

describe('BottomPanel — browser interactive prompt', () => {
  it('renders the prompt bar and submits the typed answer', () => {
    useIdeStore.setState({
      runState: 'running',
      runHandle: { mode: 'browser', language: 'javascript', name: 'app.js' },
      runPrompt: { token: 'r1', promptId: 'p1', kind: 'prompt', message: 'Enter your name:', resolve: () => {} },
    });
    renderOutput();
    const input = screen.getByRole('textbox', { name: /enter your name/i });
    fireEvent.change(input, { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(actions.answerPendingPrompt).toHaveBeenCalledWith('Alice');
  });

  it('sends EOF when the prompt is canceled', () => {
    useIdeStore.setState({
      runState: 'running',
      runPrompt: { token: 'r1', promptId: 'p1', kind: 'prompt', message: 'n:', resolve: () => {} },
    });
    renderOutput();
    fireEvent.click(screen.getByRole('button', { name: /eof/i }));
    expect(actions.cancelPendingPrompt).toHaveBeenCalled();
  });

  it('shows OK/Cancel controls for a confirm prompt', () => {
    useIdeStore.setState({
      runState: 'running',
      runPrompt: { token: 'r1', promptId: 'p1', kind: 'confirm', message: 'Continue?', resolve: () => {} },
    });
    renderOutput();
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(actions.answerPendingPrompt).toHaveBeenCalledWith(true);
  });

  it('preserves Clear and Copy alongside the input surface', () => {
    useIdeStore.getState().pushOutput({ kind: 'out', text: 'hi' });
    renderOutput();
    expect(screen.getByRole('button', { name: /clear/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
  });
});
