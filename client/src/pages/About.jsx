import { Link } from 'react-router-dom';
import { Target, HeartHandshake, Lock, Rocket, ArrowUpRight, Cpu } from 'lucide-react';
import { COMPANY_URL } from '../config.js';
import { useSiteContent } from '../hooks/useSiteContent.js';

const VALUES = [
  { Icon: Rocket, title: 'Zero friction', body: 'Open the browser, start typing. No installs, no accounts, no configuration before you can compile.' },
  { Icon: Lock, title: 'Privacy first', body: 'Your code stays in your browser. We never log source code or input, and execution secrets never reach the client.' },
  { Icon: Cpu, title: 'Honest execution', body: 'Programs run on a genuine execution service. If something fails, you see the real compiler or runtime error — never a fake success.' },
  { Icon: HeartHandshake, title: 'Built for learners', body: 'A clean, responsive, accessible workspace that works on a phone, a laptop or a classroom projector.' },
];

const STACK = ['React', 'Vite', 'Monaco Editor', 'Node.js', 'Express', 'MongoDB', 'Tailwind CSS', 'JavaScript'];

/** Brand-highlight "StackAmit" inside an admin-edited heading, when present. */
function Accent({ text, word = 'StackAmit' }) {
  const i = text.indexOf(word);
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-brand-500">{word}</span>
      {text.slice(i + word.length)}
    </>
  );
}

export default function About() {
  const { about } = useSiteContent();
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <header className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
          <Target size={13} /> {about.mission}
        </span>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl dark:text-white">
          <Accent text={about.heading} />
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
          {about.intro}
        </p>
      </header>

      <section className="mt-14 space-y-4 text-slate-600 dark:text-slate-300">
        <p className="text-[15px] leading-relaxed">
          StackAmit-IDE is a product of <strong className="font-semibold text-slate-900 dark:text-white">StackAmit</strong> — a team
          focused on building practical developer tools that lower the barrier to learning and prototyping.
          Whether you are a student writing your first program, an interviewer checking a snippet, or a
          developer testing an idea, the editor gives you a real workspace in seconds.
        </p>
        <p className="text-[15px] leading-relaxed">
          {about.body}
        </p>
      </section>

      <section className="mt-14 grid gap-5 sm:grid-cols-2">
        {VALUES.map(({ Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-ink-800 dark:bg-ink-900">
            <span className="inline-flex rounded-xl bg-brand-50 p-2.5 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              <Icon size={20} />
            </span>
            <h3 className="mt-4 font-semibold text-slate-900 dark:text-white">{title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{body}</p>
          </div>
        ))}
      </section>

      <section className="mt-14 rounded-2xl border border-slate-200 bg-slate-50 p-8 dark:border-ink-800 dark:bg-ink-900/60">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Built with a modern stack</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {STACK.map((tech) => (
            <span key={tech} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm dark:bg-ink-800 dark:text-slate-200">
              {tech}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-14 flex flex-col items-center gap-4 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-10 text-center">
        <h2 className="text-2xl font-bold text-white">Part of the StackAmit family</h2>
        <p className="max-w-xl text-brand-100">
          Explore more tools and projects from our team on the StackAmit website.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Visit StackAmit <ArrowUpRight size={16} />
          </a>
          <Link to="/contact" className="focus-ring inline-flex items-center gap-1.5 rounded-xl border border-white/40 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">
            Contact us
          </Link>
        </div>
      </section>
    </div>
  );
}
