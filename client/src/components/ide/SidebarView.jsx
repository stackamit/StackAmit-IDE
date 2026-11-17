import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Settings as SettingsIcon, Check, ScrollText, Terminal as TerminalIcon, Wrench } from 'lucide-react';
import { workspace } from '../../services/workspace.js';
import { useIdeStore } from '../../store/ideStore.js';
import { LANGUAGES } from '../../languages/languageCapabilities.js';
import { useEditorPrefs, FONT_FAMILIES, AUTO_SAVE_MIN, AUTO_SAVE_MAX } from '../../hooks/useEditorPrefs.js';
import { getThemes } from '../../monaco/themes.js';
import FileExplorer from './FileExplorer.jsx';
import ExtensionsPanel from './ExtensionsPanel.jsx';
import LanguageCatalogue from './LanguageCatalogue.jsx';
import JavaDependenciesPanel from './JavaDependenciesPanel.jsx';

/** Recursively list file paths under a directory (bounded for safety). */
async function listAll(dir, cap = 2000) {
  const out = [];
  const stack = [dir];
  while (stack.length && out.length < cap) {
    const d = stack.pop();
    const res = await workspace.readDirectory(d);
    if (!res.ok) continue;
    for (const e of res.entries) {
      if (e.isDirectory) stack.push(e.path);
      else if (out.length < cap) out.push(e.path);
    }
  }
  return out;
}

/** Escape a literal query so it can be used inside a RegExp. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the search matcher once for the whole run. A malformed regex is an
 * error the user sees, not an empty result set pretending the text is absent.
 */
export function buildMatcher(query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  if (!query) return null;
  let source;
  try {
    source = regex ? query : escapeRegExp(query);
    // \b only brackets word characters, so a query of punctuation would never
    // match; lookarounds say "not part of a word" for every shape of query.
    if (wholeWord) source = `(?<![\\w$])${source}(?![\\w$])`;
    return { re: new RegExp(source, 'g' + (caseSensitive ? '' : 'i')), error: null };
  } catch (e) {
    return { re: null, error: e.message || 'Invalid regular expression.' };
  }
}

/**
 * Find `query` in one line of text. Returns the matches with their 1-based
 * column, or null when the line does not contain the query.
 */
export function matchLine(line, matcher) {
  if (!matcher?.re) return null;
  const re = matcher.re;
  re.lastIndex = 0;
  const hits = [];
  let m;
  // Guard against a zero-width match spinning forever (`^`, `x*`).
  let guard = 0;
  while ((m = re.exec(line)) !== null && guard++ < 500) {
    if (m.index === re.lastIndex) re.lastIndex += 1;
    else hits.push({ index: m.index, text: m[0] });
  }
  return hits.length ? hits : null;
}

/** Replace every match in a line. Literal searches never interpret `$&`. */
export function replaceLine(line, matcher, replacement, { regex = false } = {}) {
  if (!matcher?.re) return line;
  return regex
    ? line.replace(matcher.re, replacement)
    : line.replace(matcher.re, () => replacement);
}

