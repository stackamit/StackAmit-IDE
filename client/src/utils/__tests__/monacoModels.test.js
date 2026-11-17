import { describe, it, expect } from 'vitest';

import { createFakeMonaco } from '../../test/fakeMonaco.js';
import { modelUriString, findModelByPath, disposeModelForPath } from '../monacoModels.js';

const P = 'C:\\WS\\files\\main.py';

describe('modelUriString', () => {
  it('returns the canonical Uri string, not the raw path', () => {
    const monaco = createFakeMonaco();
    const uriStr = modelUriString(monaco, P);
    expect(uriStr).toBe('file:///c:/ws/files/main.py');
    expect(uriStr).not.toBe(P);
  });

  it('returns null for missing monaco or path', () => {
    const monaco = createFakeMonaco();
    expect(modelUriString(null, P)).toBeNull();
    expect(modelUriString(monaco, undefined)).toBeNull();
  });
});

describe('findModelByPath', () => {
  it('finds the model via its parsed Uri — a raw path key would miss it', () => {
    const monaco = createFakeMonaco();
    const model = monaco.getOrCreateModel(P, 'print(1)', 'python');
    expect(findModelByPath(monaco, P)).toBe(model);
    // Regression guard: models are never keyed by the raw file-system path.
    expect(monaco.models.get(P)).toBeUndefined();
  });

  it('returns null when no model exists (e.g. after disposal)', () => {
    const monaco = createFakeMonaco();
    expect(findModelByPath(monaco, P)).toBeNull();
    const model = monaco.getOrCreateModel(P);
    model.dispose();
    expect(findModelByPath(monaco, P)).toBeNull();
  });
});

describe('disposeModelForPath', () => {
  it('disposes the model and reports success', () => {
    const monaco = createFakeMonaco();
    const model = monaco.getOrCreateModel(P);
    expect(disposeModelForPath(monaco, P, [])).toBe(true);
    expect(model.disposed).toBe(true);
    expect(findModelByPath(monaco, P)).toBeNull();
  });

  it('ignores the path itself when listed in otherPaths', () => {
    const monaco = createFakeMonaco();
    const model = monaco.getOrCreateModel(P);
    expect(disposeModelForPath(monaco, P, [P])).toBe(true);
    expect(model.disposed).toBe(true);
  });

  it('refuses to dispose while another path maps to the same model URI', () => {
    const monaco = createFakeMonaco();
    const model = monaco.getOrCreateModel(P);
    // Windows-style alternate spelling resolves to the same canonical URI.
    expect(disposeModelForPath(monaco, P, ['c:\\WS\\files\\MAIN.PY'])).toBe(false);
    expect(model.disposed).toBe(false);
    // Once the other document is gone, disposal succeeds.
    expect(disposeModelForPath(monaco, P, [])).toBe(true);
    expect(model.disposed).toBe(true);
  });

  it('is a no-op when the model is already gone or monaco is missing', () => {
    const monaco = createFakeMonaco();
    expect(disposeModelForPath(monaco, P, [])).toBe(false);
    monaco.getOrCreateModel(P);
    expect(disposeModelForPath(null, P, [])).toBe(false);
  });
});
