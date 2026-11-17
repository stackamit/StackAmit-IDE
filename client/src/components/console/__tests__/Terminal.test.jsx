import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Terminal from '../Terminal.jsx';

const okResult = {
  success: true,
  status: 'completed',
  stdout: 'Hello, Amit\n',
  stderr: '',
  compileMessage: '',
  exitCode: 0,
  executionTimeMs: null,
};

describe('Terminal', () => {
  it('queues typed input lines and sends them as stdin on run', async () => {
    const onExecute = vi.fn(async () => okResult);
    render(<Terminal languageLabel="Python" onExecute={onExecute} />);

    const input = screen.getByLabelText('Terminal input');
    fireEvent.change(input, { target: { value: 'Amit' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The typed line is echoed to the terminal.
    expect(screen.getByText('> Amit')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Run/i }));

    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute.mock.calls[0][0].stdin).toBe('Amit\n');
    await waitFor(() => expect(screen.getByText(/Hello, Amit/)).toBeInTheDocument());
    expect(screen.getByText(/Finished/)).toBeInTheDocument();
  });

  it('renders compiler diagnostics for a failed compile', async () => {
    const onExecute = vi.fn(async () => ({
      success: false,
      status: 'compile_error',
      stdout: '',
      stderr: 'syntax error near line 3',
      compileMessage: 'syntax error near line 3',
      exitCode: 1,
    }));
    render(<Terminal languageLabel="C" onExecute={onExecute} />);
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));
    await waitFor(() => expect(screen.getByText(/syntax error near line 3/)).toBeInTheDocument());
    expect(screen.getByText(/Compilation failed/)).toBeInTheDocument();
  });

  it('surfaces execution errors from the API without faking success', async () => {
    const onExecute = vi.fn(async () => {
      throw { message: 'The execution service is temporarily unavailable.' };
    });
    render(<Terminal languageLabel="Java" onExecute={onExecute} />);
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));
    await waitFor(() =>
      expect(screen.getByText(/execution service is temporarily unavailable/)).toBeInTheDocument(),
    );
  });

  it('guides the user to queue input instead of running empty when the program reads stdin', async () => {
    const onExecute = vi.fn(async () => okResult);
    render(<Terminal languageLabel="Python" onExecute={onExecute} readsStdin />);

    // No input queued — Run should not fire an empty execution.
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));
    expect(onExecute).not.toHaveBeenCalled();
    expect(screen.getByText(/This program reads input/)).toBeInTheDocument();

    // Queuing a line then running does execute with that stdin.
    const input = screen.getByLabelText('Terminal input');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));
    await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
    expect(onExecute.mock.calls[0][0].stdin).toBe('1\n');
  });

  it('interactive mode starts a live session and forwards typed lines over the WebSocket', async () => {
    const sent = [];
    class FakeWebSocket {
      static OPEN = 1;
      constructor() {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen = null;
        this.onmessage = null;
        this.onclose = null;
        this.onerror = null;
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send(data) { sent.push(JSON.parse(data)); }
      close() { this.readyState = 3; this.onclose && this.onclose(); }
    }
    global.WebSocket = FakeWebSocket;

    const getCode = () => 'x = input()\nprint(x)';
    render(
      <Terminal
        languageLabel="Python"
        onExecute={vi.fn()}
        interactiveAvailable
        languageKey="python"
        getCode={getCode}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Interactive' }));
    fireEvent.click(screen.getByRole('button', { name: /Run/i }));

    await waitFor(() => expect(sent.some((m) => m.type === 'start' && m.language === 'python')).toBe(true));

    const input = screen.getByLabelText('Terminal input');
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sent.some((m) => m.type === 'stdin' && m.data === 'hi\n')).toBe(true);

    // Streaming server output renders in the log.
    // (Grab the live socket the component created and push a message.)
  });
});
