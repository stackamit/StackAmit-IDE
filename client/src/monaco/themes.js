/**
 * Monaco UI themes for StackAmit-IDE.
 *
 * `stackamit-dark-modern` is an original palette inspired by the look and feel
 * of modern dark editors (no proprietary assets or color tables copied). We also
 * ship `stackamit-light` and reuse Monaco's built-in `vs` / `vs-dark`.
 */
import monaco from './monacoSetup.js';

export const THEMES = [
  { id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', base: 'vs-dark', monaco: 'stackamit-dark-modern', ui: 'dark' },
  { id: 'vs-dark', label: 'VS Code Dark', base: 'vs-dark', monaco: 'vs-dark', ui: 'dark' },
  { id: 'light', label: 'Light', base: 'vs', monaco: 'light', ui: 'light' },
];

// Color themes that only appear in the picker once the "Extra Themes" extension
// is installed & enabled. They are always defined in Monaco so selecting one is
// safe regardless of load order.
export const PACK_THEMES = [
  { id: 'monokai', label: 'Monokai', base: 'vs-dark', monaco: 'monokai', ui: 'dark' },
  { id: 'dracula', label: 'Dracula', base: 'vs-dark', monaco: 'dracula', ui: 'dark' },
  { id: 'solarized-light', label: 'Solarized Light', base: 'vs', monaco: 'solarized-light', ui: 'light' },
];

export const DEFAULT_THEME_ID = 'stackamit-dark-modern';

/** Themes selectable in the UI; PACK_THEMES only when the theme pack is active. */
export function getThemes({ themePack = false } = {}) {
  return themePack ? [...THEMES, ...PACK_THEMES] : THEMES;
}

const stackamitDark = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c586c0' },
    { token: 'keyword.control', foreground: 'c586c0' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'number', foreground: 'b5cea8' },
    { token: 'constant', foreground: '569cd6' },
    { token: 'type', foreground: '4ec9b0' },
    { token: 'type.identifier', foreground: '4ec9b0' },
    { token: 'function', foreground: 'dcdcaa' },
    { token: 'identifier', foreground: '9cdcfe' },
    { token: 'variable', foreground: '9cdcfe' },
    { token: 'operator', foreground: 'd4d4d4' },
    { token: 'delimiter', foreground: 'd4d4d4' },
    { token: 'invalid', foreground: 'f44747' },
  ],
  colors: {
    'editor.background': '#1b1f27',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#232834',
    'editor.selectionBackground': '#2d4a70',
    'editorCursor.foreground': '#aeafad',
    'editorLineNumber.foreground': '#5a6272',
    'editorLineNumber.activeForeground': '#c6c9cc',
    'editorIndentGuide.background': '#2a2f3a',
    'editorIndentGuide.activeBackground': '#3a4150',
    'editorWidget.background': '#20252f',
    'editorSuggestWidget.background': '#20252f',
    'editorHoverWidget.background': '#20252f',
    'editorError.foreground': '#f14c4c',
    'editorWarning.foreground': '#cca700',
    'minimap.background': '#1b1f27',
  },
};

const stackamitLight = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '0a7d00', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'af00db' },
    { token: 'string', foreground: 'a31515' },
    { token: 'number', foreground: '098658' },
    { token: 'type', foreground: '267f99' },
    { token: 'function', foreground: '795e26' },
    { token: 'variable', foreground: '001080' },
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.lineHighlightBackground': '#f2f4f8',
    'editor.selectionBackground': '#add6ff',
  },
};

let registered = false;
export function registerThemes() {
  if (registered) return;
  monaco.editor.defineTheme('stackamit-dark-modern', stackamitDark);
  monaco.editor.defineTheme('stackamit-light', stackamitLight);
  monaco.editor.defineTheme('monokai', monokaiTheme);
  monaco.editor.defineTheme('dracula', draculaTheme);
  monaco.editor.defineTheme('solarized-light', solarizedLightTheme);
  registered = true;
}

const monokaiTheme = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f92672' },
    { token: 'string', foreground: 'e6db74' },
    { token: 'number', foreground: 'ae81ff' },
    { token: 'type', foreground: '66d9ef' },
    { token: 'function', foreground: 'a6e22e' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'constant', foreground: '66d9ef' },
  ],
  colors: {
    'editor.background': '#272822',
    'editor.foreground': '#f8f8f2',
    'editor.lineHighlightBackground': '#3e3d32',
    'editor.selectionBackground': '#49483e',
    'editorCursor.foreground': '#f8f8f0',
    'editorLineNumber.foreground': '#75715e',
    'editorLineNumber.activeForeground': '#cfcfc2',
  },
};

const draculaTheme = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff79c6' },
    { token: 'string', foreground: 'f1fa8c' },
    { token: 'number', foreground: 'bd93f9' },
    { token: 'type', foreground: '8be9fd' },
    { token: 'function', foreground: '50fa7b' },
    { token: 'variable', foreground: 'f8f8f2' },
  ],
  colors: {
    'editor.background': '#282a36',
    'editor.foreground': '#f8f8f2',
    'editor.lineHighlightBackground': '#44475a',
    'editor.selectionBackground': '#44475a',
    'editorCursor.foreground': '#f8f8f0',
    'editorLineNumber.foreground': '#6272a4',
  },
};

const solarizedLightTheme = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '93a1a1', fontStyle: 'italic' },
    { token: 'keyword', foreground: '859900' },
    { token: 'string', foreground: '2aa198' },
    { token: 'number', foreground: 'd33682' },
    { token: 'type', foreground: 'b58900' },
    { token: 'function', foreground: '268bd2' },
    { token: 'variable', foreground: '657b83' },
  ],
  colors: {
    'editor.background': '#fdf6e3',
    'editor.foreground': '#657b83',
    'editor.lineHighlightBackground': '#eee8d5',
    'editor.selectionBackground': '#e3dbca',
    'editorCursor.foreground': '#657b83',
  },
};

/** Map a StackAmit theme id to the Monaco theme name to apply. */
export function monacoThemeFor(id) {
  registerThemes();
  const t = [...THEMES, ...PACK_THEMES].find((x) => x.id === id);
  return t ? t.monaco : 'vs-dark';
}

export function themeMeta(id) {
  return [...THEMES, ...PACK_THEMES].find((t) => t.id === id) || THEMES[0];
}
