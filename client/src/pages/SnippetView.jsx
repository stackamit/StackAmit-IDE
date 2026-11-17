import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Loader2, AlertOctagon } from 'lucide-react';

import { api } from '../services/api.js';
import { DEFAULT_LANGUAGES } from '../utils/languageDefaults.js';

/**
 * Public shared-snippet viewer. Loads a snippet by id and offers to open it in
 * the workspace. Private snippets and disabled features return 404 from the API.
 */
export default function SnippetView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, snippet: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, snippet: null, error: null });
    api
      .getSnippet(id)
      .then((data) => !cancelled && setState({ loading: false, snippet: data, error: null }))
      .catch((err) => !cancelled && setState({ loading: false, snippet: null, error: err }));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const openInEditor = () => {
    const s = state.snippet;
    try {
      const drafts = JSON.parse(localStorage.getItem('stackamit:drafts') || '{}');
      drafts[s.language] = s.sourceCode;
      localStorage.setItem('stackamit:drafts', JSON.stringify(drafts));
      localStorage.setItem('stackamit:active', JSON.stringify(s.language));
    } catch {
      /* ignore storage errors */
    }
    navigate('/editor');
  };

  const langMeta = DEFAULT_LANGUAGES.find((l) => l.key === state.snippet?.language);

  return (
    <div className="app-shell flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-ink-800 dark:bg-ink-900">
        <Link to="/editor" className="focus-ring inline-flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium hover:bg-slate-100 dark:hover:bg-ink-800">
          <ArrowLeft size={16} /> Back to editor
        </Link>
        {state.snippet ? (
          <button type="button" onClick={openInEditor} className="focus-ring inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500">
            <ExternalLink size={15} /> Open in editor
          </button>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
        {state.loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="animate-spin" size={16} /> Loading snippet…
          </div>
        ) : state.error ? (
          <div className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-700 dark:text-rose-300">
            <AlertOctagon size={20} className="mt-0.5" />
            <div>
              <p className="font-semibold">Snippet unavailable</p>
              <p className="text-sm">{state.error.message}</p>
            </div>
          </div>
        ) : (
          <article>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <h1 className="text-lg font-semibold">{state.snippet.title || 'Untitled snippet'}</h1>
              <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-medium text-brand-600 dark:text-brand-300">
                {langMeta?.label || state.snippet.language}
              </span>
              <span className="text-slate-400">
                Created {new Date(state.snippet.createdAt).toLocaleString()}
              </span>
            </div>
            <pre className="scroll-slim overflow-auto rounded-xl border border-slate-200 bg-ink-950 p-4 font-mono text-[13px] leading-relaxed text-slate-200 dark:border-ink-800">
              {state.snippet.sourceCode}
            </pre>
          </article>
        )}
      </main>
    </div>
  );
}
