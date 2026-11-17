import { useEffect, useMemo, useState } from 'react';
import {
  Package, Search, Plus, X, Trash2, Download, RefreshCw, AlertTriangle,
  Check, Loader2, WifiOff, Lightbulb, ExternalLink,
} from 'lucide-react';
import { listCatalog, CATEGORIES } from '../../data/javaLibraryCatalog.js';
import { useDependencyStore } from '../../store/dependencyStore.js';
import { useIdeStore } from '../../store/ideStore.js';
import { workspace } from '../../services/workspace.js';

/**
 * Java Dependencies — the Desktop Mode library manager (Phase 6 of the Java
 * dependency support).
 *
 * Design commitments the code below keeps honest:
 *  - Nothing downloads while you type. A resolve only happens on an explicit
 *    "Resolve" action (or an explicit Run of a project that has added deps).
 *  - A suggestion is only a hint. It is produced by import detection and must be
 *    explicitly Added; it is never auto-selected.
 *  - Web Mode is told the truth: the configured provider cannot add Maven
 *    artifacts, so the panel explains the desktop-only path instead of offering
 *    a button that would fail.
 *  - Every badge (verified / pending / offline / cached) reflects real state
 *    already recorded by the catalog verifier and the resolver — not a claim.
 */

// Per-project key must match useIdeActions.javaProjectKey exactly, or the panel
// would read one slice while the run path wrote another.
function useProjectKey() {
  const root = useIdeStore((s) => s.root);
  const activePath = useIdeStore((s) => s.activePath);
  return root || activePath || '__no-project__';
}

