/**
 * Monaco model lookup helpers.
 *
 * @monaco-editor/react keys every text model by a `monaco.Uri` — it creates and
 * resolves models through `monaco.editor.getModel(monaco.Uri.parse(path))`, so
 * looking a model up with a raw file-system path string silently returns null.
 * That leak never disposes closed tabs' models and resurrects stale content
 * when a file is reopened. All lookup/disposal goes through these helpers so
 * the exact same Uri conversion is used everywhere.
 */

/** Canonical URI string for a document path, or null when the Uri API fails. */
export function modelUriString(monaco, path) {
  if (!monaco || typeof path !== 'string') return null;
  try {
    return monaco.Uri.parse(path).toString();
  } catch (err) {
    console.warn('Monaco URI conversion skipped:', err);
    return null;
  }
}

/** The model registered for a document path (Uri-keyed lookup), or null. */
export function findModelByPath(monaco, path) {
  if (!monaco || typeof path !== 'string') return null;
  try {
    return monaco.editor.getModel(monaco.Uri.parse(path)) || null;
  } catch (err) {
    console.warn('Monaco model lookup failed:', err);
    return null;
  }
}

/**
 * Dispose the model for `path` — but only when no path in `otherPaths` (e.g.
 * still-open documents) resolves to the same URI. Two different path strings
 * can map to one model (Windows case-insensitive paths, dot-segment
 * normalization), so the comparison is done on canonical URI strings.
 * Returns true when a model was actually disposed.
 */
export function disposeModelForPath(monaco, path, otherPaths = []) {
  const uriStr = modelUriString(monaco, path);
  if (!uriStr) return false;
  const stillUsed = otherPaths.some((p) => p !== path && modelUriString(monaco, p) === uriStr);
  if (stillUsed) return false;
  const model = findModelByPath(monaco, path);
  if (!model) return false;
  try {
    model.dispose();
    return true;
  } catch (err) {
    console.warn('Monaco model disposal skipped:', err);
    return false;
  }
}
