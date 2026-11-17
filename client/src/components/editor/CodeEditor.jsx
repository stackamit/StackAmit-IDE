import { Editor } from '@monaco-editor/react';
import { Loader2 } from 'lucide-react';
import { fontStackFor } from '../../hooks/useEditorPrefs.js';

/**
 * Thin, controlled wrapper around Monaco. All editor behaviour (formatting,
 * run shortcuts) is wired by the parent through the forwarded editorRef.
 */
export default function CodeEditor({
  value,
  language,
  theme,
  fontSize,
  prefs,
  onChange,
  onMount,
}) {
  const p = prefs || {};
  return (
    <Editor
      height="100%"
      theme={theme}
      language={language}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      onMount={onMount}
      loading={
        <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="animate-spin" size={18} /> Loading editor…
        </div>
      }
      options={{
        fontSize,
        fontFamily: fontStackFor(p.fontFamily || 'JetBrains Mono'),
        fontLigatures: p.ligatures ?? true,
        minimap: { enabled: p.minimap ?? false },
        lineNumbers: p.lineNumbers === false ? 'off' : 'on',
        automaticLayout: true,
        wordWrap: p.wordWrap === false ? 'off' : 'on',
        folding: true,
        autoIndent: 'full',
        tabSize: p.tabSize ?? 4,
        insertSpaces: true,
        bracketPairColorization: { enabled: true },
        matchesBrackets: true,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: 'selection',
        padding: { top: 14, bottom: 14 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      }}
    />
  );
}
