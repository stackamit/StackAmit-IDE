import { useMemo, useState } from 'react';
import {
  Search, Puzzle, Wand2, Palette, ListChecks, Pin, AlignLeft, Droplet, Pilcrow,
  FileType, Download, Trash2, Check, RefreshCw,
} from 'lucide-react';
import { useIdeStore } from '../../store/ideStore.js';
import { EXTENSIONS, CATEGORIES, curatedAdapter, listCatalog, updatesAvailable } from '../../extensions/registry.js';

const ICONS = { Wand2, Palette, ListChecks, Pin, AlignLeft, Droplet, Pilcrow, FileType };

/**
 * VS Code-style Extensions view. Lists the curated first-party feature modules
 * and lets the user install/uninstall and enable/disable them; state lives in
 * the store (persisted) and is applied to Monaco by the extension runtime.
 */
export default function ExtensionsPanel() {
  const extensions = useIdeStore((s) => s.extensions);
  const installExtension = useIdeStore((s) => s.installExtension);
  const uninstallExtension = useIdeStore((s) => s.uninstallExtension);
  const setExtensionEnabled = useIdeStore((s) => s.setExtensionEnabled);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [updateMsg, setUpdateMsg] = useState(null);

  // Honest update check: compares each installed extension's captured
  // version against the active catalog. The bundled curated catalog can only
  // ever report "up to date" — a future registry adapter plugs in here.
  const checkUpdates = async () => {
    setUpdateMsg('Checking…');
    const { entries, errors } = await listCatalog([curatedAdapter]);
    const ups = updatesAvailable(entries, useIdeStore.getState().extensions);
    if (errors.length) setUpdateMsg(`Registry problems: ${errors.map((e) => `${e.adapter}: ${e.message}`).join('; ')}`);
    else setUpdateMsg(ups.length ? `${ups.length} update(s): ${ups.map((u) => `${u.id} ${u.from}→${u.to}`).join(', ')}` : 'All installed extensions are up to date (curated catalog v-bundled).');
  };

  const installedCount = EXTENSIONS.filter((e) => extensions[e.id]?.installed).length;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EXTENSIONS.filter((e) => {
      if (category !== 'All' && e.category !== category) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        e.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [query, category, extensions]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Puzzle size={14} /> Extensions
        <span className="ml-auto font-normal normal-case tracking-normal text-slate-500">
          {installedCount}/{EXTENSIONS.length} installed
        </span>
        <button
          type="button"
          onClick={checkUpdates}
          className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal text-slate-300 hover:bg-white/10"
          title="Compare installed versions against the active extension catalog"
        >
          <RefreshCw size={11} /> Updates
        </button>
      </div>

      {updateMsg ? <div className="mb-2 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300">{updateMsg}</div> : null}

      <div className="mb-2 flex gap-1">
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search extensions…"
            className="w-full rounded border border-white/10 bg-black/20 py-1 pl-7 pr-2 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/60"
          />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              category === c ? 'border-brand-500 bg-brand-600/20 text-slate-100' : 'border-white/10 text-slate-400 hover:bg-white/5'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="scroll-slim min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        {list.length === 0 ? (
          <div className="p-2 text-xs text-slate-500">No extensions match your search.</div>
        ) : null}

        {list.map((ext) => {
          const st = extensions[ext.id] || { installed: false, enabled: false };
          const Icon = ICONS[ext.icon] || Puzzle;
          return (
            <div key={ext.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand-600/15 text-brand-300">
                  <Icon size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-slate-100">{ext.name}</span>
                    {st.installed ? (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">Installed</span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {ext.publisher} · {ext.category} · v{ext.version} · {ext.license || 'license n/a'}
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-slate-400">{ext.description}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(ext.compatibility || []).map((c) => (
                      <span key={c} className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300" title={`Runs in ${c} mode`}>
                        {c}
                      </span>
                    ))}
                    {(ext.capabilities || []).map((cap) => (
                      <span key={cap} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                {!st.installed ? (
                  <button
                    type="button"
                    onClick={() => installExtension(ext.id)}
                    className="focus-ring inline-flex items-center gap-1.5 rounded bg-brand-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-brand-500"
                  >
                    <Download size={13} /> Install
                  </button>
                ) : (
                  <>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(st.enabled)}
                        onChange={(e) => setExtensionEnabled(ext.id, e.target.checked)}
                        className="h-3.5 w-3.5 accent-brand-500"
                      />
                      {st.enabled ? <Check size={13} className="text-emerald-300" /> : null}
                      Enabled
                    </label>
                    <button
                      type="button"
                      onClick={() => uninstallExtension(ext.id)}
                      className="focus-ring ml-auto inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[12px] text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
                    >
                      <Trash2 size={12} /> Uninstall
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        <p className="px-1 pt-1 text-[11px] leading-snug text-slate-600">
          These are built-in StackAmit feature modules, not a third-party VS Code marketplace — foreign
          extensions are incompatible with this editor. Installing one enables a real Monaco capability.
        </p>
      </div>
    </div>
  );
}