function Badge({ tone = 'slate', title, children }) {
  const tones = {
    slate: 'border-white/10 bg-white/5 text-slate-300',
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    blue: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  };
  return (
    <span title={title} className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

/** A single catalog row in the browse list: search result or category listing. */
function CatalogRow({ entry, added, onAdd }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-white/5">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="focus-ring min-w-0 flex-1 text-left"
        >
          <div className="truncate text-[13px] text-slate-100">{entry.name}</div>
          <div className="truncate font-mono text-[11px] text-slate-500">{entry.coordinate}</div>
        </button>
        {entry.verificationStatus === 'verified' ? (
          <Badge tone="green" title={`Verified against Maven Central at ${entry.verifiedAt}`}>verified</Badge>
        ) : (
          <Badge tone="amber" title="Coordinate not confirmed online — may need a manual version">pending</Badge>
        )}
        {added ? (
          <Badge tone="blue" title="Already added to this project">added</Badge>
        ) : (
          <button
            type="button"
            onClick={() => onAdd(entry.id)}
            title={`Add ${entry.name} to this project`}
            aria-label={`Add ${entry.name}`}
            className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 hover:bg-white/10"
          >
            <Plus size={12} />
          </button>
        )}
      </div>
      {open ? (
        <div className="px-2 pb-2 text-[12px] text-slate-400">
          {entry.description ? <p className="mb-1 text-slate-300">{entry.description}</p> : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-slate-500">Category</dt>
            <dd>{entry.category}</dd>
            <dt className="text-slate-500">Coordinate</dt>
            <dd className="font-mono text-slate-300">{entry.coordinate}</dd>
            <dt className="text-slate-500">License</dt>
            <dd>{entry.license}{entry.spdx && entry.spdx !== entry.license ? ` (${entry.spdx})` : ''}</dd>
            <dt className="text-slate-500">Java</dt>
            <dd>{entry.javaVersions}</dd>
            {entry.packages?.length ? (
              <>
                <dt className="text-slate-500">Packages</dt>
                <dd className="font-mono text-slate-300">{entry.packages.join(', ')}</dd>
              </>
            ) : null}
          </dl>
          <a
            href={entry.source}
            target="_blank"
            rel="noreferrer noopener"
            className="focus-ring mt-1.5 inline-flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
          >
            <ExternalLink size={11} /> View on Maven Central
          </a>
        </div>
      ) : null}
    </li>
  );
}

export default function JavaDependenciesPanel({ actions }) {
  const desktop = workspace.mode === 'desktop';
  const projectKey = useProjectKey();
  const activePath = useIdeStore((s) => s.activePath);
  const javaFileCount = useIdeStore((s) => Object.keys(s.docs || {}).filter((p) => /\.java$/i.test(p)).length);
  const slice = useDependencyStore((s) => s.byProject[projectKey]);
  const addDependency = useDependencyStore((s) => s.addDependency);
  const removeDependency = useDependencyStore((s) => s.removeDependency);
  const dismissSuggestion = useDependencyStore((s) => s.dismissSuggestion);
  const clearStatus = useDependencyStore((s) => s.clearStatus);

  const project = slice || { added: [], suggestions: [], detection: null, status: 'idle', progress: null, result: null, error: null, fromCacheOnly: false };
  const addedCoords = new Set(project.added.map((a) => a.coordinate));

  const [tab, setTab] = useState('browse'); // browse | added | suggestions
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  // On open (and when the set of open Java files or the active file changes),
  // refresh import detection so the suggestions reflect the code that is
  // actually open — no downloads implied.
  useEffect(() => {
    if (!desktop) return;
    actions?.detectJavaProjectImports?.();
  }, [desktop, actions, activePath, javaFileCount]);

  const suggestTabCount = project.suggestions.length + (project.detection?.unknown?.length || 0);

  const catalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listCatalog()
      .filter((e) => category === 'All' || e.category === category)
      .filter(
        (e) =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.coordinate.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q) ||
          e.packages.some((p) => p.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query, category]);

  const doResolve = () => actions?.resolveJavaProject?.(projectKey);

  const statusBadge = () => {
    if (project.status === 'resolving') return <Badge tone="amber" title={project.progress?.message || 'Resolving…'}>resolving</Badge>;
    if (project.status === 'error') return <Badge tone="rose" title={project.error || 'Dependency error'}>error</Badge>;
    if (project.status === 'ready') return <Badge tone="green" title="All added dependencies resolved to JARs">ready</Badge>;
    return null;
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-2 pb-2">
      <div className="flex items-center gap-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <Package size={14} /> Java Dependencies
        <span className="ml-auto flex items-center gap-1">
          {statusBadge()}
          {project.fromCacheOnly && project.status === 'ready' ? <Badge tone="blue" title="Resolved entirely from the local ~/.m2 cache — no network used">cached</Badge> : null}
        </span>
      </div>

      {/* Mode banner: honest about what this environment can do. */}
      {!desktop ? (
        <div className="mb-2 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Web Mode cannot add Maven dependencies — the online runner compiles with the JDK standard library only.
            Open this project in <strong>Desktop Mode</strong> to resolve libraries into <span className="font-mono">~/.m2</span> and place them on the classpath.
          </span>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="mb-2 flex gap-1 text-[11px]">
        {[
          { id: 'browse', label: 'Browse', count: null },
          { id: 'added', label: 'Added', count: project.added.length },
          { id: 'suggestions', label: 'Detected', count: suggestTabCount },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`focus-ring flex items-center gap-1 rounded border px-2 py-1 ${
              tab === t.id ? 'border-brand-500 bg-brand-600/25 text-white' : 'border-white/10 text-slate-400 hover:bg-white/5'
            }`}
          >
            {t.label}
            {t.count ? <span className="rounded bg-white/10 px-1 text-[10px]">{t.count}</span> : null}
          </button>
        ))}
      </div>

      {/* Browse: searchable, category-filtered catalog */}
      {tab === 'browse' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-1.5 flex items-center gap-1 rounded border border-white/10 bg-black/20 px-2">
            <Search size={13} className="text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 100 libraries…"
              aria-label="Search Java libraries"
              className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
            />
          </div>
          <div className="mb-1.5 flex items-center gap-1">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
              className="min-w-0 flex-1 rounded border border-white/10 bg-black/20 px-1.5 py-1 text-[12px] text-slate-200 focus:border-brand-500 focus:outline-none"
            >
              <option value="All">All categories ({CATEGORIES.length})</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <span className="shrink-0 text-[11px] text-slate-500">{catalog.length} shown</span>
          </div>
          <ul className="scroll-slim min-h-0 flex-1 overflow-auto">
            {catalog.map((e) => (
              <CatalogRow key={e.id} entry={e} added={addedCoords.has(e.coordinate)} onAdd={(id) => addDependency(projectKey, id)} />
            ))}
            {!catalog.length ? <li className="p-2 text-[12px] text-slate-500">No library matches this filter.</li> : null}
          </ul>
        </div>
      ) : null}

      {/* Added: managed list with per-item resolve/remove */}
      {tab === 'added' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ul className="scroll-slim min-h-0 flex-1 overflow-auto">
            {project.added.map((a) => (
              <li key={a.coordinate} className="flex items-center gap-2 border-b border-white/5 px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-slate-100">{a.id || 'manual'}</span>
                  <span className="block truncate font-mono text-[11px] text-slate-500">{a.coordinate}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeDependency(projectKey, a.coordinate)}
                  title="Remove from this project"
                  aria-label={`Remove ${a.coordinate}`}
                  className="focus-ring rounded border border-white/10 bg-white/5 p-1 text-slate-400 hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
            {!project.added.length ? (
              <li className="p-3 text-[12px] text-slate-500">
                No dependencies added yet. Browse the catalog or accept a detected suggestion, then Resolve.
              </li>
            ) : null}
          </ul>

          {project.error ? (
            <div className="mt-1 rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300">
              <div className="flex items-start gap-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1 break-words">{project.error}</span>
                <button type="button" onClick={() => clearStatus(projectKey)} title="Dismiss" aria-label="Dismiss error" className="text-rose-300 hover:text-rose-200">
                  <X size={13} />
                </button>
              </div>
            </div>
          ) : null}

          {project.added.length ? (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={doResolve}
                disabled={!desktop || project.status === 'resolving'}
                title={desktop ? 'Resolve and download to ~/.m2' : 'Desktop Mode only'}
                className="focus-ring inline-flex items-center gap-1.5 rounded bg-brand-600 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {project.status === 'resolving' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {project.status === 'resolving' ? 'Resolving…' : 'Resolve'}
              </button>
              {project.status === 'resolving' && project.progress ? (
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
                  {project.progress.message}
                  {project.progress.total ? ` (${project.progress.completed || 0}/${project.progress.total})` : ''}
                </span>
              ) : project.status === 'ready' ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                  <Check size={12} /> {project.result?.resolved?.length || project.added.length} resolved
                </span>
              ) : null}
              {desktop ? (
                <button
                  type="button"
                  onClick={() => actions?.clearJavaProjectCache?.(project.added.map((a) => a.coordinate))}
                  title="Remove these JARs from the local ~/.m2 cache"
                  className="focus-ring ml-auto inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/5"
                >
                  <RefreshCw size={12} /> Clear cache
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Suggestions: detected imports the user can add or dismiss */}
      {tab === 'suggestions' ? (
        <div className="scroll-slim min-h-0 flex-1 overflow-auto">
          {project.suggestions.length ? (
            <div className="mb-2">
              <div className="flex items-center gap-1 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <Lightbulb size={12} /> In the catalog
              </div>
              {project.suggestions.map((s) => (
                <div key={`${s.fqn}-${s.coordinate}`} className="flex items-center gap-2 border-b border-white/5 px-2 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] text-slate-200">{s.fqn}</span>
                    <span className="block truncate font-mono text-[11px] text-slate-500">{s.coordinate}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => addDependency(projectKey, s.id)}
                    title={`Add ${s.coordinate}`}
                    aria-label={`Add ${s.coordinate}`}
                    className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[11px] text-slate-200 hover:bg-white/10"
                  >
                    <Plus size={12} /> Add
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissSuggestion(projectKey, s.fqn)}
                    title="Don't suggest this import"
                    aria-label="Dismiss suggestion"
                    className="focus-ring rounded p-1 text-slate-500 hover:text-slate-300"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {project.detection?.unknown?.length ? (
            <div className="mb-2">
              <div className="flex items-center gap-1 px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <AlertTriangle size={12} /> Not in the catalog
              </div>
              {project.detection.unknown.map((fqn) => (
                <div key={fqn} className="border-b border-white/5 px-2 py-1.5">
                  <span className="block truncate font-mono text-[12px] text-slate-300">{fqn}</span>
                  <span className="block text-[11px] text-slate-500">
                    No catalog match. If it ships a JAR you manage yourself, add its <span className="font-mono">group:artifact:version</span> below.
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <ManualAdd desktop={desktop} onAdd={(coord) => addDependency(projectKey, coord)} />

          {!project.suggestions.length && !project.detection?.unknown?.length ? (
            <p className="p-3 text-[12px] text-slate-500">
              No external imports detected in your open Java files{project.detection ? ` (${project.detection.catalogCount || 0} catalog match(es))` : ''}.
              Open a <span className="font-mono">.java</span> file that imports a library, or browse the catalog to add one directly.
            </p>
          ) : null}

          {!desktop ? (
            <p className="mt-1 flex items-start gap-1.5 px-2 text-[11px] text-slate-500">
              <WifiOff size={12} className="mt-0.5 shrink-0" />
              Detection runs here, but resolving/downloads happen only in the desktop app.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2 border-t border-white/5 pt-2 text-[11px] leading-relaxed text-slate-500">
        {desktop
          ? 'Added → Resolve downloads the JARs (and their transitive compile/runtime dependencies) from Maven Central into ~/.m2 and places them on the compile and run classpath. Nothing is downloaded until you Resolve.'
          : 'Java in Web Mode uses the JDK standard library only; external libraries need Desktop Mode.'}
      </p>
    </div>
  );
}

/** Manual coordinate entry for artifacts outside the curated catalog. */
function ManualAdd({ desktop, onAdd }) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const looksValid = /^[A-Za-z0-9._\-]+:[A-Za-z0-9._\-]+:[A-Za-z0-9._\-]+$/.test(trimmed);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (looksValid) {
          onAdd(trimmed);
          setValue('');
        }
      }}
      className="mb-2 flex items-center gap-1 px-2 py-1.5"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="group:artifact:version"
        aria-label="Manual Maven coordinate"
        spellCheck={false}
        className="min-w-0 flex-1 rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[12px] text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={!desktop || !looksValid}
        title={desktop ? 'Add this coordinate' : 'Desktop Mode only'}
        className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={12} /> Add
      </button>
    </form>
  );
}
