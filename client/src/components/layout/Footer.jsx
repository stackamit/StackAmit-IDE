const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || '');
const MOD = isMac ? '⌘' : 'Ctrl';

/** Compact IDE footer: keyboard-shortcut hints only. */
export default function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 border-t border-slate-200 bg-white px-4 py-1.5 text-[11px] text-slate-500 dark:border-ink-800 dark:bg-ink-900 dark:text-slate-400">
      <span className="flex items-center gap-3">
        <span>
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-ink-800">{MOD} + Enter</kbd> run
        </span>
        <span>
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-ink-800">{MOD} + S</kbd> save file
        </span>
        <span>
          <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-ink-800">{MOD} + Shift + F</kbd> format
        </span>
      </span>
    </footer>
  );
}
