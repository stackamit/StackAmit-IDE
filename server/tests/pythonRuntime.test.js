import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { probeDebugpy } from '../src/debug/pythonRuntime.js';

describe('Python debugger runtime detection', () => {
  it('returns a safe unavailable result for an invalid executable', async () => {
    const result = await probeDebugpy('__stackamit_missing_python__', 250);
    assert.equal(result.available, false);
    assert.match(result.reason, /Python|debugpy/i);
  });
});
