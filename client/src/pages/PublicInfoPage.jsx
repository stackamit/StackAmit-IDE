import { Link } from 'react-router-dom';
import { ArrowUpRight, LifeBuoy, Mail, ShieldCheck, Scale } from 'lucide-react';
import { useSiteContent } from '../hooks/useSiteContent.js';

const ICONS = { privacy: ShieldCheck, terms: Scale, support: LifeBuoy };
const FALLBACKS = {
  privacy: { title: 'Privacy Policy', intro: 'Learn how StackAmit-IDE handles information and provider requests.', body: 'This page is managed by the StackAmit admin team.' },
  terms: { title: 'Terms and Conditions', intro: 'The rules for responsible use of StackAmit-IDE.', body: 'This page is managed by the StackAmit admin team.' },
  support: { title: 'StackAmit Support', intro: 'Get help with your account, IDE, AI providers or execution.', body: 'This page is managed by the StackAmit admin team.', email: 'support@stackamit.com' },
};

export default function PublicInfoPage({ section }) {
  const content = useSiteContent()[section] || FALLBACKS[section];
  const Icon = ICONS[section] || LifeBuoy;
  const paragraphs = String(content.body || '').split(/\n\s*\n/).filter(Boolean);

  return (
    <article className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <header className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
          <Icon size={14} /> StackAmit
        </span>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">{content.title}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">{content.intro}</p>
      </header>

      <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900 sm:p-8">
        <div className="space-y-6 text-[15px] leading-8 text-slate-600 dark:text-slate-300">
          {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </div>
        {section === 'support' ? (
          <div className="mt-8 flex flex-wrap gap-3 border-t border-slate-200 pt-6 dark:border-ink-800">
            {content.email ? <a href={`mailto:${content.email}`} className="focus-ring inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"><Mail size={16} /> Email Support</a> : null}
            <Link to="/contact" className="focus-ring inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:text-slate-200 dark:hover:text-brand-300">Contact form <ArrowUpRight size={15} /></Link>
          </div>
        ) : null}
      </section>
    </article>
  );
}
