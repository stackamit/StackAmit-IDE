import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdeStore } from '../../store/ideStore.js';

/**
 * The app's own text prompt.
 *
 * Electron does not implement `window.prompt` at all — calling it throws
 * "prompt() is and will not be supported." — so every rename / new file /
 * new folder action used to die silently in the desktop build. This modal is
 * mounted once by the IDE shell and resolves the pending `requestPrompt()`
 * promise from the store, so the actions stay async and unchanged.
 */
export default function PromptModal() {
  const prompt = useIdeStore((s) => s.prompt);
  const answer = useIdeStore((s) => s.answerPrompt);
  const [value, setValue] = useState('');
  const [asked, setAsked] = useState(null);
  const inputRef = useRef(null);
  // Keep the latest text for the submit handler registered on the previous render.
  const valueRef = useRef('');
  valueRef.current = value;

  // Seed the field in the same render that shows the question, so the user
  // never sees (or submits) an empty input before the effect runs.
  if (prompt && prompt !== asked) {
    setAsked(prompt);
    setValue(prompt.defaultValue || '');
    valueRef.current = prompt.defaultValue || '';
  }

  useEffect(() => {
    if (!prompt) return undefined;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [prompt]);

  const submit = useCallback(() => {
    const text = valueRef.current.trim();
    answer(text || null);
  }, [answer]);

  useEffect(() => {
    if (!prompt) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        answer(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [prompt, answer, submit]);

  if (!prompt) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={prompt.title}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => answer(null)} aria-hidden="true" />
      <div className="relative w-[min(94vw,26rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-ink-700 dark:bg-ink-900">
        <label htmlFor="stackamit-prompt-input" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {prompt.title}
        </label>
        <input
          id="stackamit-prompt-input"
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="focus-ring mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-800 dark:border-ink-700 dark:bg-ink-950 dark:text-slate-100"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => answer(null)}
            className="focus-ring rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="focus-ring rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
          >
            {prompt.okLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
