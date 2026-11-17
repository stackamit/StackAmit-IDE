import { Link } from 'react-router-dom';
import { Play, Code2, RotateCcw, Sun, Moon, Save, Share2, Settings2, Home, Info, Mail } from 'lucide-react';
import LanguageSelector from '../editor/LanguageSelector.jsx';
import Logo from '../ui/Logo.jsx';
import { Button } from '../ui/Button.jsx';
import { COMPANY_URL } from '../../config.js';

const FONT_SIZES = [12, 14, 16, 18, 20, 22];

/**
 * Top bar: branding, language picker, run/format/reset actions, font-size and
 * theme controls, and a subtle execution-provider status pill.
 */
export default function Navbar({
  languages,
  activeLanguage,
  onLanguageChange,
  running,
  provider,
  snippetEnabled,
  onRun,
  onFormat,
  onReset,
  onSave,
  onSaveSnippet,
  isDark,
  onToggleTheme,
  fontSize,
  onFontSizeChange,
  onOpenSettings,
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/90 px-3 py-2 backdrop-blur dark:border-ink-800 dark:bg-ink-900/80 sm:px-4">
      <div className="flex items-center gap-2">
        <Logo size={34} />
        <div className="leading-tight">
          <div className="flex items-center gap-1 text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
            <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="focus-ring rounded hover:text-brand-500">
              Stack<span className="text-brand-500">Amit</span>
            </a>
            <span className="ml-0.5 rounded bg-slate-200 px-1 text-[10px] font-semibold text-slate-500 dark:bg-ink-800 dark:text-slate-400">
              IDE
            </span>
          </div>
          <div className="hidden text-[11px] text-slate-400 dark:text-slate-500 sm:block">Code. Compile. Create.</div>
        </div>
      </div>

      <nav className="ml-1 hidden items-center gap-0.5 lg:flex">
        <Link to="/" className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-ink-800" title="Home">
          <Home size={14} /> <span className="hidden xl:inline">Home</span>
        </Link>
        <Link to="/about" className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-ink-800" title="About">
          <Info size={14} /> <span className="hidden xl:inline">About</span>
        </Link>
        <Link to="/contact" className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-ink-800" title="Contact us">
          <Mail size={14} /> <span className="hidden xl:inline">Contact</span>
        </Link>
      </nav>

      <div className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-ink-800 xl:block" />

      <LanguageSelector languages={languages} value={activeLanguage} onChange={onLanguageChange} disabled={running} />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <ProviderPill provider={provider} />

        <label className="sr-only" htmlFor="font-size">
          Editor font size
        </label>
        <select
          id="font-size"
          value={fontSize}
          onChange={(e) => onFontSizeChange(Number(e.target.value))}
          className="focus-ring h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-600 dark:border-ink-700 dark:bg-ink-850 dark:text-slate-300"
          title="Editor font size"
        >
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>

        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          title="Customize IDE"
          aria-label="Customize IDE"
        >
          <Settings2 size={18} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTheme}
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle color theme"
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onFormat}
          title="Format code (Shift+Alt+F)"
          className="hidden sm:inline-flex"
        >
          <Code2 size={15} /> Format
        </Button>

        <Button variant="ghost" size="sm" onClick={onSave} title="Save file to your computer (Ctrl/⌘ + S)">
          <Save size={15} /> <span className="hidden sm:inline">Save</span>
        </Button>

        {snippetEnabled ? (
          <Button variant="ghost" size="sm" onClick={onSaveSnippet} title="Save & copy shareable link">
            <Share2 size={15} /> <span className="hidden sm:inline">Share</span>
          </Button>
        ) : null}

        <Button variant="ghost" size="sm" onClick={onReset} title="Reset current code">
          <RotateCcw size={15} /> <span className="hidden sm:inline">Reset</span>
        </Button>

        <Button variant="primary" size="md" onClick={onRun} loading={running} disabled={running} title="Run code (Ctrl/⌘ + Enter)">
          {!running ? <Play size={16} /> : null}
          {running ? 'Running…' : 'Run'}
        </Button>
      </div>
    </header>
  );
}

function ProviderPill({ provider }) {
  if (!provider) return null;
  const ok = provider.configured && provider.available;
  return (
    <span
      title={ok ? `Execution engine ready (${provider.name})` : 'Execution engine unavailable'}
      className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium md:inline-flex ${
        ok
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {ok ? provider.name : 'engine offline'}
    </span>
  );
}
