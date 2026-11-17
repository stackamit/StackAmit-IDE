import { X, Settings2, RotateCcw, Sun, Moon } from 'lucide-react';
import { FONT_FAMILIES } from '../../hooks/useEditorPrefs.js';

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="focus-ring flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-ink-800"
    >
      <span>{label}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-ink-700'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function Field({ children, label }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'focus-ring w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 dark:border-ink-700 dark:bg-ink-850 dark:text-slate-200';

/**
 * Slide-over that lets a user customize the editor to their preference.
 * All choices persist locally (per browser) via the editor-prefs hook.
 */
export default function EditorSettings({ open, onClose, prefs, update, reset, isDark, onToggleTheme }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label="Customize IDE">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative flex h-full w-[min(92vw,22rem)] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-ink-800 dark:bg-ink-900">
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-ink-800">
          <Settings2 size={18} className="text-brand-500" />
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Customize IDE</h2>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring ml-auto rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800"
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </header>

        <div className="scroll-slim flex-1 space-y-5 overflow-auto px-4 py-4">
          <div className="flex items-center justify-between rounded-lg bg-slate-100 p-1 dark:bg-ink-850">
            <button
              type="button"
              onClick={() => isDark && onToggleTheme()}
              className={`focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium ${
                !isDark ? 'bg-white text-slate-800 shadow dark:bg-ink-800' : 'text-slate-500'
              }`}
            >
              <Sun size={15} /> Light
            </button>
            <button
              type="button"
              onClick={() => !isDark && onToggleTheme()}
              className={`focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium ${
                isDark ? 'bg-ink-800 text-white shadow' : 'text-slate-500'
              }`}
            >
              <Moon size={15} /> Dark
            </button>
          </div>

          <Field label={`Font size — ${prefs.fontSize}px`}>
            <input
              type="range"
              min={12}
              max={24}
              step={1}
              value={prefs.fontSize}
              onChange={(e) => update({ fontSize: Number(e.target.value) })}
              className="w-full accent-brand-600"
            />
          </Field>

          <Field label="Font family">
            <select className={inputCls} value={prefs.fontFamily} onChange={(e) => update({ fontFamily: e.target.value })}>
              {FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tab size">
            <select className={inputCls} value={prefs.tabSize} onChange={(e) => update({ tabSize: Number(e.target.value) })}>
              {[2, 4, 8].map((n) => (
                <option key={n} value={n}>
                  {n} spaces
                </option>
              ))}
            </select>
          </Field>

          <div className="space-y-1 border-t border-slate-200 pt-3 dark:border-ink-800">
            <Switch label="Word wrap" checked={prefs.wordWrap} onChange={(v) => update({ wordWrap: v })} />
            <Switch label="Show minimap" checked={prefs.minimap} onChange={(v) => update({ minimap: v })} />
            <Switch label="Line numbers" checked={prefs.lineNumbers} onChange={(v) => update({ lineNumbers: v })} />
            <Switch label="Font ligatures" checked={prefs.ligatures} onChange={(v) => update({ ligatures: v })} />
          </div>

          <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-ink-800">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">IntelliSense</div>
            <Field label={`Suggestion delay — ${prefs.suggestDelay ?? 100}ms`}>
              <select
                className={inputCls}
                value={prefs.suggestDelay ?? 100}
                onChange={(e) => update({ suggestDelay: Number(e.target.value) })}
              >
                {[0, 50, 100, 300, 500].map((ms) => (
                  <option key={ms} value={ms}>{ms === 0 ? 'Instant (0ms)' : `${ms}ms`}</option>
                ))}
              </select>
            </Field>
            <Field label="Word-based suggestions">
              <select
                className={inputCls}
                value={prefs.wordBasedSuggestions || 'currentLanguage'}
                onChange={(e) => update({ wordBasedSuggestions: e.target.value })}
              >
                <option value="off">Off (language services only)</option>
                <option value="currentLanguage">Current language</option>
                <option value="allLanguages">All open documents</option>
              </select>
            </Field>
            <Switch label="Accept suggestions with Enter (Tab always accepts)" checked={prefs.acceptWithEnter !== false} onChange={(v) => update({ acceptWithEnter: v })} />
            <Switch label="Snippet completions" checked={prefs.snippets !== false} onChange={(v) => update({ snippets: v })} />
            <p className="text-[11px] leading-snug text-slate-500">
              Full IntelliSense (completions, hover, definitions, rename, diagnostics) is provided by real
              language services for TypeScript/JavaScript, JSON, CSS/SCSS/Less and HTML. Other languages get
              highlighting, word suggestions and snippets until their language server is installed.
            </p>
          </div>

          <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-ink-850 dark:text-slate-400">
            Preferences and your code drafts are stored only in this browser (localStorage). Nothing is uploaded.
          </p>
        </div>

        <footer className="border-t border-slate-200 px-4 py-3 dark:border-ink-800">
          <button
            type="button"
            onClick={reset}
            className="focus-ring inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            <RotateCcw size={15} /> Reset to defaults
          </button>
        </footer>
      </div>
    </div>
  );
}
