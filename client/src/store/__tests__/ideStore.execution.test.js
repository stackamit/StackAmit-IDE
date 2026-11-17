import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
}));
import { useIdeStore } from '../ideStore.js';

beforeEach(() => {
  useIdeStore.setState({ output: [], activeExecution: null, runState: 'idle', runHandle: null });
});

describe('execution identity and output isolation', () => {
  it('assigns unique IDs, timestamps, source identity, and bounded history', () => {
    const first = useIdeStore.getState().beginExecution({ sourcePath: '/a.py', name: 'a.py' });
    useIdeStore.getState().pushOutput({ kind: 'out', text: 'a' });
    const second = useIdeStore.getState().beginExecution({ sourcePath: '/b.py', name: 'b.py' });
    useIdeStore.getState().pushOutput({ kind: 'out', text: 'b' });
    expect(first).not.toBe(second);
    expect(useIdeStore.getState().output.map((line) => line.id)).toEqual(expect.arrayContaining([
      expect.any(String), expect.any(String),
    ]));
    expect(new Set(useIdeStore.getState().output.map((line) => line.id)).size).toBe(2);
    expect(useIdeStore.getState().output[1]).toMatchObject({ executionId: second, sourcePath: '/b.py' });
    expect(typeof useIdeStore.getState().output[1].timestamp).toBe('number');
    for (let i = 0; i < 2100; i += 1) useIdeStore.getState().pushOutput({ kind: 'out', text: String(i) });
    expect(useIdeStore.getState().output).toHaveLength(2000);
  });

  it('rejects late events from a finished or replaced execution', () => {
    const first = useIdeStore.getState().beginExecution({ sourcePath: '/a.py' });
    useIdeStore.getState().pushOutput({ executionId: first, kind: 'out', text: 'first' });
    useIdeStore.getState().finishExecution(first);
    useIdeStore.getState().pushOutput({ executionId: first, kind: 'out', text: 'late' });
    const second = useIdeStore.getState().beginExecution({ sourcePath: '/b.py' });
    useIdeStore.getState().pushOutput({ executionId: first, kind: 'out', text: 'stale' });
    useIdeStore.getState().pushOutput({ executionId: second, kind: 'out', text: 'second' });
    expect(useIdeStore.getState().output.map((line) => line.text)).toEqual(['first', 'second']);
  });
});
