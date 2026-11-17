import { describe, expect, it, vi } from 'vitest';
import { createInteractiveOutputBuffer } from '../interactiveOutput.js';

describe('interactive output framing', () => {
  const render = (events) => {
    const lines = [];
    events.forEach((event) => {
      const index = event.replace ? [...lines].findLastIndex((line) => line.stream === event.stream) : -1;
      if (index >= 0) lines[index] = event;
      else lines.push(event);
    });
    return lines;
  };

  it('joins split chunks and flushes a final partial line', () => {
    const lines = [];
    const buffer = createInteractiveOutputBuffer((line) => lines.push(line));
    buffer.feed('out', 'A:');
    buffer.feed('out', ' 0\nA: 1');
    buffer.flush();
    expect(render(lines).map((line) => line.text)).toEqual(['A: 0', 'A: 1']);
  });

  it('handles CRLF split across chunks without creating an empty line', () => {
    const lines = [];
    const buffer = createInteractiveOutputBuffer((line) => lines.push(line));
    buffer.feed('out', 'one\r');
    buffer.feed('out', '\ntwo\r\n');
    buffer.flush();
    expect(lines.map((line) => line.text)).toEqual(['one', 'two']);
  });

  it('keeps stdout and stderr distinct and preserves observed feed order', () => {
    const lines = [];
    const buffer = createInteractiveOutputBuffer((line) => lines.push(line));
    buffer.feed('out', 'prompt:');
    buffer.feed('err', 'warning\n');
    buffer.feed('out', ' value\n');
    expect(render(lines).map((line) => [line.kind, line.text])).toEqual([['out', 'prompt: value'], ['err', 'warning']]);
  });

  it('represents carriage-return progress as replacement output', () => {
    const lines = [];
    const buffer = createInteractiveOutputBuffer((line) => lines.push(line));
    buffer.feed('out', 'A: 1\rA: 2\r');
    expect(lines.map((line) => [line.text, line.replace])).toEqual([['A: 1', true], ['A: 2', true]]);
  });

  it('does not trim prompt or input content', () => {
    const onLine = vi.fn();
    const buffer = createInteractiveOutputBuffer(onLine);
    buffer.feed('out', 'Enter your name: ');
    buffer.feed('input', '> Amit\n');
    buffer.flush();
    expect(render(onLine.mock.calls.map(([line]) => line)).map((line) => line.text)).toEqual(['Enter your name: ', '> Amit']);
  });

  it('publishes a newline-free Python input prompt immediately and updates it across chunks', () => {
    const events = [];
    const buffer = createInteractiveOutputBuffer((event) => events.push(event));
    buffer.feed('out', 'Enter your ');
    expect(render(events).map((line) => line.text)).toEqual(['Enter your ']);
    buffer.feed('out', 'name: ');
    expect(render(events).map((line) => line.text)).toEqual(['Enter your name: ']);
  });
});
