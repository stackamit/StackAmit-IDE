/**
 * Minimal in-memory stand-in for a monaco instance that mirrors the model
 * keying contract of monaco-editor / @monaco-editor/react: models live under
 * their canonical `Uri.parse(path)` string, `editor.getModel` only accepts a
 * Uri (a raw path string never matches), and disposing removes the model from
 * the registry so reopening goes through get-or-create again.
 */
export function createFakeMonaco() {
  const models = new Map(); // canonical URI string -> model

  const uriFor = (p) => {
    // Deterministic, case-insensitive normalization (Windows-style) so tests
    // can assert two spellings of one path collide on the same model URI.
    let s = String(p).toLowerCase().replace(/\\/g, '/');
    if (/^[a-z]:/.test(s)) s = `file:///${s}`;
    else if (!/^[a-z][a-z0-9+.-]*:/.test(s)) s = `file://${s.startsWith('/') ? '' : '/'}${s}`;
    return { toString: () => s };
  };

  const monaco = {
    models,
    Uri: { parse: (p) => uriFor(p) },
    editor: {
      getModel: (uri) => models.get(uri.toString()) || null,
      // Marker plumbing is a no-op here; tests assert the store's problems list.
      setModelMarkers: () => {},
      createModel: (value, language, uri) => {
        const key = uri.toString();
        const model = {
          value,
          language,
          uri,
          disposed: false,
          getLineCount: () => value.split('\n').length,
          getLineContent: (n) => value.split('\n')[n - 1] ?? '',
          dispose() {
            this.disposed = true;
            models.delete(key);
          },
        };
        models.set(key, model);
        return model;
      },
    },
    /** Simulates the wrapper's getOrCreateModel for a document path. */
    getOrCreateModel(path, value = '', language = 'plaintext') {
      const uri = uriFor(path);
      return models.get(uri.toString()) || monaco.editor.createModel(value, language, uri);
    },
  };
  return monaco;
}
