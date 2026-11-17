import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Lock, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import Logo from '../components/ui/Logo.jsx';
import { COMPANY_URL } from '../config.js';

/**
 * Admin sign-in. Intentionally unreachable from any public navigation — the
 * admin opens it directly (e.g. /login). There is no registration.
 */
export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/admin';

  const [form, setForm] = useState({ username: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to={from} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form.username.trim(), form.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'focus-ring w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 dark:border-ink-700 dark:bg-ink-900 dark:text-slate-100';

  return (
    <div className="app-shell flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="mt-3 text-xl font-bold text-slate-900 dark:text-white">Admin sign in</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Restricted area · <span className="font-medium">StackAmit-IDE</span> management
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:bg-ink-850 dark:text-slate-400">
            <Lock size={14} /> Single administrator account · no self-registration
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-600 dark:text-rose-300">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" /> {error}
            </div>
          ) : null}

          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Username
            </label>
            <input
              id="username"
              autoComplete="username"
              className={input}
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                className={input}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="focus-ring absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                aria-label={show ? 'Hide password' : 'Show password'}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={busy}
            className="focus-ring inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-500 disabled:opacity-70"
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : null} {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-xs text-slate-400">
          <Link to="/" className="hover:text-brand-500">← Back to site</Link>
          <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="hover:text-brand-500">StackAmit</a>
        </div>
      </div>
    </div>
  );
}
