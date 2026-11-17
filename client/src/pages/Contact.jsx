import { useState } from 'react';
import { Mail, Globe, Clock, Send, CheckCircle2, Inbox, Loader2 } from 'lucide-react';
import { api } from '../services/api.js';
import { useSiteContent } from '../hooks/useSiteContent.js';
import SocialLinks from '../components/ui/SocialLinks.jsx';

const field =
  'focus-ring w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 dark:border-ink-700 dark:bg-ink-900 dark:text-slate-100';

const EMPTY = { name: '', email: '', subject: '', message: '' };

export default function Contact() {
  const { contact, social, socialVisibility } = useSiteContent();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  // 'stored' → saved to admin inbox; 'mail' → API unavailable, opened email client.
  const [sent, setSent] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Please enter your name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    if (form.message.trim().length < 10) next.message = 'Message should be at least 10 characters.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const openMailClient = () => {
    const subject = encodeURIComponent(form.subject || `StackAmit-IDE enquiry from ${form.name}`);
    const body = encodeURIComponent(`${form.message}\n\n— ${form.name} (${form.email})`);
    window.location.href = `mailto:${contact.email}?subject=${subject}&body=${body}`;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.submitContact(form);
      setSent('stored');
    } catch {
      // Backend inbox unavailable (e.g. database offline) — never drop the message.
      openMailClient();
      setSent('mail');
    } finally {
      setSubmitting(false);
    }
  };

  const channels = [
    { Icon: Mail, label: 'Email', value: contact.email, href: `mailto:${contact.email}` },
    { Icon: Globe, label: 'Website', value: social.website ? social.website.replace(/^https?:\/\//, '') : '', href: social.website || null },
    { Icon: Clock, label: 'Response time', value: contact.responseTime, href: null },
  ].filter((c) => c.value);

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <header className="text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl dark:text-white">{contact.heading}</h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600 dark:text-slate-300">{contact.subtitle}</p>
      </header>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        {/* Channels */}
        <div className="space-y-4">
          {channels.map(({ Icon, label, value, href }) => {
            const inner = (
              <div className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-300 dark:border-ink-800 dark:bg-ink-900">
                <span className="inline-flex rounded-xl bg-brand-50 p-2.5 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                  <Icon size={20} />
                </span>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="mt-0.5 break-words font-medium text-slate-800 dark:text-slate-100">{value}</div>
                </div>
              </div>
            );
            return href ? (
              <a key={label} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="focus-ring block rounded-2xl">
                {inner}
              </a>
            ) : (
              <div key={label}>{inner}</div>
            );
          })}

          {social && Object.values(social).some((v) => v && /^https?:\/\//i.test(v)) ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Follow us</div>
              <SocialLinks social={social} socialVisibility={socialVisibility} />
            </div>
          ) : null}
        </div>

        {/* Form */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900 sm:p-8">
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <CheckCircle2 size={44} className="text-emerald-500" />
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Thanks, {form.name.split(' ')[0] || 'there'}!</h2>
              <p className="max-w-sm text-sm text-slate-600 dark:text-slate-400">
                {sent === 'stored' ? (
                  <>Your message has been delivered to our team. We typically reply {contact.responseTime.toLowerCase()}.</>
                ) : (
                  <>
                    Your email app should have opened with the message ready to send. If it didn&rsquo;t, reach us directly at{' '}
                    <a href={`mailto:${contact.email}`} className="text-brand-600 hover:underline dark:text-brand-300">{contact.email}</a>.
                  </>
                )}
              </p>
              <button type="button" onClick={() => { setSent(null); setForm(EMPTY); }} className="focus-ring mt-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 dark:bg-ink-800 dark:text-slate-200">
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="name">Name</label>
                  <input id="name" className={field} value={form.name} onChange={set('name')} placeholder="Your name" />
                  {errors.name ? <p className="mt-1 text-xs text-rose-500">{errors.name}</p> : null}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="email">Email</label>
                  <input id="email" type="email" className={field} value={form.email} onChange={set('email')} placeholder="you@example.com" />
                  {errors.email ? <p className="mt-1 text-xs text-rose-500">{errors.email}</p> : null}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="subject">Subject</label>
                <input id="subject" className={field} value={form.subject} onChange={set('subject')} placeholder="How can we help?" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200" htmlFor="message">Message</label>
                <textarea id="message" rows={5} className={field} value={form.message} onChange={set('message')} placeholder="Tell us a bit more…" />
                {errors.message ? <p className="mt-1 text-xs text-rose-500">{errors.message}</p> : null}
              </div>
              <button type="submit" disabled={submitting} className="focus-ring inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-500 disabled:opacity-70">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {submitting ? 'Sending…' : 'Send message'}
              </button>
              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
                <Inbox size={12} /> Your message goes straight to the StackAmit team inbox.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