function OptionChip({ active, title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`focus-ring shrink-0 rounded border px-1.5 py-1 font-mono text-[11px] leading-none ${
        active ? 'border-brand-500 bg-brand-600/25 text-white' : 'border-white/10 text-slate-400 hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );
}

function SearchView({ actions }) {
  const root = useIdeStore((s) => s.root);
  const treeRevision = useIdeStore((s) => s.treeRevision);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState({ caseSensitive: false, wholeWord: false, regex: false });
  const [showReplace, setShowReplace] = useState(false);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  // The file list follows the tree: a file created after the search view opened
  // has to be searchable, otherwise "Find in Files" quietly misses new work.
  useEffect(() => {
    if (!root) return undefined;
    let cancelled = false;
    setLoading(true);
    listAll(root).then((f) => {
      if (cancelled) return;
      setFiles(f);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [root, treeRevision]);

  const toggleOption = (key) => {
    setOptions((o) => {
      const next = { ...o, [key]: !o[key] };
      if (key === 'regex' && next.regex) next.wholeWord = false;
      if (key === 'wholeWord' && next.wholeWord) next.regex = false;
      return next;
    });
  };

  const run = useCallback(async () => {
    setError('');
    setStatus('');
    if (!query) { setResults([]); return; }
    const matcher = buildMatcher(query, options);
    if (matcher.error) {
      setError(`Invalid pattern: ${matcher.error}`);
      setResults([]);
      return;
    }
    setLoading(true);
    const found = [];
    for (const path of files) {
      const res = await workspace.readFile(path);
      if (!res.ok) continue;
      res.content.split('\n').forEach((line, i) => {
        const hits = matchLine(line, matcher);
        if (hits) {
          for (const hit of hits) {
            found.push({ path, line: i + 1, column: hit.index + 1, text: line.trim().slice(0, 120) });
            if (found.length > 2000) break;
          }
        }
      });
      if (found.length > 2000) break;
    }
    setResults(found);
    setStatus(found.length ? `${found.length} match(es) in ${new Set(found.map((f) => f.path)).size} file(s)` : 'No results.');
    setLoading(false);
  }, [query, files, options]);

  const replaceAll = useCallback(async () => {
    if (!query || !results.length) return;
    const matcher = buildMatcher(query, options);
    if (matcher.error) {
      setError(`Invalid pattern: ${matcher.error}`);
      return;
    }
    const byFile = new Map();
    for (const r of results) {
      if (!byFile.has(r.path)) byFile.set(r.path, []);
      byFile.get(r.path).push(r);
    }
    let changedFiles = 0;
    let changedLines = 0;
    const failures = [];
    for (const path of byFile.keys()) {
      const res = await workspace.readFile(path);
      if (!res.ok) {
        failures.push(path);
        continue;
      }
      const lines = res.content.split('\n');
      let touched = 0;
      const nextLines = lines.map((line) => {
        if (!matchLine(line, matcher)) return line;
        touched += 1;
        return replaceLine(line, matcher, replacement, { regex: options.regex });
      });
      if (!touched) continue;
      const written = await workspace.writeFile(path, nextLines.join('\n'));
      if (written?.ok) {
        changedFiles += 1;
        changedLines += touched;
        // Keep the open editor in sync, or the tab shows stale text over new disk
        // content and the next save would undo the replacement.
        actions?.refreshFileFromDisk?.(path);
      } else {
        failures.push(path);
      }
    }
    setStatus(
      `${changedLines} replacement(s) in ${changedFiles} file(s)` +
        (failures.length ? ` — ${failures.length} file(s) could not be written.` : '.'),
    );
    run();
  }, [query, results, options, replacement, run, actions]);

  const openMatch = useCallback(
    async (match) => {
      await actions.openFileByPath(match.path);
      actions.revealInEditor?.(match.line, match.column);
    },
    [actions],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Search</div>
        <button
          type="button"
          onClick={() => setShowReplace((v) => !v)}
          className="focus-ring ml-auto rounded px-1 text-[11px] text-slate-400 hover:text-slate-200"
          aria-pressed={showReplace}
        >
          {showReplace ? 'Hide replace' : 'Replace'}
        </button>
      </div>
      <div className="mb-2 flex gap-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="Search in files…"
          aria-label="Search in files"
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/60"
        />
        <div className="flex gap-1">
          <OptionChip title="Match case" active={options.caseSensitive} onClick={() => toggleOption('caseSensitive')}>Aa</OptionChip>
          <OptionChip title="Match whole word (not with regex)" active={options.wholeWord} onClick={() => toggleOption('wholeWord')}>Ab|</OptionChip>
          <OptionChip title="Regular expression (not with whole word)" active={options.regex} onClick={() => toggleOption('regex')}>.*</OptionChip>
        </div>
        <button type="button" onClick={run} className="focus-ring rounded bg-brand-600 px-2 text-white hover:bg-brand-500" aria-label="Search">
          <Search size={15} />
        </button>
      </div>
      {showReplace ? (
        <div className="mb-2 flex gap-1">
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="Replace with…"
            aria-label="Replace with"
            className="min-w-0 flex-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/60"
          />
          <button
            type="button"
            onClick={replaceAll}
            disabled={!results.length}
            title={results.length ? 'Replace every match in the search results' : 'Search first'}
            className="focus-ring rounded border border-white/15 px-2 py-1 text-[12px] text-slate-200 hover:bg-white/5 disabled:opacity-40"
          >
            All
          </button>
        </div>
      ) : null}
      {error ? <div role="alert" className="mb-2 px-1 text-[11px] text-rose-400">{error}</div> : null}
      {status ? <div className="mb-1 px-1 text-[11px] text-slate-500">{status}</div> : null}
      <div className="scroll-slim min-h-0 flex-1 overflow-auto">
        {loading ? <div className="flex items-center gap-2 p-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> searching…</div> : null}
        {!loading && results.length === 0 && query && !error ? <div className="p-2 text-xs text-slate-500">No results.</div> : null}
        {results.map((r, i) => (
          <button
            key={`${r.path}-${r.line}-${r.column}-${i}`}
            type="button"
            onClick={() => openMatch(r)}
            title={`${r.path}:${r.line}`}
            className="block w-full px-2 py-1 text-left text-[12px] hover:bg-white/5"
          >
            <div className="truncate text-slate-400">{String(r.path).split(/[\\/]/).pop()}:{r.line}:{r.column}</div>
            <div className="truncate font-mono text-slate-200">{r.text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsView({ actions }) {
  const { prefs, update } = useEditorPrefs();
  const themeId = useIdeStore((s) => s.themeId);
  const setThemeId = useIdeStore((s) => s.setThemeId);
  const runMode = useIdeStore((s) => s.runMode);
  const setRunMode = useIdeStore((s) => s.setRunMode);
  const compilerPaths = useIdeStore((s) => s.compilerPaths);
  const setCompilerPath = useIdeStore((s) => s.setCompilerPath);
  const localRuntimes = useIdeStore((s) => s.localRuntimes);
  const cancelAllAutoSaves = useIdeStore((s) => s.cancelAllAutoSaves);
  const themePackOn = useIdeStore((s) => Boolean(s.extensions['extra-themes']?.installed && s.extensions['extra-themes']?.enabled));
  const themes = getThemes({ themePack: themePackOn });
  const isDesktop = workspace.mode === 'desktop';
  // Languages the offline desktop run compiles with a separate tool (cpp, and
  // TypeScript via its project tsc). Driven from the capability registry, so a
  // language is listed here exactly when it is a real, verified local run —
  // never a hand-maintained second list that could drift from the truth.
  const toolchainLangs = LANGUAGES.filter((l) => l.compiler && l.localRun);

  return (
    <div className="scroll-slim min-h-0 flex-1 overflow-auto p-3 text-[13px] text-slate-200">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <SettingsIcon size={14} /> Settings
      </div>

      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Execution</div>
      <p className="mb-2 text-[11px] text-slate-500">Where a program runs when you press Run. Saved and applied on every Run.</p>
      <div className="mb-4 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setRunMode('output')}
          className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left ${runMode === 'output' ? 'border-brand-500 bg-brand-600/15' : 'border-white/10 hover:bg-white/5'}`}
        >
          <ScrollText size={14} className="text-slate-400" />
          <span className="flex-1">
            <span className="block">Run in Output</span>
            <span className="block text-[11px] text-slate-500">Managed panel: compile, run, exit and Stop captured per step.</span>
          </span>
          {runMode === 'output' ? <Check size={14} className="text-brand-300" /> : null}
        </button>
        <button
          type="button"
          onClick={() => setRunMode('terminal')}
          disabled={!isDesktop}
          className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left disabled:opacity-50 ${runMode === 'terminal' ? 'border-brand-500 bg-brand-600/15' : 'border-white/10 hover:bg-white/5'}`}
          title={isDesktop ? undefined : 'The integrated terminal is available in the desktop app only.'}
        >
          <TerminalIcon size={14} className="text-slate-400" />
          <span className="flex-1">
            <span className="block">Run in Terminal</span>
            <span className="block text-[11px] text-slate-500">{isDesktop ? 'A real shell running the identical build command.' : 'Desktop only — the browser has no local terminal.'}</span>
          </span>
          {runMode === 'terminal' ? <Check size={14} className="text-brand-300" /> : null}
        </button>
      </div>

      {isDesktop && toolchainLangs.length ? (
        <>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Toolchains</div>
          <p className="mb-2 text-[11px] text-slate-500">Leave a path empty to auto-detect the installed tool. A configured path is validated by running it — never silently replaced with a different one.</p>
          <div className="mb-4 flex flex-col gap-3">
            {toolchainLangs.map((cap) => {
              const rt = localRuntimes?.[cap.localRun];
              return (
                <div key={cap.id}>
                  <label className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
                    <Wrench size={12} className="text-slate-500" /> {cap.label} · {cap.compiler.tool}
                  </label>
                  <input
                    value={compilerPaths[cap.monaco] || ''}
                    onChange={(e) => setCompilerPath(cap.monaco, e.target.value.trim() || null)}
                    onBlur={() => actions?.refreshLocalRuntimes?.()}
                    placeholder={cap.compiler.placeholder}
                    spellCheck={false}
                    className="mb-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1 text-[12px]"
                  />
                  <div className="text-[11px] leading-snug">
                    {rt?.available
                      ? <span className="text-emerald-400">Detected · {rt.version || rt.path}</span>
                      : <span className="text-slate-500">{cap.compiler.note}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Appearance</div>
      <label className="mb-1 block text-xs text-slate-400">Color theme</label>
      <div className="mb-4 flex flex-col gap-1">
        {themes.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setThemeId(t.id)}
            className={`flex items-center gap-2 rounded border px-2 py-1.5 text-left ${themeId === t.id ? 'border-brand-500 bg-brand-600/15' : 'border-white/10 hover:bg-white/5'}`}
          >
            <span className={`inline-block h-3 w-3 rounded-full ${t.ui === 'dark' ? 'bg-slate-900' : 'bg-slate-100'}`} />
            {t.label}
            {themeId === t.id ? <Check size={14} className="ml-auto text-brand-300" /> : null}
          </button>
        ))}
      </div>

      <div className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Editor</div>
      <label className="mb-1 block text-xs text-slate-400">Font size</label>
      <div className="mb-4 flex items-center gap-2">
        <input type="range" min={10} max={24} value={prefs.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} className="accent-brand-500" />
        <span className="w-8 text-right tabular-nums">{prefs.fontSize}</span>
      </div>

      <label className="mb-1 block text-xs text-slate-400">Font family</label>
      <select value={prefs.fontFamily} onChange={(e) => update({ fontFamily: e.target.value })} className="mb-4 w-full rounded border border-white/10 bg-black/20 px-2 py-1">
        {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>

      <label className="mb-1 block text-xs text-slate-400">Tab size</label>
      <input type="number" min={2} max={8} value={prefs.tabSize} onChange={(e) => update({ tabSize: Number(e.target.value) })} className="mb-4 w-20 rounded border border-white/10 bg-black/20 px-2 py-1" />

      <Toggle label="Word wrap" value={prefs.wordWrap} onChange={(v) => update({ wordWrap: v })} />
      <Toggle label="Minimap" value={prefs.minimap} onChange={(v) => update({ minimap: v })} />
      <Toggle label="Line numbers" value={prefs.lineNumbers} onChange={(v) => update({ lineNumbers: v })} />
      <Toggle label="Font ligatures" value={prefs.ligatures} onChange={(v) => update({ ligatures: v })} />

      <div className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Auto Save</div>
      <p className="mb-2 text-[11px] text-slate-500">
        Persists each edited file a short time after you stop typing. Turning this off never disables manual Save (Ctrl+S).
      </p>
      <Toggle
        label="Auto Save"
        value={prefs.autoSave}
        onChange={(v) => {
          update({ autoSave: v });
          // Leaving Auto Save must not strand a pending debounce that fires
          // after the user opted out.
          if (!v) cancelAllAutoSaves();
        }}
      />
      {prefs.autoSave ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="range"
            min={AUTO_SAVE_MIN}
            max={AUTO_SAVE_MAX}
            step={100}
            value={prefs.autoSaveDelay}
            onChange={(e) => update({ autoSaveDelay: Number(e.target.value) })}
            className="accent-brand-500"
          />
          <span className="w-16 text-right tabular-nums">{(prefs.autoSaveDelay / 1000).toFixed(1)}s</span>
        </div>
      ) : null}
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="mb-2 flex cursor-pointer items-center justify-between">
      <span className="text-[13px]">{label}</span>
      <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-brand-500" />
    </label>
  );
}

function Placeholder({ title, note }) {
  return (
    <div className="p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      <p className="text-[13px] text-slate-500">{note}</p>
    </div>
  );
}

export default function SidebarView({ actions }) {
  const activityView = useIdeStore((s) => s.activityView);
  const setBottomTab = useIdeStore((s) => s.setBottomTab);

  const content = useMemo(() => {
    switch (activityView) {
      case 'search':
        return <SearchView actions={actions} />;
      case 'settings':
        return <SettingsView actions={actions} />;
      case 'scm':
        return <Placeholder title="Source Control" note="Version control is a placeholder — no Git integration is wired up yet." />;
      case 'debug':
        return <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-slate-200">
          <div>
            <h2 className="text-sm font-semibold">Python Debugger</h2>
            <p className="mt-1 text-xs text-slate-500">Start a real Python debug session from the Debug Console.</p>
          </div>
          <button type="button" className="rounded bg-brand-600 px-3 py-2 text-left text-xs font-medium text-white hover:bg-brand-500" onClick={() => setBottomTab('debug')}>Start Debugging</button>
          <div className="rounded border border-white/10 bg-white/5 p-2 text-xs text-slate-400">
            <div className="font-medium text-slate-300">Session</div>
            <div className="mt-1">Open the Debug Console tab for runtime readiness, breakpoints, stack frames, variables and controls.</div>
          </div>
          <div className="rounded border border-white/10 bg-white/5 p-2 text-xs text-slate-500">
            <div className="font-medium text-slate-300">Breakpoints</div>
            <div className="mt-1">Breakpoints are managed from the Monaco gutter and synchronized with the active debug session.</div>
          </div>
        </div>;
      case 'extensions':
        return <ExtensionsPanel />;
      case 'languages':
        return <LanguageCatalogue actions={actions} />;
      case 'javaDeps':
        return <JavaDependenciesPanel actions={actions} />;
      case 'explorer':
      default:
        return <FileExplorer actions={actions} />;
    }
  }, [activityView, actions]);

  return <div className="flex h-full min-h-0 flex-col bg-ink-900/60 p-2 dark:bg-[#141821]">{content}</div>;
}
