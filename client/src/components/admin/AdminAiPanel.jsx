import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, RefreshCw, Square, XCircle } from 'lucide-react';
import { adminApi } from '../../services/admin.js';

const ACTIONS = {
  Explain: 'Explain the following code carefully. Describe what it does, important assumptions, and potential issues.',
  Generate: 'Generate a production-quality implementation for this request. Include a concise explanation and a complete code block where appropriate.',
  Debug: 'Debug the following code. Identify the root cause, then provide a corrected version and explain the fix.',
  Refactor: 'Refactor the following code for clarity, maintainability, and correctness. Preserve its behavior and explain the key changes.',
};

export default function AdminAiPanel() {
  const [providers, setProviders] = useState([]);
  const [provider, setProvider] = useState('');
  const [models, setModels] = useState([]);
  const [model, setModel] = useState('');
  const [health, setHealth] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  const selected = useMemo(() => providers.find((item) => item.id === provider), [providers, provider]);
  const load = async () => {
    setError('');
    try {
      const [data, settings] = await Promise.all([adminApi.aiProviders(), adminApi.settings()]);
      const next = data.providers || [];
      setProviders(next);
      const preferred = next.find((item) => item.id === settings?.adminAi?.provider) || next.find((item) => item.id === provider) || next[0];
      setProvider(preferred?.id || '');
      setModel(settings?.adminAi?.model || preferred?.defaultModel || '');
    } catch (err) { setError(err.message || 'Could not load server-configured AI providers.'); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!provider) { setModels([]); return; }
    let active = true;
    setHealth(null);
    Promise.all([adminApi.aiModels(provider), adminApi.aiHealth(provider)])
      .then(([items, status]) => { if (active) { setModels(items); setHealth(status); if (!model && items[0]?.id) setModel(items[0].id); } })
      .catch((err) => { if (active) setError(err.message || 'Provider check failed.'); });
    return () => { active = false; };
  }, [provider]);

  useEffect(() => {
    if (provider) adminApi.saveSettings({ adminAi: { provider, model } }).catch(() => {});
  }, [provider, model]);

  const run = async () => {
    if (!provider || !prompt.trim()) return;
    setBusy(true); setError(''); setAnswer('');
    abortRef.current = new AbortController();
    try {
      await adminApi.aiStream({ provider, model, signal: abortRef.current.signal, messages: [{ role: 'user', content: prompt.trim() }], onEvent: (event, data) => {
        if (event === 'delta') setAnswer((current) => current + (data.text || ''));
        if (event === 'error') setError(data.message || 'Provider request failed.');
      } });
    } catch (err) { if (err.name !== 'AbortError') setError(err.message || 'Admin AI request failed.'); }
    finally { abortRef.current = null; setBusy(false); }
  };

  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Admin AI workspace</h2><p className="mt-1 text-sm text-slate-500">Uses only providers configured on the server. User-owned provider credentials are never used here.</p></div><button type="button" onClick={load} className="focus-ring inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-ink-700"><RefreshCw size={15} /> Refresh</button></div>
    {error ? <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300"><XCircle size={17} /> {error}</div> : null}
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900"><h3 className="font-semibold">Server providers</h3>{providers.length === 0 ? <p className="text-sm text-slate-500">No server provider is configured.</p> : providers.map((item) => <button type="button" key={item.id} onClick={() => { setProvider(item.id); setModel(item.defaultModel || ''); }} className={`focus-ring flex w-full items-center justify-between rounded-lg border p-3 text-left ${provider === item.id ? 'border-brand-500 bg-brand-500/10' : 'border-slate-200 dark:border-ink-700'}`}><span className="inline-flex items-center gap-2"><Bot size={16} />{item.name}</span><span className="text-xs text-slate-500">{item.local ? 'Local' : 'Cloud'}</span></button>)}</div>
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Provider<select className="focus-ring mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700" value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">Select configured provider</option>{providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm font-medium">Model<select className="focus-ring mt-1 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-ink-700" value={model} onChange={(e) => setModel(e.target.value)}><option value="">Provider default</option>{models.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label></div>
        {selected ? <p className="inline-flex items-center gap-2 text-sm text-slate-500">{health?.available ? <CheckCircle2 className="text-emerald-500" size={16} /> : <XCircle className="text-rose-500" size={16} />} {health?.available ? 'Connection verified.' : health?.message || 'Connection not verified.'}</p> : null}
        <div className="flex flex-wrap gap-2">{Object.entries(ACTIONS).map(([label, value]) => <button type="button" key={label} disabled={!provider || busy} onClick={() => setPrompt(value + '\n\nPaste the code or request here:\n')} className="focus-ring rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-brand-600 disabled:opacity-50">{label}</button>)}</div>
        <textarea className="focus-ring min-h-36 w-full rounded-lg border border-slate-300 bg-transparent p-3 text-sm dark:border-ink-700" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask the server-configured AI a question…" />
        <div className="flex items-center gap-2"><button type="button" disabled={!provider || !prompt.trim() || busy} onClick={run} className="focus-ring inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={15} /> : <Bot size={15} />} {busy ? 'Generating…' : 'Send'}</button>{busy ? <button type="button" onClick={() => abortRef.current?.abort()} className="focus-ring inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-ink-700"><Square size={14} /> Stop</button> : null}</div>
        {answer ? <pre className="max-h-[500px] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-sm text-slate-100">{answer}</pre> : null}
      </div>
    </div>
  </section>;
}
