import { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, Plus, RefreshCw, Search } from 'lucide-react';
import { catalogueEntries, describeCapabilities } from '../../languages/languageCapabilities.js';
import { isBrowserRunnable } from '../../utils/browserRun.js';
import { workspace } from '../../services/workspace.js';
import { useIdeStore } from '../../store/ideStore.js';

/**
 * Language catalogue — the honest "what does this build actually do for
 * language X" browser (Phase 9 of the language-support expansion).
 *
 * Every badge on this screen is derived from `languageCapabilities.js`, which
 * is pinned to the real integrations by tests:
 *   - "IntelliSense" only appears for languages with a bundled Monaco language
 *     service worker (TS/JS, JSON, CSS/SCSS/Less, HTML).
 *   - "Online" only appears for execution keys that were run against the live
 *     provider and returned real output.
 *   - "Local" is a *toolchain requirement*, not a claim: it names the command
 *     the desktop terminal/interactive runner would use and, where the curated
 *     runtime installer supports it, the exact winget package id.
 */

// Web mode has no local toolchain to detect and no compiler path to honour, so
// the “Runnable locally” / “Setup required” filters would advertise capability
// the browser can never deliver. They are desktop-only filters.
const FILTERS_DESKTOP = [
  { id: 'all', label: 'All languages' },
  { id: 'online', label: 'Runnable online' },
  { id: 'local', label: 'Runnable locally' },
  { id: 'lsp', label: 'Language server' },
  { id: 'preview', label: 'Web preview' },
  { id: 'setup', label: 'Setup required' },
];

const FILTERS_WEB = [
  { id: 'all', label: 'All languages' },
  { id: 'browser', label: 'Runs in this browser' },
  { id: 'online', label: 'Runnable online' },
  { id: 'lsp', label: 'Language server' },
  { id: 'preview', label: 'Web preview' },
];

function matchesFilter(cap, filter) {
  switch (filter) {
    case 'online':
      return Boolean(cap.run);
    case 'browser':
      return isBrowserRunnable(cap.monaco);
    case 'local':
      return Boolean(cap.local);
    case 'lsp':
      // Both tiers are listed honestly: wired servers this app can connect to
      // and known candidates it does not wire up yet.
      return Boolean(cap.lsp);
    case 'preview':
      return cap.preview === 'static';
    case 'setup':
      // Needs an external toolchain before it can run: no verified remote
      // runner, but a known local command (and sometimes an installable id).
      return Boolean(cap.local) && !cap.run;
    default:
      return true;
  }
}

