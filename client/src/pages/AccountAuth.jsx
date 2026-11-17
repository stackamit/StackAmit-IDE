import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, UserRound } from 'lucide-react';
import { useUserAuth } from '../context/UserAuthContext.jsx';

export default function AccountAuth({ registerMode = false }) {
  const { user, login, register } = useUserAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.from || '/account/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(location.state?.aiRequired ? 'Sign in is required to use StackAmit AI. Your editor content will not be sent automatically.' : '');
  if (user) return <Navigate to="/account/dashboard" replace />;
  const submit = async (event) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = registerMode ? await register(email.trim(), password) : await login(email.trim(), password);
      if (result.verificationRequired) { setNotice('Account created. Check your email to verify the account before signing in.'); return; }
      navigate(returnTo, { replace: true });
    } catch (err) {
      const code = err.response?.data?.code;
      const messages = { EMAIL_PROVIDER_AUTH_FAILED: 'Registration email could not be sent because the server SendGrid credentials or sender address were rejected. Please contact support.', EMAIL_PROVIDER_UNAVAILABLE: 'The email service is temporarily unavailable. Please try registration again shortly.', EMAIL_PROVIDER_TIMEOUT: 'The email service took too long to respond. Please try registration again.', EMAIL_PROVIDER_RATE_LIMITED: 'The email service is temporarily rate-limited. Please try again later.' };
      setError(messages[code] || err.response?.data?.message || err.message || 'Authentication failed.');
    } finally { setBusy(false); }
  };
  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-ink-700 dark:bg-ink-900 dark:text-white';
  return <div className="app-shell flex min-h-full items-center justify-center px-4 py-12"><form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900"><Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-500"><ArrowLeft size={15} /> Back to Site</Link><div className="pt-2 text-center"><UserRound className="mx-auto text-brand-500" size={30} /><h1 className="mt-3 text-xl font-bold text-slate-900 dark:text-white">{registerMode ? 'Create your StackAmit account' : 'Sign in to StackAmit'}</h1><p className="mt-1 text-sm text-slate-500">Your account is separate from administrator access.</p></div>{error ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-sm text-rose-500">{error}</div> : null}{notice ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-sm text-emerald-600">{notice}</div> : null}<label className="block text-sm text-slate-600 dark:text-slate-300">Email<input className={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label className="block text-sm text-slate-600 dark:text-slate-300">Password<div className="relative"><input className={input} type={show ? 'text' : 'password'} minLength={10} maxLength={128} autoComplete={registerMode ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} /><button type="button" className="absolute right-3 top-3 text-slate-400" onClick={() => setShow((value) => !value)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label><button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? <Loader2 className="animate-spin" size={16} /> : <Lock size={16} />}{registerMode ? 'Create account' : 'Sign in'}</button>{!registerMode ? <Link to="/account/reset-password" className="block text-center text-xs text-brand-500">Forgot password?</Link> : null}<p className="text-center text-xs text-slate-500">{registerMode ? <>Already registered? <Link className="text-brand-500" to="/account/login">Sign in</Link></> : <>New here? <Link className="text-brand-500" to="/account/register">Create an account</Link></>}</p></form></div>;
}
