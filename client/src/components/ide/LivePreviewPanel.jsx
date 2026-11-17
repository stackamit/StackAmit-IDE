import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play, Square, RotateCw, ExternalLink, Monitor, Smartphone, Tablet, Globe,
  Loader2, AlertTriangle, X,
} from 'lucide-react';
import { useIdeStore } from '../../store/ideStore.js';
import * as preview from '../../services/preview.js';
import { isPreviewMessage } from '../../utils/webPreview.js';

const PRESETS = [
  { id: 'auto', label: 'Responsive', width: null, Icon: Monitor },
  { id: 'tablet', label: 'Tablet 768px', width: 768, Icon: Tablet },
  { id: 'mobile', label: 'Mobile 375px', width: 375, Icon: Smartphone },
];

const btn =
  'focus-ring inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition disabled:opacity-40';

/**
 * Live Preview panel.
 * Desktop: real 127.0.0.1 static server (started/stopped through validated
 * IPC) or the project's own package.json dev server. Web: an in-browser
 * render built from the virtual workspace — labeled as such, never claiming
 * a server that a browser cannot run.
 */
export default function LivePreviewPanel() {
  const pv = useIdeStore((s) => s.preview);
  const root = useIdeStore((s) => s.root);
  const activePath = useIdeStore((s) => s.activePath);
  const setPreview = useIdeStore((s) => s.setPreview);
  const togglePreviewPanel = useIdeStore((s) => s.togglePreviewPanel);
  const desktop = preview.isDesktopPreview();

  const [preset, setPreset] = useState('auto');
  const [consoleMsgs, setConsoleMsgs] = useState([]);
  const [webResult, setWebResult] = useState(null); // { doc, unsupported, entry, message }
  const iframeRef = useRef(null);

  // Real console errors / load failures forwarded from the sandboxed iframe.
  // Only accepted from the preview frame we created (see isPreviewMessage).
  useEffect(() => {
    const onMsg = (e) => {
      if (!isPreviewMessage(e, iframeRef.current?.contentWindow)) return;
      setConsoleMsgs((m) => [...m.slice(-49), { type: e.data.type, text: e.data.text }]);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => setConsoleMsgs([]), [pv.epoch, pv.url, pv.devUrl]);

  // Web mode: rebuild the self-contained document on open / save / entry change.
  useEffect(() => {
    if (desktop || !pv.visible) return;
    let cancelled = false;
    preview.buildWebPreview().then((res) => {
      if (!cancelled) setWebResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [desktop, pv.visible, pv.epoch, pv.entry, activePath, root]);

  // Desktop dev mode: if the server was already starting when the panel
  // remounted, the polling loop in the service keeps running; nothing to do.

  const currentUrl = pv.mode === 'dev'
    ? pv.devUrl
    : preview.previewEntryUrl(pv.url, root, activePath);
  const running = desktop && (pv.mode === 'dev' ? pv.devState === 'running' : pv.state === 'running');
  const starting = desktop && (pv.mode === 'dev' ? pv.devState === 'starting' : pv.state === 'starting');

  const srcFor = useCallback(
    (base) => (base ? `${base}${base.includes('?') ? '&' : '?'}stackamitReload=${pv.epoch}` : null),
    [pv.epoch],
  );
  const iframeSrc = srcFor(currentUrl);

  const onStartStop = () => {
    if (!desktop) return togglePreviewPanel();
    return running || starting ? preview.stopEverything() : preview.toggleGoLive();
  };

  const pw = PRESETS.find((p) => p.id === preset)?.width ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-white/10 bg-slate-950">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/10 px-2 py-1.5">
        {desktop ? (
          <button type="button" onClick={onStartStop} className={`${btn} ${running ? 'bg-rose-600/80 text-white hover:bg-rose-500' : 'bg-emerald-600/80 text-white hover:bg-emerald-500'}`}>
            {running || starting ? <><Square size={12} /> Stop</> : <><Play size={12} /> Go Live</>}
          </button>
        ) : (
          <>
            {/* Nothing is "live" in the browser: the document is rebuilt from the
                saved workspace files on demand, so that is what the button says. */}
            <button
              type="button"
              onClick={() => setPreview({ epoch: (pv.epoch || 0) + 1 })}
              className={`${btn} bg-emerald-600/80 text-white hover:bg-emerald-500`}
              title="Rebuild the preview from the saved workspace files (unsaved edits are not included)"
            >
              <RotateCw size={12} /> Preview saved files
            </button>
            <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Globe size={12} /> in-browser (a page cannot start a local server)
            </span>
          </>
        )}
        {desktop ? (
          <>
            <button type="button" onClick={preview.restartStatic} disabled={pv.mode !== 'static' || !running} className={`${btn} bg-white/5 text-slate-300 hover:bg-white/10`} title="Restart the static server">
              <RotateCw size={12} /> Restart
            </button>
            <label className="ml-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
              Port
              <input
                type="number"
                min={0}
                max={65535}
                value={pv.port}
                onChange={(e) => setPreview({ port: Number(e.target.value) || 0 })}
                disabled={pv.state === 'running'}
                className="w-16 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[11px] text-slate-200 disabled:opacity-50"
                title="0 picks a free port automatically"
              />
            </label>
            <select
              value={pv.mode}
              onChange={(e) => setPreview({ mode: e.target.value })}
              className="rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[11px] text-slate-300"
              title="Static serves files directly; Dev runs a package.json script (Vite etc.)"
            >
              <option value="static">Static</option>
              <option value="dev">Dev script</option>
            </select>
            {pv.mode === 'dev' ? (
              <>
                <select
                  value={pv.script || ''}
                  onChange={(e) => setPreview({ script: e.target.value })}
                  onFocus={preview.loadScripts}
                  className="max-w-28 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[11px] text-slate-300"
                >
                  {pv.scripts.length === 0 ? <option value="">(no scripts found)</option> : null}
                  {pv.scripts.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => (pv.devState === 'running' || pv.devState === 'starting' ? preview.stopDev() : preview.startDev())}
                  className={`${btn} bg-white/5 text-slate-300 hover:bg-white/10`}
                >
                  {pv.devState === 'running' || pv.devState === 'starting' ? <><Square size={12} /> Stop server</> : <><Play size={12} /> Start server</>}
                </button>
              </>
            ) : null}
            <button type="button" onClick={preview.reload} disabled={!running} className={`${btn} bg-white/5 text-slate-300 hover:bg-white/10`} title="Reload preview (re-reads saved files)">
              Reload
            </button>
            <button type="button" onClick={() => preview.openExternal(currentUrl)} disabled={!running} className={`${btn} bg-white/5 text-slate-300 hover:bg-white/10`} title="Open in your real browser">
              <ExternalLink size={12} />
            </button>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`${btn} ${preset === p.id ? 'bg-brand-600/40 text-white' : 'text-slate-400 hover:bg-white/10'}`}
              title={p.label}
            >
              <p.Icon size={12} />
            </button>
          ))}
          <button type="button" onClick={togglePreviewPanel} className={`${btn} text-slate-400 hover:bg-white/10`} title="Close preview">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* URL / status line */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-2 py-1 text-[11px]">
        {desktop ? (
          <>
            {starting || running ? <Loader2 size={12} className={running ? 'hidden' : 'animate-spin text-amber-300'} /> : null}
            <span className="truncate font-mono text-slate-300">
              {currentUrl || (pv.mode === 'dev' && pv.devState === 'starting' ? 'waiting for the dev server to print its URL…' : 'server stopped')}
            </span>
          </>
        ) : (
          <span className="truncate font-mono text-slate-400">
            entry: {webResult?.ok ? webResult.entry : pv.entry || `${root || '/'}/index.html`}
            {webResult?.ok && webResult.modules?.length
              ? ` · ${webResult.modules.length} module${webResult.modules.length === 1 ? '' : 's'} linked`
              : null}
          </span>
        )}
        {pv.error ? (
          <span className="ml-auto inline-flex items-center gap-1 truncate text-rose-400" title={pv.error}>
            <AlertTriangle size={12} /> {pv.error}
          </span>
        ) : null}
      </div>

      {/* Web unsupported-asset notice (honest limitations, not silent failures) */}
      {!desktop && webResult?.ok && webResult.unsupported.length ? (
        <div className="shrink-0 border-b border-white/10 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          {webResult.unsupported.map((u) => (
            <div key={u} className="truncate" title={u}>⚠ {u}</div>
          ))}
        </div>
      ) : null}

      {/* The frame */}
      <div className="min-h-0 flex-1 bg-white/95 dark:bg-white">
        {!desktop ? (
          webResult?.ok ? (
            <iframe
              ref={iframeRef}
              title="Live Preview (in-browser)"
              srcDoc={webResult.doc}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="h-full w-full border-0"
              style={pw ? { maxWidth: pw, width: '100%', margin: '0 auto', display: 'block', height: '100%', border: '1px solid rgba(100,116,139,.35)' } : undefined}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-slate-500">
              <div>
                <p>{webResult?.message || 'Preparing in-browser preview…'}</p>
                {webResult?.needsDevServer ? (
                  <p className="mt-2 text-[11px] text-amber-400">
                    A static preview and a development server are not the same thing: this panel does not run the
                    build. The desktop app's Go Live starts the project's own dev script.
                  </p>
                ) : null}
              </div>
            </div>
          )
        ) : iframeSrc ? (
          <iframe
            ref={iframeRef}
            title="Live Preview"
            src={iframeSrc}
            sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-popups"
            className="h-full w-full border-0 bg-white"
            style={pw ? { maxWidth: pw, width: '100%', margin: '0 auto', display: 'block', height: '100%', border: '1px solid rgba(100,116,139,.35)' } : undefined}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            {desktop && !running && !starting ? (
              <>
                <p className="text-xs text-slate-400">
                  {pv.mode === 'dev'
                    ? 'Start the project’s dev script above (needs Node.js on PATH; runs only inside the opened workspace).'
                    : 'Go Live starts a local 127.0.0.1 server that serves this workspace folder (index.html at the root, or open an HTML file).'}
                </p>
                {!root ? <p className="text-[11px] text-amber-400">Open a workspace folder first (Ctrl+O).</p> : null}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Forwarded console output (web mode; desktop cross-origin frames cannot report) */}
      {!desktop && consoleMsgs.length ? (
        <div className="max-h-24 shrink-0 overflow-auto border-t border-white/10 bg-black/40 px-2 py-1 font-mono text-[10.5px]">
          {consoleMsgs.map((m, i) => (
            <div key={i} className={m.type === 'error' ? 'text-rose-400' : m.type === 'warn' ? 'text-amber-300' : 'text-slate-400'}>
              [{m.type}] {m.text}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
