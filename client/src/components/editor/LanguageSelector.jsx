import { ChevronDown } from 'lucide-react';
import { capabilityForRunKey } from '../../languages/languageCapabilities.js';

/**
 * Accessible language picker (native <select>) styled to match the toolbar.
 *
 * The list itself is the *runnable* set (backend registry), and the caption
 * under it states the selected language's real capabilities — IntelliSense
 * tier, whether the online run is verified, formatting, and the local
 * toolchain if one would be needed. All of it comes from the capability
 * registry, so the UI can never claim more than the build actually does.
 */
export default function LanguageSelector({ languages, value, onChange, disabled }) {
  const current = languages.find((lang) => lang.key === value) || languages[0];
  const cap = current ? capabilityForRunKey(current.key) : null;

  const summary = cap
    ? [
        cap.intellisense === 'language-service' ? 'Full IntelliSense' : 'Highlighting + suggestions',
        cap.formatter ? `format: ${cap.formatter === 'prettier' ? 'Prettier' : 'language service'}` : null,
        cap.linter === 'server' ? 'syntax checks' : cap.linter === 'native' ? 'live diagnostics' : null,
        cap.run ? 'online run verified' : cap.local ? `local ${cap.local.cmd} only` : 'no runner',
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="relative">
        <select
          aria-label="Programming language"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="focus-ring h-9 appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 disabled:opacity-60 dark:border-ink-700 dark:bg-ink-850 dark:text-slate-200 dark:hover:border-ink-600"
        >
          {languages.map((lang) => (
            <option key={lang.key} value={lang.key}>
              {lang.label}
              {lang.version ? ` · ${lang.version}` : ''}
              {lang.supported === false ? ' (unavailable)' : ''}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"
        />
      </div>
      {summary ? (
        <p
          className="hidden max-w-[22rem] text-[11px] leading-tight text-slate-500 dark:text-slate-400 sm:block"
          title={cap?.runtimeNote ? `${summary}\n${cap.runtimeNote}` : summary}
        >
          {summary}
          {cap?.local?.install && !cap.run ? (
            <span className="text-amber-600 dark:text-amber-400"> · setup: winget install -e --id {cap.local.install}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
