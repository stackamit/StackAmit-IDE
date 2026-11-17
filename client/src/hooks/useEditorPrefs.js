import { useCallback, useEffect, useState } from 'react';

const KEY = 'stackamit:editor-prefs';

// Auto Save delay bounds (ms). Shared by the store's debounce and the settings
// slider so the two can never drift into promising a range the other rejects.
export const AUTO_SAVE_MIN = 500;
export const AUTO_SAVE_MAX = 5000;
export function clampAutoSaveDelay(value) {
  const n = Number(value);
  const d = Number.isFinite(n) ? n : 1000;
  return Math.min(AUTO_SAVE_MAX, Math.max(AUTO_SAVE_MIN, Math.round(d)));
}

export const FONT_FAMILIES = [
  { value: 'JetBrains Mono', label: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace' },
  { value: 'Fira Code', label: 'Fira Code', stack: '"Fira Code", ui-monospace, Menlo, Consolas, monospace' },
  { value: 'Consolas', label: 'Consolas', stack: 'Consolas, "Courier New", monospace' },
  { value: 'Monaco', label: 'Monaco', stack: 'Monaco, "Lucida Console", monospace' },
  { value: 'ui-monospace', label: 'System Mono', stack: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
];

export const DEFAULT_PREFS = {
  fontSize: 15,
  fontFamily: 'JetBrains Mono',
  tabSize: 4,
  wordWrap: true,
  minimap: false,
  lineNumbers: true,
  ligatures: true,
  // Auto Save: debounce after the last edit, then persist the affected document
  // through the existing workspace pipeline. `autoSaveDelay` is clamped to
  // AUTO_SAVE_MIN/MAX wherever it is applied, so a bad stored value is harmless.
  autoSave: true,
  autoSaveDelay: 1000, // ms after the last keystroke; range 500–5000
  // IntelliSense behaviour (wired into Monaco options by MonacoHost):
  suggestDelay: 100, // editor.quickSuggestionsDelay, ms
  acceptWithEnter: true, // acceptSuggestionOnEnter (Tab always accepts)
  wordBasedSuggestions: 'currentLanguage', // off | currentLanguage | allLanguages
  snippets: true, // snippet completions from src/languages/snippets.js
};

/** Pure reader for non-hook contexts (snippet providers evaluate prefs live). */
export function readPrefs() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PREFS };
}

function load() {
  return readPrefs();
}

/** Persisted Monaco editor preferences, shared by the editor and settings panel. */
export function useEditorPrefs() {
  const [prefs, setPrefs] = useState(load);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  const update = useCallback((patch) => setPrefs((p) => ({ ...p, ...patch })), []);
  const reset = useCallback(() => setPrefs({ ...DEFAULT_PREFS }), []);

  return { prefs, update, reset, setPrefs };
}

export function fontStackFor(name) {
  return (FONT_FAMILIES.find((f) => f.value === name) || FONT_FAMILIES[0]).stack;
}

export default useEditorPrefs;
