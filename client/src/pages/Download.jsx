import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download as DownloadIcon, Monitor, Cpu, HardDrive, ShieldCheck, Zap, Languages, Package,
  CheckCircle2, FileCode2, Puzzle, TerminalSquare, WifiOff, Rocket, Sparkles,
  Layers, ArrowUpRight, Info, Clock, FileArchive,
} from 'lucide-react';
import { COMPANY_URL, APP_NAME, APP_TAGLINE } from '../config.js';
// The app's own version as the last-resort display value: info.json normally
// carries the staged installer's version, but a stale/missing info.json must
// never invent an old one (a frozen string here drifted behind releases once).
import { version as APP_VERSION } from '../../package.json';

// Static asset URL for the staged installer (see scripts/stage-installer.mjs).
const BASE = import.meta.env.BASE_URL || '/';
const url = (file) => `${BASE}downloads/${file}`.replace(/\/{2,}/g, '/');
const DOWNLOAD_URL = url('StackAmit-IDE-Setup.exe');
const INFO_URL = url('info.json');

const FEATURES = [
  { Icon: FileCode2, title: 'Real Monaco editor', body: 'The same editor engine that powers VS Code — syntax highlighting, IntelliSense, multi-cursor and minimap for 60+ languages and file formats.' },
  { Icon: WifiOff, title: 'Works offline', body: 'A full desktop install. Edit, format and browse your projects even with no internet — only cloud execution needs a connection.' },
  { Icon: TerminalSquare, title: 'Integrated terminal', body: 'A real shell inside the IDE on desktop, alongside run output, problems and a debug console.' },
  { Icon: Puzzle, title: 'Extensions built in', body: 'Install Prettier formatting, Todo Tree, file icons, extra themes, sticky scroll and more from the Extensions panel.' },
  { Icon: Layers, title: 'Full workspace', body: 'Open a real folder, edit multiple files with tabs, rename and create files, and pick from hand-crafted color themes.' },
  { Icon: ShieldCheck, title: 'Privacy first', body: 'Your code stays on your machine. Source and input are never logged, and execution secrets never reach the client.' },
];

const SPECS = [
  ['Application', `${APP_NAME} — ${APP_TAGLINE}`],
  ['Type', 'Desktop IDE + Web app (dual mode)'],
  ['Editor engine', 'Monaco Editor (the VS Code editor core)'],
  ['Languages', '60+ highlighted formats · 18 runnable online · Python, JavaScript, C++, Java & PowerShell offline in the desktop app'],
  ['Desktop shell', 'Electron (Chromium + Node.js)'],
  ['Frontend', 'React 18 · Vite · Tailwind CSS · Zustand'],
  ['Backend / execution', 'Node.js · Express · remote sandboxed runners'],
  ['AI assistant', 'In-editor chat panel (bring-your-own endpoint)'],
  ['Packaging', 'NSIS Windows installer (.exe), per-user or all-users'],
  ['Architecture', 'x64 (64-bit)'],
];

const REQUIREMENTS = [
  { Icon: Monitor, label: 'OS', value: 'Windows 10 or Windows 11 (64-bit)' },
  { Icon: Cpu, label: 'Processor', value: 'Any modern x64 CPU (Intel / AMD)' },
  { Icon: HardDrive, label: 'Disk space', value: '~300 MB free for install' },
  { Icon: Zap, label: 'Memory', value: '2 GB RAM minimum, 4 GB recommended' },
  { Icon: Languages, label: 'Internet', value: 'Optional — needed only for cloud code execution' },
];

const STEPS = [
  'Click the Download button to save the installer (StackAmit-IDE Setup).',
  'Run the downloaded .exe and follow the setup wizard.',
  'Choose an install folder (or keep the default) and finish.',
  'Launch StackAmit-IDE from the desktop or Start-menu shortcut.',
];

function formatSize(bytes) {
  if (!bytes || Number.isNaN(bytes)) return '≈ 103 MB';
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}

