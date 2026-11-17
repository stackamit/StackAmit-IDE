import { useCallback, useEffect, useRef } from 'react';
import { Editor } from '@monaco-editor/react';
import { Loader2 } from 'lucide-react';
import { fontStackFor } from '../../hooks/useEditorPrefs.js';
import { monacoThemeFor } from '../../monaco/themes.js';
import { useDebugStore } from '../../store/debugStore.js';

/**
 * Monaco host for the IDE. Uses the React wrapper's `path` prop so every open
 * document keeps its own model (correct `setModelLanguage` + independent view
 * state), and `keepCurrentModel` so switching tabs preserves scroll/cursor.
 *
 * The editor ref + monaco instance are handed to the parent for formatting,
 * cursor reporting and marker painting.
 */
export default function MonacoHost({ doc, themeId, prefs, onChange, onMount, onCursor }) {
  const p = prefs || {};
  const toggleBreakpoint = useDebugStore((s) => s.toggleBreakpoint);
  const breakpointDrafts = useDebugStore((s) => s.breakpointDrafts);
  const activeSession = useDebugStore((s) => s.activeDebugSessionId ? s.sessions[s.activeDebugSessionId] : null);
  const editorRef = useRef(null);
  const decorationIds = useRef([]);

  const handleMount = useCallback(
    (editor, monaco) => {
      editor.onDidChangeCursorPosition((e) => {
        onCursor?.({ lineNumber: e.position.lineNumber, column: e.position.column });
      });
      editorRef.current = editor;
      editor.onMouseDown((event) => {
        if (event.target?.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const line = event.target.position?.lineNumber;
          if (line) toggleBreakpoint(doc.path, line);
        }
      });
      onMount?.(editor, monaco);
    },
    [onMount, onCursor, toggleBreakpoint, doc.path],
  );

  const breakpointDecorations = (breakpointDrafts[doc.path] || []).map((item) => ({
    range: { startLineNumber: item.line, startColumn: 1, endLineNumber: item.line, endColumn: 1 },
    options: { isWholeLine: false, glyphMarginClassName: item.verified ? 'stackamit-breakpoint verified' : 'stackamit-breakpoint' },
  }));
  if (activeSession?.currentFrame?.line && (!activeSession.currentFrame.source?.path || activeSession.currentFrame.source.path === doc.path || activeSession.currentFrame.source.path.endsWith(doc.path))) {
    breakpointDecorations.push({
      range: { startLineNumber: activeSession.currentFrame.line, startColumn: 1, endLineNumber: activeSession.currentFrame.line, endColumn: 1 },
      options: { isWholeLine: true, className: 'stackamit-current-line' },
    });
  }

  useEffect(() => {
    if (!editorRef.current) return;
    decorationIds.current = editorRef.current.deltaDecorations(decorationIds.current, breakpointDecorations);
  }, [breakpointDrafts, doc.path, activeSession?.currentFrame?.line]);

  const handleChange = useCallback(
    (next) => onChange(next ?? ''),
    [onChange],
  );

  return (
    <Editor
      path={doc.path}
      language={doc.language}
      value={doc.content}
      theme={monacoThemeFor(themeId)}
      onChange={handleChange}
      onMount={handleMount}
      keepCurrentModel
      loading={
        <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
          <Loader2 className="animate-spin" size={18} /> Loading editor…
        </div>
      }
      options={{
        fontSize: p.fontSize ?? 15,
        fontFamily: fontStackFor(p.fontFamily || 'JetBrains Mono'),
        fontLigatures: p.ligatures ?? true,
        minimap: { enabled: p.minimap ?? true },
        lineNumbers: p.lineNumbers === false ? 'off' : 'on',
        glyphMargin: true,
        folding: true,
        automaticLayout: true,
        wordWrap: p.wordWrap === false ? 'off' : 'on',
        tabSize: p.tabSize ?? 4,
        insertSpaces: true,
        autoIndent: 'full',
        formatOnType: true,
        formatOnPaste: true,
        bracketPairColorization: { enabled: true },
        autoClosingBrackets: 'always',
        autoClosingQuotes: 'always',
        matchBrackets: 'always',
        highlightWhitespace: false,
        occurrencesHighlight: 'word',
        selectionHighlight: true,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        renderWhitespace: 'selection',
        suggestSelection: 'first',
        // Configurable IntelliSense surface (registry-backed; no fake providers):
        quickSuggestionsDelay: p.suggestDelay ?? 100,
        acceptSuggestionOnEnter: p.acceptWithEnter === false ? 'off' : 'on',
        wordBasedSuggestions: p.wordBasedSuggestions || 'currentLanguage',
        quickSuggestions: { other: true, comments: false },
        parameterHints: { enabled: true },
        hover: { enabled: true },
        padding: { top: 12, bottom: 12 },
        scrollbar: { verticalScrollbarSize: 11, horizontalScrollbarSize: 11 },
        contextmenu: true,
      }}
    />
  );
}
