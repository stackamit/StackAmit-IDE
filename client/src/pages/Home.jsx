import { Link } from 'react-router-dom';
import {
  Zap,
  ShieldCheck,
  MonitorPlay,
  Terminal,
  Languages,
  Sparkles,
  ArrowRight,
  Save,
  Sun,
} from 'lucide-react';
import { useSiteContent } from '../hooks/useSiteContent.js';
import { runnableLanguages, catalogueEntries } from '../languages/languageCapabilities.js';

const FEATURES = [
  { Icon: MonitorPlay, title: 'Run in the browser', body: 'A real Monaco editor and an interactive terminal — write code, supply input and see genuine output instantly.' },
  { Icon: Languages, title: '60+ editor modes, 18 runnable', body: 'Python, C, C++, Java, JavaScript, TypeScript, Go, Rust, C#, PHP, Ruby and more — with honest per-language capability info, nothing to install.' },
  { Icon: Terminal, title: 'Interactive terminal', body: 'Feed stdin directly in the terminal and read stdout, stderr and compiler diagnostics in one place.' },
  { Icon: Zap, title: 'Genuine execution', body: 'Code runs on a real execution service through our backend — never simulated, never fake.' },
  { Icon: ShieldCheck, title: 'Private & secure', body: 'No account required. Drafts stay in your browser; your source is never logged on the server.' },
  { Icon: Save, title: 'Autosave & share', body: 'Per-language drafts survive refreshes and language switches. Share a snippet link when you want to.' },
];

const STEPS = [
  { n: '1', title: 'Pick a language', body: 'Choose from 18 verified runnable languages — or edit any of the 60+ supported formats.' },
  { n: '2', title: 'Write & feed input', body: 'Edit in Monaco and type stdin straight into the terminal.' },
  { n: '3', title: 'Run instantly', body: 'Press Ctrl/⌘ + Enter and read real results in the terminal.' },
];

/** Chips come from the capability registry — never a hand-maintained list. */
const RUNNABLE_LABELS = [...new Set(runnableLanguages().map((l) => l.label))];
const LANGS = RUNNABLE_LABELS.slice(0, 6);
const MORE_LANGS = new Set(catalogueEntries().map((l) => l.monaco)).size - LANGS.length;

/** Highlight the "real IDE" phrase when present; otherwise render the title as-is. */
function HeroTitle({ text }) {
  const i = text.lastIndexOf('real IDE');
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-brand-500">{text.slice(i, i + 'real IDE'.length)}</span>
      {text.slice(i + 'real IDE'.length)}
    </>
  );
}

export default function Home() {
  const { home } = useSiteContent();
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-brand-50/80 via-white to-white dark:from-brand-900/20 dark:via-ink-950 dark:to-ink-950" />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-20 text-center sm:px-6 sm:pt-28">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
            <Sparkles size={13} /> {home.badge}
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl dark:text-white">
            <HeroTitle text={home.heroTitle} />
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-slate-600 dark:text-slate-300">
            {home.heroSubtitle}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/ide"
              className="focus-ring inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-brand-900/20 transition-colors hover:bg-brand-500"
            >
              {home.ctaPrimary} <ArrowRight size={18} />
            </Link>
            <Link
              to="/about"
              className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-ink-700 dark:bg-ink-900 dark:text-slate-200 dark:hover:bg-ink-800"
            >
              {home.ctaSecondary}
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            {LANGS.map((l) => (
              <span key={l} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 dark:bg-ink-800 dark:text-slate-300">
                {l}
              </span>
            ))}
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 dark:bg-ink-800 dark:text-slate-300">
              +{MORE_LANGS} more formats
            </span>
          </div>
        </div>
      </section>

      {/* Editor preview mock */}
      <section className="mx-auto -mt-4 max-w-5xl px-4 sm:px-6">
        <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-2xl shadow-slate-900/10 dark:border-ink-800">
          <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-ink-800 dark:bg-ink-900">
            <span className="h-3 w-3 rounded-full bg-rose-400" />
            <span className="h-3 w-3 rounded-full bg-amber-400" />
            <span className="h-3 w-3 rounded-full bg-emerald-400" />
            <span className="ml-3 font-mono text-xs text-slate-400">main.py — StackAmit-IDE</span>
          </div>
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2 dark:bg-ink-800">
            <pre className="overflow-auto bg-white p-4 font-mono text-[13px] leading-relaxed text-slate-800 dark:bg-ink-950 dark:text-slate-200">
{`name = input("Your name: ")
print(f"Hello, {name}!")`}
            </pre>
            <div className="bg-slate-950 p-4 font-mono text-[13px] leading-relaxed text-slate-200">
              <p className="text-emerald-400">$ run python</p>
              <p className="text-sky-400">&gt; Amit</p>
              <p>Hello, Amit!</p>
              <p className="mt-1 text-emerald-400">✓ Finished · exit 0</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Everything you need to just code</h2>
          <p className="mt-3 text-slate-600 dark:text-slate-400">
            A focused developer workspace with the essentials done right — and nothing in your way.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-ink-800 dark:bg-ink-900">
              <span className="inline-flex rounded-xl bg-brand-50 p-2.5 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                <Icon size={20} />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-slate-200 bg-slate-50 dark:border-ink-800 dark:bg-ink-900/50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Up and running in seconds</h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">{s.n}</span>
                <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">{s.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-14 text-center shadow-xl">
          <Sun className="pointer-events-none absolute -right-8 -top-8 text-white/10" size={180} />
          <h2 className="relative text-3xl font-bold tracking-tight text-white">Ready to compile something?</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-brand-100">
            Open the IDE and run your first program in seconds. It's free, no account required.
          </p>
          <Link
            to="/ide"
            className="focus-ring relative mt-7 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-base font-semibold text-brand-700 shadow transition hover:bg-brand-50"
          >
            Open StackAmit-IDE <ArrowRight size={18} />
          </Link>
        </div>
      </section>
    </div>
  );
}