export default function Download() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(INFO_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data) setInfo(data);
      })
      .catch(() => {
        /* download file not staged yet — page still renders with defaults */
      });
    return () => {
      alive = false;
    };
  }, []);

  const version = info?.version || APP_VERSION;
  const size = formatSize(info?.sizeBytes);
  const updated = formatDate(info?.updatedAt);

  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      {/* Hero */}
      <header className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
          <Rocket size={13} /> Desktop app for Windows
        </span>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          Download <span className="text-brand-500">StackAmit</span>-IDE
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
          {APP_TAGLINE} — get the full offline desktop editor with a real workspace, integrated terminal and
          one-click code execution, installed right on your computer.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={DOWNLOAD_URL}
            download
            className="focus-ring inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-500"
          >
            <DownloadIcon size={18} /> Download for Windows
          </a>
          <Link
            to="/ide"
            className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-base font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-ink-700 dark:text-slate-200 dark:hover:bg-ink-900"
          >
            Or open in browser <ArrowUpRight size={16} />
          </Link>
        </div>

        {/* Install meta strip */}
        <div className="mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
          <MetaTile Icon={Package} label="Version" value={version} />
          <MetaTile Icon={FileArchive} label="Size" value={size} />
          <MetaTile Icon={Clock} label="Updated" value={updated} />
          <MetaTile Icon={Monitor} label="Platform" value="Win x64" />
        </div>

        <p className="mx-auto mt-4 flex max-w-2xl items-center justify-center gap-1.5 text-center text-xs text-slate-500 dark:text-slate-400">
          <Info size={13} className="shrink-0" />
          64-bit Windows 10/11 · Unsigned build — if SmartScreen appears, choose “More info → Run anyway”.
        </p>
      </header>

      {/* Features */}
      <section className="mt-16">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Everything the web IDE does — on your desktop</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
              <span className="inline-flex rounded-xl bg-brand-50 p-2.5 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                <Icon size={20} />
              </span>
              <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* System requirements + install steps */}
      <section className="mt-16 grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-7 dark:border-ink-800 dark:bg-ink-900/60">
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
            <Cpu size={20} className="text-brand-500" /> System requirements
          </h2>
          <ul className="mt-5 space-y-4">
            {REQUIREMENTS.map(({ Icon, label, value }) => (
              <li key={label} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex rounded-lg bg-white p-2 text-brand-600 shadow-sm dark:bg-ink-800 dark:text-brand-300">
                  <Icon size={16} />
                </span>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{value}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-7 dark:border-ink-800 dark:bg-ink-900/60">
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900 dark:text-white">
            <Sparkles size={20} className="text-brand-500" /> Install in 4 steps
          </h2>
          <ol className="mt-5 space-y-4">
            {STEPS.map((step, i) => (
              <li key={step} className="flex items-start gap-3">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <p className="pt-0.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{step}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
            <CheckCircle2 size={16} className="shrink-0" />
            Your desktop shortcut now shows the StackAmit logo — ready to code.
          </div>
        </div>
      </section>

      {/* Full specification */}
      <section className="mt-16">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Application specification</h2>
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 dark:border-ink-800">
          <dl className="divide-y divide-slate-200 dark:divide-ink-800">
            {SPECS.map(([k, v], i) => (
              <div
                key={k}
                className={`grid grid-cols-1 gap-1 px-5 py-3.5 sm:grid-cols-3 sm:gap-4 ${
                  i % 2 ? 'bg-white dark:bg-ink-900' : 'bg-slate-50 dark:bg-ink-900/50'
                }`}
              >
                <dt className="text-sm font-semibold text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="text-sm text-slate-800 sm:col-span-2 dark:text-slate-100">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mt-16 flex flex-col items-center gap-4 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-10 text-center">
        <h2 className="text-2xl font-bold text-white">Prefer not to install?</h2>
        <p className="max-w-xl text-brand-100">
          The full editor also runs in your browser — no download required. Jump in and start coding in seconds.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link
            to="/ide"
            className="focus-ring inline-flex items-center gap-1.5 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Launch the web IDE
          </Link>
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-xl border border-white/40 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            Visit StackAmit <ArrowUpRight size={16} />
          </a>
        </div>
      </section>
    </div>
  );
}

function MetaTile({ Icon, label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-center dark:border-ink-800 dark:bg-ink-900">
      <Icon size={16} className="mx-auto text-brand-500" />
      <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{value}</div>
    </div>
  );
}
