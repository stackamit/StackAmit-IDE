import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Lock, MailCheck } from 'lucide-react';
import { userAuthApi } from '../services/userAuth.js';

export default function AccountLifecycle({ reset = false }) {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const token = params.get('token') || '';
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (reset) { await userAuthApi.resetPassword(token, password); setMessage('Password updated. You can now sign in.'); }
      else { await userAuthApi.verifyEmail(token); setMessage('Email verified. You can now sign in.'); }
    } catch (err) { setError(err.response?.data?.message || err.message || 'The request failed.'); }
    finally { setBusy(false); }
  };
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-ink-700 dark:bg-ink-900 dark:text-white';
  return <div className="app-shell flex min-h-full items-center justify-center px-4 py-12"><form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900"><div className="text-center">{reset ? <Lock className="mx-auto text-brand-500" size={30} /> : <MailCheck className="mx-auto text-brand-500" size={30} />}<h1 className="mt-3 text-xl font-bold text-slate-900 dark:text-white">{reset ? 'Reset your password' : 'Verify your email'}</h1></div>{error ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-sm text-rose-500">{error}</div> : null}{message ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-600">{message}</div> : null}{reset ? <label className="block text-sm text-slate-600 dark:text-slate-300">New password<input className={input} type="password" minLength={10} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} /></label> : null}<button disabled={busy || !token} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={16} /> : null}{reset ? 'Update password' : 'Verify email'}</button><p className="text-center text-xs text-slate-500"><Link className="text-brand-500" to="/account/login">Return to sign in</Link></p></form></div>;
}