function Badge({ tone = 'slate', title, children }) {
  const tones = {
    slate: 'border-white/10 bg-white/5 text-slate-300',
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    blue: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  };
  return (
    <span title={title} className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Row({ cap, actions, lspState }) {
  const [open, setOpen] = useState(false);
  const [recheck, setRecheck] = useState(null); // 'checking' | message | null
  const desktop = workspace.mode === 'desktop';
  const sampleFile = cap.extensions[0] ? `main.${cap.extensions[0]}` : cap.filenames?.[0] || null;
  const full = cap.intellisense === 'language-service';
  const lspReady = lspState === 'ready';
  const setLspToolPath = useIdeStore((s) => s.setLspToolPath);
  const setLspJdkPath = useIdeStore((s) => s.setLspJdkPath);
  const setCompilerPath = useIdeStore((s) => s.setCompilerPath);
  const configuredPath = useIdeStore((s) => s.lspToolPaths[cap.monaco]);
  const configuredJdk = useIdeStore((s) => s.lspJdkPaths[cap.monaco]);
  const configuredCompiler = useIdeStore((s) => s.compilerPaths[cap.monaco]);
  // What *this machine* answered when the app looked for the offline runtime —
  // undefined means it has not been looked up (web build / detection pending).
  const runtime = useIdeStore((s) => (cap.localRun ? s.localRuntimes?.[cap.localRun] : null));

  const recheckRuntime = async () => {
    if (!actions?.refreshLocalRuntimes) return;
    setRecheck('checking');
    try {
      const res = await actions.refreshLocalRuntimes();
      const rt = res?.runtimes?.[cap.localRun];
      setRecheck(rt ? (rt.available ? `Found ${rt.cmd}${rt.version ? ` — ${rt.version}` : ''}` : rt.installHint) : 'Detection is only available in the desktop app.');
    } catch (err) {
      setRecheck(`Could not re-check: ${err?.message || err}`);
    }
  };

  return (
    <li className="border-b border-white/5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5"
      >
        <ChevronDown size={13} className={`shrink-0 text-slate-500 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="min-w-0 flex-1 truncate text-[13px] text-slate-100">{cap.label}</span>
        {full ? <Badge tone="green" title="Real language service worker: completion, hover, diagnostics, formatting">IntelliSense</Badge> : null}
        {cap.lsp?.wired ? (
          lspReady ? (
            <Badge tone="green" title={`${cap.lsp.server} language server connected — live IntelliSense in the desktop app`}>LS live</Badge>
          ) : lspState === 'missing-tool' ? (
            <Badge tone="amber" title={`Wired up, but ${cap.lsp.tool} was not found/usable on this machine`}>{cap.lsp.server} missing</Badge>
          ) : (
            <Badge tone="blue" title={`Desktop app connects to ${cap.lsp.server} when the tool is installed`}>{cap.lsp.server}</Badge>
          )
        ) : null}
        {cap.run ? <Badge tone="blue" title="Executed successfully against the live provider (2026-10-21)">Online</Badge> : null}
        {isBrowserRunnable(cap.monaco) ? <Badge tone="green" title="Web mode runs this in the page's own JavaScript engine — no server, and not Node.js">Browser</Badge> : null}
        {cap.local ? <Badge tone="amber" title={desktop ? `Local toolchain: ${cap.local.cmd}${cap.local.note ? ` — ${cap.local.note}` : ''}` : `${cap.local.cmd} is a desktop-app toolchain — a browser cannot run it`}>{cap.local.cmd}{desktop ? '' : ' · desktop'}</Badge> : null}
        {cap.localRun && runtime?.available ? (
          <Badge
            tone="green"
            title={`Runs offline in this app with ${runtime.cmd}${runtime.path ? ` (${runtime.path})` : ''}`}
          >
            Offline
          </Badge>
        ) : null}
        {cap.preview === 'static' ? <Badge title={desktop ? 'Participates in Go Live preview' : 'Participates in the in-browser preview'}>Preview</Badge> : null}
      </button>

      {open ? (
        <div className="px-2 pb-2 pt-1 text-[12px] text-slate-400">
          <p className="mb-1.5 text-slate-300">{describeCapabilities(cap, lspState, desktop ? 'desktop' : 'web')}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-slate-500">Files</dt>
            <dd className="font-mono text-slate-300">
              {cap.extensions.map((e) => `.${e}`).join(' ') || (cap.filenames || []).join(' ') || '—'}
            </dd>
            <dt className="text-slate-500">Grammar</dt>
            <dd>
              {cap.grammar === 'service' ? 'Monaco language service' : cap.grammar === 'bundled' ? 'Bundled with monaco-editor' : cap.grammar === 'monarch' ? 'Custom Monarch grammar (this app)' : 'None (plain text)'}
              {cap.variantOf ? ` — editor mode of ${cap.variantOf}` : ''}
            </dd>
            {cap.formatter ? (
              <>
                <dt className="text-slate-500">Formatter</dt>
                <dd>{cap.formatter === 'prettier' ? 'Prettier (curated extension)' : 'Language service'}</dd>
              </>
            ) : null}
            {cap.linter ? (
              <>
                <dt className="text-slate-500">Diagnostics</dt>
                <dd>{cap.linter === 'server' ? 'Backend syntax checks (local compiler/interpreter)' : 'Language service diagnostics'}</dd>
              </>
            ) : null}
            {cap.run ? (
              <>
                <dt className="text-slate-500">Online run</dt>
                <dd>
                  Supported — key <span className="font-mono text-slate-300">{cap.run}</span>, live-verified 2026-10-21
                  {!desktop ? (
                    <div className="mt-1 text-[11px] text-slate-500">
                      Needs a reachable API server (see the status-bar chip). Without one, Run reports the missing
                      backend instead of silently sending your code somewhere else.
                    </div>
                  ) : null}
                </dd>
              </>
            ) : null}
            {cap.local ? (
              <>
                <dt className="text-slate-500">{desktop ? 'Local run' : 'Local run (desktop only)'}</dt>
                <dd>
                  <span className="font-mono text-slate-300">{cap.local.cmd}</span>
                  {cap.local.note ? ` — ${cap.local.note}` : ''}
                  {!desktop ? <span className="text-[11px] text-slate-500"> — a browser page cannot spawn this command</span> : null}
                  {cap.local.install ? (
                    <div className="mt-1 font-mono text-[11px] text-slate-300">winget install -e --id {cap.local.install}</div>
                  ) : null}
                </dd>
              </>
            ) : null}
            {cap.localRun ? (
              <>
                <dt className="text-slate-500">Offline run</dt>
                <dd>
                  {!desktop ? (
                    <>
                      Runs offline in the desktop app only — a browser has no interpreter or compiler for it.
                      {cap.local?.cmd ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          Web mode options: edit here and run in the desktop app, or use the online runner when the
                          API server is reachable.
                        </div>
                      ) : null}
                    </>
                  ) : runtime?.available ? (
                    <>
                      Ready on this machine — <span className="font-mono text-slate-300">{runtime.cmd}</span>
                      {runtime.version ? ` · ${runtime.version}` : ''}
                      {runtime.path ? <div className="mt-1 break-all font-mono text-[11px] text-slate-400">{runtime.path}</div> : null}
                      {runtime.compiler?.source ? (
                        <div className="mt-1 text-[11px] text-slate-500">Found via {runtime.compiler.source} — it was run to read this version, not guessed from the file name.</div>
                      ) : null}
                    </>
                  ) : runtime ? (
                    <>
                      Not usable here — Run will say so instead of pretending.
                      <div className="mt-1 text-[11px] text-slate-500">{runtime.installHint}</div>
                    </>
                  ) : (
                    'Not looked up yet — the desktop app searches for it when it starts.'
                  )}
                  {desktop && cap.compiler ? (
                    <label className="mt-1.5 block text-[11px] text-slate-500">
                      Custom compiler path (optional; {cap.compiler.tool} — exe or its folder, used after PATH and the usual install folders)
                      <input
                        value={configuredCompiler || ''}
                        onChange={(e) => setCompilerPath(cap.monaco, e.target.value.trim() || null)}
                        placeholder={cap.compiler.placeholder}
                        spellCheck={false}
                        className="mt-1 w-full rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
                      />
                      {cap.compiler.note ? <div className="mt-1 normal-case text-[11px] text-slate-500">{cap.compiler.note}</div> : null}
                    </label>
                  ) : null}
                  {desktop && actions?.refreshLocalRuntimes ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={recheckRuntime}
                        disabled={recheck === 'checking'}
                        className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-white/10 disabled:opacity-60"
                      >
                        <RefreshCw size={11} /> {recheck === 'checking' ? 'Checking…' : 'Re-check this machine'}
                      </button>
                      {recheck && recheck !== 'checking' ? (
                        <span className="min-w-0 break-all text-[11px] text-slate-400">{recheck}</span>
                      ) : null}
                    </div>
                  ) : null}
                </dd>
              </>
            ) : null}
            {cap.lsp ? (
              <>
                <dt className="text-slate-500">Language server</dt>
                <dd>
                  {cap.lsp?.wired ? (
                    <>
                      <span className="font-mono text-slate-300">{cap.lsp.tool}</span> — wired in the desktop app
                      {!desktop ? <span className="text-[11px] text-slate-500"> (a browser page cannot spawn a language-server process; editing here uses the bundled services)</span> : null}
                      {desktop && lspState === 'ready' ? ' (connected now)' : desktop && lspState === 'missing-tool' ? ' (tool missing here)' : desktop ? ' (not connected now)' : null}
                      {cap.lsp.prerequisite ? <div className="mt-1 text-[11px]">Prerequisite: {cap.lsp.prerequisite}</div> : null}
                      {cap.lsp.jdk?.note ? <div className="mt-1 text-[11px] text-slate-400">{cap.lsp.jdk.note}</div> : null}
                      {cap.lsp.install?.npm ? (
                        <div className="mt-1 font-mono text-[11px] text-slate-300">npm install -g {cap.lsp.install.npm}</div>
                      ) : null}
                      {cap.lsp.install?.winget ? (
                        <div className="mt-1 font-mono text-[11px] text-slate-300">winget install -e --id {cap.lsp.install.winget}</div>
                      ) : null}
                      {cap.lsp.install?.note ? <div className="mt-1 text-[11px]">{cap.lsp.install.note}</div> : null}
                      {cap.lsp.rootMarkers.length ? (
                        <div className="mt-1 text-[11px] text-slate-500">Project markers: {cap.lsp.rootMarkers.join(', ')}</div>
                      ) : null}
                      <div className="mt-1 text-[11px] text-slate-500">Never bundled or downloaded — the app only spawns a tool you installed.</div>
                      {desktop ? (
                        <>
                          <label className="mt-1.5 block text-[11px] text-slate-500">
                            Custom tool path (optional; absolute, used before PATH)
                            <input
                              value={configuredPath || ''}
                              onChange={(e) => setLspToolPath(cap.monaco, e.target.value.trim() || null)}
                              placeholder={`C:\\path\\to\\${cap.lsp.tool}.exe`}
                              spellCheck={false}
                              className="mt-1 w-full rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
                            />
                          </label>
                          {cap.lsp.jdk ? (
                            <label className="mt-1.5 block text-[11px] text-slate-500">
                              Custom JDK path (optional; the folder with bin/javac — required for imports to resolve)
                              <input
                                value={configuredJdk || ''}
                                onChange={(e) => setLspJdkPath(cap.monaco, e.target.value.trim() || null)}
                                placeholder="C:\\Program Files\\Microsoft\\jdk-21"
                                spellCheck={false}
                                className="mt-1 w-full rounded border border-white/10 bg-black/20 px-1.5 py-0.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
                              />
                            </label>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>Not wired up — candidate: {cap.lsp.server} (<span className="font-mono text-slate-300">{cap.lsp.tool}</span>)</>
                  )}
                </dd>
              </>
            ) : null}
            {cap.runtimeNote ? (
              <>
                <dt className="text-slate-500">Note</dt>
                <dd>{cap.runtimeNote}</dd>
              </>
            ) : null}
          </dl>
          {sampleFile ? (
            <button
              type="button"
              onClick={() => actions.createFile(undefined, sampleFile)}
              className="focus-ring mt-2 inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[12px] text-slate-200 hover:bg-white/10"
            >
              <Plus size={12} /> New {sampleFile}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Sidebar view: browse every registered language and its real capabilities. */
export default function LanguageCatalogue({ actions }) {
  const desktop = workspace.mode === 'desktop';
  const filters = desktop ? FILTERS_DESKTOP : FILTERS_WEB;
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const lsp = useIdeStore((s) => s.lsp);
  const root = useIdeStore((s) => s.root);
  // Live bridge state for this machine/right now, per language id.
  const lspStateFor = (cap) => (cap.lsp?.wired ? lsp[`${cap.monaco}|${root || ''}`] : undefined);

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogueEntries()
      .filter((cap) => matchesFilter(cap, filter))
      .filter((cap) =>
        !q ||
        cap.label.toLowerCase().includes(q) ||
        cap.monaco.includes(q) ||
        cap.extensions.some((e) => e.includes(q)) ||
        (cap.filenames || []).some((f) => f.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filter, query]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        <BookOpen size={14} /> Languages
        <span className="ml-auto font-normal normal-case text-slate-500">{entries.length} shown</span>
      </div>

      <div className="mb-2 flex items-center gap-1 rounded border border-white/10 bg-black/20 px-2">
        <Search size={13} className="text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, extension…"
          aria-label="Filter languages"
          className="min-w-0 flex-1 bg-transparent py-1 text-[13px] text-slate-100 placeholder:text-slate-600 focus:outline-none"
        />
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`focus-ring rounded border px-1.5 py-0.5 text-[11px] ${
              filter === f.id ? 'border-brand-500 bg-brand-600/25 text-white' : 'border-white/10 text-slate-400 hover:bg-white/5'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ul className="scroll-slim min-h-0 flex-1 overflow-auto">
        {entries.map((cap) => (
          <Row key={cap.id} cap={cap} actions={actions} lspState={lspStateFor(cap)} />
        ))}
        {!entries.length ? <li className="p-2 text-[12px] text-slate-500">No language matches this filter.</li> : null}
      </ul>

      <p className="mt-2 border-t border-white/5 pt-2 text-[11px] leading-relaxed text-slate-500">
        Highlighting ≠ execution. “Online” means a real run succeeded on the configured provider; “Local” names a toolchain
        {desktop
          ? ' this app can detect or install with your consent — it is not verified until you run it.'
          : ' that only the desktop app can detect or use. In the browser, Run means the in-page JavaScript engine or the online runner — nothing else.'}
      </p>
    </div>
  );
}
