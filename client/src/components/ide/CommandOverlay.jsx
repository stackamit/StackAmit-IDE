import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, FileText, Search } from 'lucide-react';

/** Fuzzy-ish filter: keep items whose key chars appear in order in the label. */
function matches(query, text) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i += 1;
  return i === q.length;
}

/**
 * Command-palette / quick-open overlay. `mode` is 'command' or 'file'. Keyboard
 * driven (↑/↓/Enter/Esc), mouse clickable; the parent supplies the items.
 */
export default function CommandOverlay({ open, mode = 'command', onClose, commands = [], files = [], onPick }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  const items = useMemo(() => {
    const source = mode === 'file' ? files : commands;
    return source.filter((it) => matches(query, it.label + (it.detail || '')));
  }, [mode, files, commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, mode]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const pick = (it) => {
    onClose();
    onPick(mode, it);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={mode === 'file' ? 'Quick Open' : 'Command Palette'}>
      <div className="w-[560px] max-w-[92vw] overflow-hidden rounded-lg border border-white/15 bg-slate-900 shadow-2xl dark:bg-[#1b1f27]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/10 px-3">
          {mode === 'file' ? <FileText size={15} className="text-slate-400" /> : <Command size={15} className="text-slate-400" />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); const it = items[index]; if (it) pick(it); }
            }}
            placeholder={mode === 'file' ? 'Search files by name…' : 'Type a command…'}
            className="w-full bg-transparent py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <Search size={14} className="text-slate-500" />
        </div>
        <ul className="scroll-slim max-h-[50vh] overflow-auto py-1">
          {items.length === 0 ? <li className="px-3 py-3 text-sm text-slate-500">No matching {mode === 'file' ? 'files' : 'commands'}.</li> : null}
          {items.map((it, i) => (
            <li key={`${it.id ?? it.label}-${i}`}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(it)}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm ${i === index ? 'bg-brand-600/30 text-white' : 'text-slate-300'}`}
              >
                <span className="truncate">{it.label}</span>
                {it.detail ? <span className="ml-auto shrink-0 truncate pl-4 text-[11px] text-slate-500">{it.detail}</span> : null}
                {it.shortcut ? <kbd className="shrink-0 rounded border border-white/15 px-1 text-[10px] text-slate-400">{it.shortcut}</kbd> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
