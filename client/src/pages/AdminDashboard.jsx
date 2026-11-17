import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  Database,
  Server,
  Trash2,
  Save,
  RefreshCw,
  LogOut,
  Code2,
  CheckCircle2,
  XCircle,
  Sun,
  Moon,
  Loader2,
  AlertTriangle,
  Inbox,
  Layout,
  Mail,
  Trash,
  Bot,
} from 'lucide-react';
import AdminAiPanel from '../components/admin/AdminAiPanel.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../hooks/useTheme.js';
import { useNotifications } from '../components/ui/Notification.jsx';
import { adminApi } from '../services/admin.js';
import { invalidateSiteContent } from '../hooks/useSiteContent.js';
import Logo from '../components/ui/Logo.jsx';
import { COMPANY_URL } from '../config.js';

const TABS = [
  { id: 'overview', label: 'Overview', Icon: Activity },
  { id: 'executions', label: 'Executions', Icon: Server },
  { id: 'snippets', label: 'Snippets', Icon: Code2 },
  { id: 'pages', label: 'Pages', Icon: Layout },
  { id: 'messages', label: 'Messages', Icon: Inbox },
  { id: 'settings', label: 'Settings', Icon: Save },
  { id: 'ai', label: 'Admin AI', Icon: Bot },
];

function Stat({ label, value, tone = 'default' }) {
  const toneCls =
    tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white';
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${toneCls}`}>{value}</div>
    </div>
  );
}

function Dot({ ok, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
      {children}
    </span>
  );
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');

  const [dash, setDash] = useState(null);
  const [dashErr, setDashErr] = useState('');
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      setDash(await adminApi.dashboard());
      setDashErr('');
    } catch (err) {
      setDashErr(err.message || 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const doLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell min-h-full">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-ink-800 dark:bg-ink-900/80">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Logo size={30} />
          <div className="leading-tight">
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              <a href={COMPANY_URL} target="_blank" rel="noopener noreferrer" className="hover:text-brand-500">
                Stack<span className="text-brand-500">Amit</span>
              </a>{' '}
              <span className="text-slate-400">· Admin</span>
            </div>
            <div className="text-[11px] text-slate-400">Signed in as {user?.username}</div>
          </div>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                  tab === id ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800'
                }`}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link to="/ide" className="focus-ring hidden items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-500 sm:inline-flex">
              <Code2 size={15} /> IDE
            </Link>
            <button type="button" onClick={toggleTheme} className="focus-ring rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800" aria-label="Toggle theme">
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button type="button" onClick={doLogout} className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:border-ink-700 dark:text-slate-300 dark:hover:bg-ink-800">
              <LogOut size={15} /> <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
        {/* Mobile tabs */}
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-200 px-4 py-2 dark:border-ink-800 md:hidden">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                tab === id ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300' : 'text-slate-500'
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {tab === 'overview' ? <Overview dash={dash} loading={loading} err={dashErr} onReload={loadDashboard} /> : null}
        {tab === 'executions' ? <Executions /> : null}
        {tab === 'snippets' ? <Snippets /> : null}
        {tab === 'pages' ? <PagesEditor /> : null}
        {tab === 'messages' ? <MessagesPanel /> : null}
        {tab === 'settings' ? <SettingsPanel /> : null}
        {tab === 'ai' ? <AdminAiPanel /> : null}
      </main>
    </div>
  );
}

function Overview({ dash, loading, err, onReload }) {
  if (loading) return <Loading />;
  if (err) return <ErrorNote message={err} onRetry={onReload} />;

  const ex = dash?.executions || {};
  const subs = dash?.subsystems || {};
  const dbOk = subs.database?.connected;
  const provider = subs.provider || {};
  const total = ex.total || 0;
  const rate = total ? Math.round((ex.succeeded / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">System overview</h2>
        <button type="button" onClick={onReload} className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Executions (30d)" value={total} />
        <Stat label="Success rate" value={`${rate}%`} tone={rate >= 70 ? 'ok' : 'bad'} />
        <Stat label="Failed" value={ex.failed || 0} tone={ex.failed ? 'bad' : 'default'} />
        <Stat label="Avg time" value={ex.avgTimeMs != null ? `${ex.avgTimeMs}ms` : 'n/a'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <Server size={16} className="text-brand-500" /> Subsystems
          </h3>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <Dot ok={dbOk}><span className="inline-flex items-center gap-1"><Database size={14} /> MongoDB</span></Dot>
              <span className="text-slate-400">{dbOk ? 'connected' : 'offline (degraded)'}</span>
            </li>
            <li className="flex items-center justify-between">
              <Dot ok={Boolean(provider.configured && provider.available)}><span className="inline-flex items-center gap-1"><Server size={14} /> {provider.name || 'provider'}</span></Dot>
              <span className="text-slate-400">{provider.available ? 'ready' : provider.reason || 'unavailable'}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-slate-500">Active snippets</span>
              <span className="font-medium text-slate-800 dark:text-slate-100">{dash?.snippets?.count ?? 0}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-slate-500"><Inbox size={14} /> Unread messages</span>
              <span className="font-medium text-slate-800 dark:text-slate-100">{dash?.messages?.unread ?? 0}</span>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <Activity size={16} className="text-brand-500" /> Usage by language
          </h3>
          {!ex.byLanguage?.length ? (
            <p className="text-sm text-slate-400">No executions recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {ex.byLanguage.map((row) => (
                <li key={row._id} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-slate-600 dark:text-slate-300">{row._id}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-800">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Math.round((row.count / total) * 100))}%` }} />
                  </div>
                  <span className="w-10 text-right tabular-nums text-slate-400">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
          {!dbOk ? <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">Enable MongoDB (MONGODB_URI) to record usage statistics.</p> : null}
        </div>
      </div>
    </div>
  );
}

function Executions() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ persisted: true });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.executions(60);
      setRows(data.items || []);
      setMeta({ persisted: data.persisted });
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (err) return <ErrorNote message={err} onRetry={load} />;

  return (
    <Section title="Recent executions" onReload={load}>
      <p className="mb-3 text-xs text-slate-400">Metadata only — source code and input are never stored.</p>
      {!meta.persisted ? <InfoNote>No database connected — execution history is disabled.</InfoNote> : null}
      <div className="scroll-slim overflow-x-auto rounded-xl border border-slate-200 dark:border-ink-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400 dark:bg-ink-900">
            <tr>
              <th className="px-4 py-2.5">Time</th>
              <th className="px-4 py-2.5">Language</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Exit</th>
              <th className="px-4 py-2.5">Time (ms)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-ink-800">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No executions yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r._id} className="bg-white dark:bg-ink-950">
                  <td className="px-4 py-2.5 text-slate-500">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-200">{r.language}</td>
                  <td className="px-4 py-2.5">
                    {r.success ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={14} /> {r.status}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400"><XCircle size={14} /> {r.status}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-500">{r.exitCode ?? '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-500">{r.executionTimeMs ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Snippets() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const notif = useNotifications();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.snippets(200);
      setRows(data.items || []);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (id) => {
    if (!window.confirm('Delete this shared snippet permanently?')) return;
    try {
      await adminApi.deleteSnippet(id);
      setRows((prev) => prev.filter((s) => s._id !== id));
      notif.success('Snippet deleted.');
    } catch (e) {
      notif.error(e.message || 'Delete failed.');
    }
  };

  if (loading) return <Loading />;
  if (err) return <ErrorNote message={err} onRetry={load} />;

  return (
    <Section title="Shared snippets" onReload={load}>
      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400 dark:border-ink-800">
          No snippets stored. Sharing requires a MongoDB connection.
        </div>
      ) : (
        <div className="scroll-slim overflow-x-auto rounded-xl border border-slate-200 dark:border-ink-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400 dark:bg-ink-900">
              <tr>
                <th className="px-4 py-2.5">Title</th>
                <th className="px-4 py-2.5">Language</th>
                <th className="px-4 py-2.5">Views</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5">Expires</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-ink-800">
              {rows.map((s) => (
                <tr key={s._id} className="bg-white dark:bg-ink-950">
                  <td className="px-4 py-2.5">
                    <Link to={`/snippet/${s._id}`} className="font-medium text-brand-600 hover:underline dark:text-brand-300">
                      {s.title || 'Untitled'}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{s.language}</td>
                  <td className="px-4 py-2.5 tabular-nums text-slate-500">{s.viewCount ?? 0}</td>
                  <td className="px-4 py-2.5 text-slate-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-slate-500">{s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => remove(s._id)} className="focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">
                      <Trash2 size={14} /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function SettingsPanel() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ announcementBanner: '', bannerEnabled: false, maintenanceMessage: '', snippetEnabledOverride: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await adminApi.settings();
      setSettings(s);
      setForm({
        announcementBanner: s.announcementBanner || '',
        bannerEnabled: Boolean(s.bannerEnabled),
        maintenanceMessage: s.maintenanceMessage || '',
        snippetEnabledOverride: s.snippetEnabledOverride,
      });
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      const s = await adminApi.saveSettings(form);
      setSettings(s);
      setStatus('Settings saved.');
    } catch (e2) {
      setStatus(e2.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (err) return <ErrorNote message={err} onRetry={load} />;

  const input =
    'focus-ring w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-ink-700 dark:bg-ink-900 dark:text-slate-100';

  return (
    <Section title="Site settings">
      {settings?.persisted === false ? (
        <InfoNote>Settings are read-only without a MongoDB connection. Configure MONGODB_URI to persist changes.</InfoNote>
      ) : null}
      <form onSubmit={save} className="max-w-2xl space-y-5">
        <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-800 dark:bg-ink-900">
          <div>
            <div className="text-sm font-medium text-slate-800 dark:text-slate-100">Show announcement banner</div>
            <div className="text-xs text-slate-400">Displays a message across the top of the IDE.</div>
          </div>
          <Toggle checked={form.bannerEnabled} onChange={(v) => setForm((f) => ({ ...f, bannerEnabled: v }))} disabled={settings?.persisted === false} />
        </label>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Banner message</label>
          <input className={input} maxLength={240} value={form.announcementBanner} onChange={(e) => setForm((f) => ({ ...f, announcementBanner: e.target.value }))} placeholder="e.g. Scheduled maintenance on Sunday 02:00 UTC" disabled={settings?.persisted === false} />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Snippet sharing</label>
          <select
            className={input}
            value={form.snippetEnabledOverride === null ? 'default' : form.snippetEnabledOverride ? 'on' : 'off'}
            onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, snippetEnabledOverride: v === 'default' ? null : v === 'on' }));
            }}
            disabled={settings?.persisted === false}
          >
            <option value="default">Use server default ({settings?.snippetEnabled ? 'on' : 'off'})</option>
            <option value="on">Force enabled</option>
            <option value="off">Force disabled</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Maintenance note (informational)</label>
          <textarea className={input} rows={2} maxLength={240} value={form.maintenanceMessage} onChange={(e) => setForm((f) => ({ ...f, maintenanceMessage: e.target.value }))} disabled={settings?.persisted === false} />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving || settings?.persisted === false} className="focus-ring inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-60">
            {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Save changes
          </button>
          {status ? <span className="text-sm text-slate-500">{status}</span> : null}
        </div>
      </form>
    </Section>
  );
}

const CONTENT_SECTIONS = [
  {
    key: 'branding',
    title: 'Public branding',
    fields: [
      ['name', 'Brand name', 80, false],
      ['tagline', 'Tagline', 160, false],
      ['description', 'Footer description', 300, true],
      ['logoUrl', 'Logo URL (internal or http(s))', 500, false],
    ],
  },
  {
    key: 'home',
    title: 'Home page',
    fields: [
      ['badge', 'Hero badge', 80, false],
      ['heroTitle', 'Hero title', 160, false],
      ['heroSubtitle', 'Hero subtitle', 500, true],
      ['ctaPrimary', 'Primary button', 40, false],
      ['ctaSecondary', 'Secondary button', 40, false],
    ],
  },
  {
    key: 'about',
    title: 'About page',
    fields: [
      ['heading', 'Heading', 120, false],
      ['mission', 'Mission badge', 80, false],
      ['intro', 'Intro paragraph', 600, true],
      ['body', 'Main paragraph', 4000, true],
    ],
  },
  {
    key: 'contact',
    title: 'Contact page',
    fields: [
      ['heading', 'Heading', 120, false],
      ['subtitle', 'Subtitle', 400, true],
      ['email', 'Contact email', 160, false],
      ['responseTime', 'Response time', 160, false],
    ],
  },
  {
    key: 'privacy',
    title: 'Privacy Policy page',
    fields: [['title', 'Page title', 160, false], ['intro', 'Intro', 1000, true], ['body', 'Policy content (separate paragraphs with a blank line)', 12000, true]],
  },
  {
    key: 'terms',
    title: 'Terms and Conditions page',
    fields: [['title', 'Page title', 160, false], ['intro', 'Intro', 1000, true], ['body', 'Terms content (separate paragraphs with a blank line)', 12000, true]],
  },
  {
    key: 'support',
    title: 'Support page',
    fields: [['title', 'Page title', 160, false], ['intro', 'Intro', 1000, true], ['body', 'Support guidance (separate paragraphs with a blank line)', 12000, true], ['email', 'Support email', 160, false]],
  },
  {
    key: 'ai',
    title: 'StackAmit-AI page',
    fields: [
      ['badge', 'Badge', 80, false],
      ['heading', 'Heading', 160, false],
      ['intro', 'Intro', 800, true],
      ['overview', 'Overview', 4000, true],
      ['mission', 'Mission heading', 120, false],
      ['capabilities', 'Capabilities (one item per line)', 4000, true],
      ['providers', 'Providers (one item per line)', 3000, true],
      ['privacy', 'Privacy and security', 3000, true],
      ['offline', 'Offline/local AI', 3000, true],
      ['roadmap', 'Roadmap (one item per line)', 3000, true],
      ['cta', 'CTA text', 160, false],
      ['ctaLabel', 'CTA button', 80, false],
    ],
  },
  {
    key: 'seo',
    title: 'SEO metadata',
    fields: [
      ['title', 'Browser/page title', 160, false],
      ['description', 'Meta description', 320, true],
    ],
  },
];

function PagesEditor() {
  const notif = useNotifications();
  const [content, setContent] = useState(null);
  const [persisted, setPersisted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.content();
      setContent(data.content);
      setPersisted(data.persisted);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load page content.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setField = (section, key, value) =>
    setContent((c) => ({ ...c, [section]: { ...c[section], [key]: value } }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await adminApi.saveContent(content);
      setContent(data.content);
      invalidateSiteContent(); // public pages re-fetch on next mount
      notif.success('Page content updated.');
    } catch (e2) {
      notif.error(e2.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (err) return <ErrorNote message={err} onRetry={load} />;

  const input =
    'focus-ring w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-ink-700 dark:bg-ink-900 dark:text-slate-100';
  const disabled = persisted === false;

  return (
    <Section title="Public page content" onReload={load}>
      {disabled ? (
        <InfoNote>Page editing needs a MongoDB connection. Configure MONGODB_URI to overwrite public-page data.</InfoNote>
      ) : (
        <p className="mb-3 text-xs text-slate-400">Edit the copy shown on the Home, About, StackAmit-AI and Contact pages. Leave a field as-is to keep it.</p>
      )}
      <form onSubmit={save} className="space-y-6">
        {CONTENT_SECTIONS.map((section) => (
          <div key={section.key} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
            <h3 className="mb-4 text-sm font-semibold text-slate-800 dark:text-slate-100">{section.title}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {section.fields.map(([key, label, max, multiline]) => (
                <div key={key} className={multiline ? 'sm:col-span-2' : ''}>
                  <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
                  {multiline ? (
                    <textarea
                      className={input}
                      rows={3}
                      maxLength={max}
                      disabled={disabled}
                      value={content?.[section.key]?.[key] ?? ''}
                      onChange={(e) => setField(section.key, key, e.target.value)}
                    />
                  ) : (
                    <input
                      className={input}
                      maxLength={max}
                      disabled={disabled}
                      value={content?.[section.key]?.[key] ?? ''}
                      onChange={(e) => setField(section.key, key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        <button type="submit" disabled={saving || disabled} className="focus-ring inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-60">
          {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />} Save page content
        </button>
      </form>
      <NavigationEditor content={content} setContent={setContent} disabled={disabled} onSave={() => save({ preventDefault() {} })} saving={saving} />
      <SocialEditor content={content} setContent={setContent} disabled={disabled} onSave={() => save({ preventDefault() {} })} saving={saving} />
      <VisualAiDocumentationEditor content={content} setContent={setContent} disabled={disabled} onSave={() => save({ preventDefault() {} })} onDiscard={load} saving={saving} />
    </Section>
  );
}

function NavigationEditor({ content, setContent, disabled, onSave, saving }) {
  const update = (path, value) => setContent((current) => {
    const next = structuredClone(current);
    let target = next;
    path.slice(0, -1).forEach((key) => { target = target[key]; });
    target[path[path.length - 1]] = value;
    return next;
  });
  const move = (columnIndex, linkIndex, direction) => setContent((current) => {
    const next = structuredClone(current); const links = next.footer.columns[columnIndex].links; const other = linkIndex + direction;
    if (other < 0 || other >= links.length) return current; [links[linkIndex], links[other]] = [links[other], links[linkIndex]]; links.forEach((link, index) => { link.order = (index + 1) * 10; }); return next;
  });
  const moveColumn = (columnIndex, direction) => setContent((current) => {
    const next = structuredClone(current); const other = columnIndex + direction;
    if (other < 0 || other >= next.footer.columns.length) return current;
    [next.footer.columns[columnIndex], next.footer.columns[other]] = [next.footer.columns[other], next.footer.columns[columnIndex]];
    return next;
  });
  const moveHeader = (linkIndex, direction) => setContent((current) => {
    const next = structuredClone(current); const links = next.navigation.links; const other = linkIndex + direction;
    if (other < 0 || other >= links.length) return current;
    [links[linkIndex], links[other]] = [links[other], links[linkIndex]];
    links.forEach((link, index) => { link.order = (index + 1) * 10; });
    return next;
  });
  const add = (columnIndex) => setContent((current) => { const next = structuredClone(current); const links = next.footer.columns[columnIndex].links; links.push({ id: `link-${Date.now()}`, label: 'New link', href: '/', enabled: true, order: (links.length + 1) * 10 }); return next; });
  const remove = (columnIndex, linkIndex) => setContent((current) => { const next = structuredClone(current); next.footer.columns[columnIndex].links.splice(linkIndex, 1); return next; });
  const renderLink = (link, path, actions) => <div key={link.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 dark:border-ink-700 sm:grid-cols-[1fr_1fr_auto]"><input className="focus-ring rounded border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-ink-700" disabled={disabled} value={link.label} aria-label="Link label" onChange={(event) => update([...path, 'label'], event.target.value)} /><input className="focus-ring rounded border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-ink-700" disabled={disabled} value={link.href} aria-label="Link URL" onChange={(event) => update([...path, 'href'], event.target.value)} /><div className="flex items-center gap-1"><button type="button" disabled={disabled} onClick={actions.toggle} className={`rounded px-2 py-1 text-xs ${link.enabled !== false ? 'bg-emerald-500/10 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>{link.enabled !== false ? 'Enabled' : 'Disabled'}</button>{actions.moveUp ? <button type="button" disabled={disabled} onClick={actions.moveUp} className="rounded px-2 py-1 text-xs text-slate-500">↑</button> : null}{actions.moveDown ? <button type="button" disabled={disabled} onClick={actions.moveDown} className="rounded px-2 py-1 text-xs text-slate-500">↓</button> : null}<button type="button" disabled={disabled} onClick={actions.remove} className="rounded px-2 py-1 text-xs text-rose-600">Delete</button></div></div>;
  return <div className="mt-8 space-y-6"><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Header and footer navigation</h3><p className="mt-1 text-xs text-slate-400">Use internal paths or secure http(s) URLs. Layout is fixed to three desktop groups and two mobile columns.</p></div><label className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" disabled={disabled} checked={content?.published !== false} onChange={(event) => update(['published'], event.target.checked)} /> Published</label></div><div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900"><h4 className="mb-3 text-sm font-semibold">Header links</h4><div className="space-y-2">{(content?.navigation?.links || []).map((link, index) => renderLink(link, ['navigation', 'links', index], { toggle: () => update(['navigation', 'links', index, 'enabled'], link.enabled === false), moveUp: index ? () => moveHeader(index, -1) : null, moveDown: index < content.navigation.links.length - 1 ? () => moveHeader(index, 1) : null, remove: () => setContent((current) => ({ ...current, navigation: { ...current.navigation, links: current.navigation.links.filter((_, itemIndex) => itemIndex !== index) } })) }))}</div><button type="button" disabled={disabled} onClick={() => setContent((current) => ({ ...current, navigation: { ...current.navigation, links: [...current.navigation.links, { id: `header-${Date.now()}`, label: 'New link', href: '/', enabled: true, order: (current.navigation.links.length + 1) * 10 }] } }))} className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-brand-600">Add header link</button></div><div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900"><label className="block text-xs font-medium text-slate-500">Copyright text<input className="focus-ring mt-1 w-full rounded border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-ink-700" disabled={disabled} value={content?.footer?.copyright || ''} onChange={(event) => update(['footer', 'copyright'], event.target.value)} /></label></div>{(content?.footer?.columns || []).slice(0, 3).map((column, columnIndex) => <div key={column.id} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900"><div className="mb-3 flex flex-wrap items-center gap-2"><input className="focus-ring rounded border border-slate-300 bg-transparent px-2 py-1 text-sm font-semibold dark:border-ink-700" disabled={disabled} value={column.title} aria-label={`Footer column ${columnIndex + 1} heading`} onChange={(event) => update(['footer', 'columns', columnIndex, 'title'], event.target.value)} /><button type="button" disabled={disabled || columnIndex === 0} onClick={() => moveColumn(columnIndex, -1)} aria-label="Move footer column left" className="rounded px-2 py-1 text-xs text-slate-500">←</button><button type="button" disabled={disabled || columnIndex === content.footer.columns.length - 1} onClick={() => moveColumn(columnIndex, 1)} aria-label="Move footer column right" className="rounded px-2 py-1 text-xs text-slate-500">→</button><button type="button" disabled={disabled} onClick={() => add(columnIndex)} className="ml-auto rounded-lg border border-dashed border-slate-300 px-3 py-1 text-xs font-semibold text-brand-600">Add link</button></div><div className="space-y-2">{column.links.map((link, linkIndex) => renderLink(link, ['footer', 'columns', columnIndex, 'links', linkIndex], { toggle: () => update(['footer', 'columns', columnIndex, 'links', linkIndex, 'enabled'], link.enabled === false), moveUp: linkIndex ? () => move(columnIndex, linkIndex, -1) : null, moveDown: linkIndex < column.links.length - 1 ? () => move(columnIndex, linkIndex, 1) : null, remove: () => remove(columnIndex, linkIndex) }))}</div></div>)}<button type="button" disabled={disabled || saving} onClick={onSave} className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save navigation and footer'}</button></div>;
}

function SocialEditor({ content, setContent, disabled, onSave, saving }) {
  const fields = ['website', 'facebook', 'twitter', 'instagram', 'linkedin', 'github', 'youtube'];
  return <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 dark:border-ink-800 dark:bg-ink-900"><h3 className="text-sm font-semibold">Social platforms</h3><p className="mt-1 text-xs text-slate-400">Only valid http(s) URLs are rendered publicly. Disable a platform without deleting its URL.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{fields.map((key) => <label key={key} className="flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" disabled={disabled} checked={content?.socialVisibility?.[key] !== false} onChange={(event) => setContent((current) => ({ ...current, socialVisibility: { ...current.socialVisibility, [key]: event.target.checked } }))} /><span className="w-20 capitalize">{key}</span><input className="focus-ring min-w-0 flex-1 rounded border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-ink-700" disabled={disabled} value={content?.social?.[key] || ''} aria-label={`${key} URL`} onChange={(event) => setContent((current) => ({ ...current, social: { ...current.social, [key]: event.target.value } }))} /></label>)}</div><button type="button" disabled={disabled || saving} onClick={onSave} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save social links'}</button></div>;
}

function VisualAiDocumentationEditor({ content, setContent, disabled, onSave, onDiscard, saving }) {
  const [preview, setPreview] = useState(false);
  const doc = content?.aiDocumentation || { published: true, title: '', subtitle: '', introduction: '', cta: {}, seo: {}, sections: [] };
  const input = 'focus-ring w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900';
  const patchDoc = (key, value) => setContent((current) => ({ ...current, aiDocumentation: { ...(current.aiDocumentation || {}), [key]: value } }));
  const patchSection = (index, patch) => setContent((current) => { const next = structuredClone(current); next.aiDocumentation.sections[index] = { ...next.aiDocumentation.sections[index], ...patch }; return next; });
  const sections = doc.sections || [];
  const reorder = (index, direction) => setContent((current) => { const next = structuredClone(current); const rows = next.aiDocumentation.sections; const other = index + direction; if (other < 0 || other >= rows.length) return current; [rows[index], rows[other]] = [rows[other], rows[index]]; rows.forEach((row, i) => { row.order = (i + 1) * 10; }); return next; });
  const addSection = () => patchDoc('sections', [...sections, { id: `section-${Date.now()}`, title: 'New section', body: '', enabled: true, order: (sections.length + 1) * 10, steps: [], examples: [], faqs: [], media: [], blocks: [] }]);
  const deleteSection = (index) => { if (window.confirm('Delete this AI guide section?')) patchDoc('sections', sections.filter((_, i) => i !== index)); };
  return <div className="mt-8 rounded-xl border border-brand-200 bg-brand-50/40 p-5 dark:border-brand-500/20 dark:bg-brand-500/5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">AI Guide visual editor</h3><p className="mt-1 text-xs text-slate-500">Edit the `/ai` guide with form controls. No JSON is required.</p></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={doc.published !== false} onChange={(e) => patchDoc('published', e.target.checked)} /> Published</label></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">Title<input className={input} disabled={disabled} value={doc.title || ''} onChange={(e) => patchDoc('title', e.target.value)} /></label><label className="text-xs font-medium">Subtitle<input className={input} disabled={disabled} value={doc.subtitle || ''} onChange={(e) => patchDoc('subtitle', e.target.value)} /></label><label className="text-xs font-medium sm:col-span-2">Introduction<textarea className={input} rows={3} disabled={disabled} value={doc.introduction || ''} onChange={(e) => patchDoc('introduction', e.target.value)} /></label><label className="text-xs font-medium">SEO title<input className={input} disabled={disabled} value={doc.seo?.title || ''} onChange={(e) => patchDoc('seo', { ...(doc.seo || {}), title: e.target.value })} /></label><label className="text-xs font-medium">SEO description<input className={input} disabled={disabled} value={doc.seo?.description || ''} onChange={(e) => patchDoc('seo', { ...(doc.seo || {}), description: e.target.value })} /></label></div>
    <div className="mt-5 space-y-3"><div className="flex items-center justify-between"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sections</h4><button type="button" disabled={disabled} onClick={addSection} className="rounded-lg border border-dashed border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-600">Add section</button></div>{sections.map((section, index) => <VisualGuideSection key={section.id || index} section={section} index={index} input={input} disabled={disabled} canMoveUp={index > 0} canMoveDown={index < sections.length - 1} onChange={(patch) => patchSection(index, patch)} onMove={(direction) => reorder(index, direction)} onDelete={() => deleteSection(index)} />)}</div>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={disabled || saving} onClick={onSave} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save AI guide'}</button><button type="button" disabled={disabled} onClick={() => setPreview((value) => !value)} className="rounded-lg border border-brand-300 px-4 py-2 text-sm font-semibold text-brand-600">{preview ? 'Hide draft preview' : 'Preview draft'}</button><span className="self-center text-xs text-slate-500">Draft changes remain private until Published is enabled.</span></div>{preview ? <div className="mt-5 rounded-2xl border border-slate-300 bg-white p-6 dark:border-ink-700 dark:bg-ink-950"><p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Protected draft preview</p><h4 className="mt-2 text-2xl font-bold">{doc.title || 'Untitled AI guide'}</h4><p className="mt-2 text-sm text-slate-500">{doc.introduction}</p><div className="mt-5 space-y-3">{sections.filter((section) => section.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0)).map((section, index) => <div key={section.id || index} className="rounded-xl border border-slate-200 p-4 dark:border-ink-800"><p className="text-xs font-bold text-brand-600">{index + 1}. {section.title}</p><p className="mt-1 text-sm text-slate-500">{section.body}</p></div>)}</div></div> : null}
  </div>;
}

function VisualGuideSection({ section, index, input, disabled, canMoveUp, canMoveDown, onChange, onMove, onDelete }) {
  const blocks = section.blocks || [];
  const steps = section.steps || [];
  const examples = section.examples || [];
  const faqs = section.faqs || [];
  const media = section.media || [];
  const updateArray = (key, value) => onChange({ [key]: value });
  const updateItem = (key, itemIndex, patch) => updateArray(key, (section[key] || []).map((item, i) => i === itemIndex ? { ...item, ...patch } : item));
  const addItem = (key, value) => updateArray(key, [...(section[key] || []), value]);
  const removeItem = (key, itemIndex) => updateArray(key, (section[key] || []).filter((_, i) => i !== itemIndex));
  return <details open={index < 2} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900"><summary className="cursor-pointer list-none"><div className="flex items-center gap-2"><span className="rounded bg-brand-500/10 px-2 py-1 text-xs font-bold text-brand-600">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold">{section.title || 'Untitled section'}</span><button type="button" disabled={disabled || !canMoveUp} onClick={(e) => { e.preventDefault(); onMove(-1); }} className="rounded px-2 text-xs">↑</button><button type="button" disabled={disabled || !canMoveDown} onClick={(e) => { e.preventDefault(); onMove(1); }} className="rounded px-2 text-xs">↓</button><button type="button" disabled={disabled} onClick={(e) => { e.preventDefault(); onDelete(); }} className="rounded px-2 text-xs text-rose-600">Delete</button></div></summary><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">Section title<input className={input} disabled={disabled} value={section.title || ''} onChange={(e) => onChange({ title: e.target.value })} /></label><label className="text-xs font-medium">Anchor ID<input className={input} disabled={disabled} value={section.id || ''} onChange={(e) => onChange({ id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></label><label className="text-xs font-medium sm:col-span-2">Description<textarea className={input} rows={3} disabled={disabled} value={section.body || ''} onChange={(e) => onChange({ body: e.target.value })} /></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={section.enabled !== false} onChange={(e) => onChange({ enabled: e.target.checked })} /> Visible on public guide</label><label className="text-xs">Display order<input className="ml-2 w-24 rounded border px-2 py-1 dark:border-ink-700 dark:bg-ink-950" type="number" disabled={disabled} value={section.order || 0} onChange={(e) => onChange({ order: Number(e.target.value) })} /></label></div><div className="mt-5 space-y-4"><VisualArray title="Tutorial steps" itemLabel="Step" items={steps} disabled={disabled} add={() => addItem('steps', { title: 'New step', description: '', href: '' })} remove={(i) => removeItem('steps', i)} render={(item, i) => <div className="grid gap-2 sm:grid-cols-2"><input className={input} disabled={disabled} placeholder="Step title" value={item.title || ''} onChange={(e) => updateItem('steps', i, { title: e.target.value })} /><input className={input} disabled={disabled} placeholder="Related path (optional)" value={item.href || ''} onChange={(e) => updateItem('steps', i, { href: e.target.value })} /><textarea className={`${input} sm:col-span-2`} rows={2} disabled={disabled} placeholder="Explanation" value={item.description || ''} onChange={(e) => updateItem('steps', i, { description: e.target.value })} /></div>}/><VisualArray title="Code and prompt examples" itemLabel="Example" items={examples} disabled={disabled} add={() => addItem('examples', { kind: 'prompt', title: 'New example', language: 'text', content: '' })} remove={(i) => removeItem('examples', i)} render={(item, i) => <div className="grid gap-2 sm:grid-cols-3"><input className={input} disabled={disabled} placeholder="Title" value={item.title || ''} onChange={(e) => updateItem('examples', i, { title: e.target.value })} /><select className={input} disabled={disabled} value={item.kind || 'prompt'} onChange={(e) => updateItem('examples', i, { kind: e.target.value })}><option value="prompt">Prompt</option><option value="code">Code</option></select><input className={input} disabled={disabled} placeholder="Language" value={item.language || ''} onChange={(e) => updateItem('examples', i, { language: e.target.value })} /><textarea className={`${input} sm:col-span-3`} rows={3} disabled={disabled} placeholder="Example content" value={item.content || ''} onChange={(e) => updateItem('examples', i, { content: e.target.value })} /></div>}/><VisualArray title="Screenshots and media" itemLabel="Media" items={media} disabled={disabled} add={() => addItem('media', { src: '', alt: '', caption: '' })} remove={(i) => removeItem('media', i)} render={(item, i) => <div className="grid gap-2 sm:grid-cols-2"><input className={input} disabled={disabled} placeholder="Safe image URL or /public path" value={item.src || ''} onChange={(e) => updateItem('media', i, { src: e.target.value })} /><input className={input} disabled={disabled} placeholder="Alt text" value={item.alt || ''} onChange={(e) => updateItem('media', i, { alt: e.target.value })} /><input className={`${input} sm:col-span-2`} disabled={disabled} placeholder="Caption" value={item.caption || ''} onChange={(e) => updateItem('media', i, { caption: e.target.value })} /></div>}/><VisualArray title="FAQs" itemLabel="FAQ" items={faqs} disabled={disabled} add={() => addItem('faqs', { question: '', answer: '' })} remove={(i) => removeItem('faqs', i)} render={(item, i) => <div className="grid gap-2"><input className={input} disabled={disabled} placeholder="Question" value={item.question || ''} onChange={(e) => updateItem('faqs', i, { question: e.target.value })} /><textarea className={input} rows={2} disabled={disabled} placeholder="Answer" value={item.answer || ''} onChange={(e) => updateItem('faqs', i, { answer: e.target.value })} /></div>}/></div></details>;
}

function VisualArray({ title, itemLabel, items, disabled, add, remove, render }) { return <div className="rounded-lg border border-slate-200 p-3 dark:border-ink-700"><div className="flex items-center justify-between"><h5 className="text-xs font-semibold">{title}</h5><button type="button" disabled={disabled} onClick={add} className="text-xs font-semibold text-brand-600">Add {itemLabel}</button></div>{items.length ? <div className="mt-3 space-y-2">{items.map((item, index) => <div key={index} className="rounded-lg bg-slate-50 p-3 dark:bg-ink-950"><div className="mb-2 flex justify-end"><button type="button" disabled={disabled} onClick={() => remove(index)} className="text-xs text-rose-600">Delete</button></div>{render(item, index)}</div>)}</div> : <p className="mt-2 text-xs text-slate-500">No {title.toLowerCase()} configured.</p>}</div>; }

function AiDocumentationEditor({ content, setContent, disabled, onSave, saving }) {
  const doc = content?.aiDocumentation || { published: true, title: '', subtitle: '', introduction: '', cta: {}, seo: {}, sections: [] };
  const update = (key, value) => setContent((current) => ({ ...current, aiDocumentation: { ...(current.aiDocumentation || {}), [key]: value } }));
  const updateSection = (index, key, value) => setContent((current) => { const next = structuredClone(current); next.aiDocumentation.sections[index][key] = value; return next; });
  const updateArray = (index, key, value) => { try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) updateSection(index, key, parsed); } catch { /* keep the last valid draft until JSON is complete */ } };
  const move = (index, direction) => setContent((current) => { const next = structuredClone(current); const other = index + direction; const rows = next.aiDocumentation.sections; if (other < 0 || other >= rows.length) return current; [rows[index], rows[other]] = [rows[other], rows[index]]; rows.forEach((row, i) => { row.order = (i + 1) * 10; }); return next; });
  const add = () => update('sections', [...(doc.sections || []), { id: `section-${Date.now()}`, title: 'New section', body: 'Add documentation content.', enabled: true, order: ((doc.sections || []).length + 1) * 10, steps: [], examples: [], faqs: [], media: [] }]);
  const remove = (index) => update('sections', doc.sections.filter((_, i) => i !== index));
  const input = 'focus-ring w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900';
  return <div className="mt-8 rounded-xl border border-brand-200 bg-brand-50/40 p-5 dark:border-brand-500/20 dark:bg-brand-500/5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">AI Page documentation</h3><p className="mt-1 text-xs text-slate-500">Manage the published `/ai` guide inside the existing SiteContent document.</p></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={doc.published !== false} onChange={(e) => update('published', e.target.checked)} /> Published</label></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">Title<input className={input} disabled={disabled} value={doc.title || ''} onChange={(e) => update('title', e.target.value)} /></label><label className="text-xs font-medium">Subtitle<input className={input} disabled={disabled} value={doc.subtitle || ''} onChange={(e) => update('subtitle', e.target.value)} /></label><label className="text-xs font-medium sm:col-span-2">Introduction<textarea className={input} rows={3} disabled={disabled} value={doc.introduction || ''} onChange={(e) => update('introduction', e.target.value)} /></label><label className="text-xs font-medium">SEO title<input className={input} disabled={disabled} value={doc.seo?.title || ''} onChange={(e) => update('seo', { ...(doc.seo || {}), title: e.target.value })} /></label><label className="text-xs font-medium">SEO description<input className={input} disabled={disabled} value={doc.seo?.description || ''} onChange={(e) => update('seo', { ...(doc.seo || {}), description: e.target.value })} /></label><label className="text-xs font-medium">Primary CTA label<input className={input} disabled={disabled} value={doc.cta?.primaryLabel || ''} onChange={(e) => update('cta', { ...(doc.cta || {}), primaryLabel: e.target.value })} /></label><label className="text-xs font-medium">Primary CTA destination<input className={input} disabled={disabled} value={doc.cta?.primaryHref || ''} onChange={(e) => update('cta', { ...(doc.cta || {}), primaryHref: e.target.value })} /></label><label className="text-xs font-medium">Secondary CTA label<input className={input} disabled={disabled} value={doc.cta?.secondaryLabel || ''} onChange={(e) => update('cta', { ...(doc.cta || {}), secondaryLabel: e.target.value })} /></label><label className="text-xs font-medium">Secondary CTA destination<input className={input} disabled={disabled} value={doc.cta?.secondaryHref || ''} onChange={(e) => update('cta', { ...(doc.cta || {}), secondaryHref: e.target.value })} /></label></div><div className="mt-5 space-y-3"><div className="flex items-center justify-between"><h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sections</h4><button type="button" disabled={disabled} onClick={add} className="rounded-lg border border-dashed border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-600">Add section</button></div>{(doc.sections || []).map((item, index) => <div key={item.id || index} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-ink-700 dark:bg-ink-900"><div className="flex gap-2"><input className={input} disabled={disabled} value={item.title || ''} aria-label={`AI section ${index + 1} title`} onChange={(e) => updateSection(index, 'title', e.target.value)} /><button type="button" disabled={disabled || index === 0} onClick={() => move(index, -1)} className="rounded px-2 text-xs">↑</button><button type="button" disabled={disabled || index === doc.sections.length - 1} onClick={() => move(index, 1)} className="rounded px-2 text-xs">↓</button><button type="button" disabled={disabled} onClick={() => remove(index)} className="rounded px-2 text-xs text-rose-600">Delete</button></div><textarea className={`${input} mt-2`} rows={3} disabled={disabled} value={item.body || ''} aria-label={`AI section ${index + 1} body`} onChange={(e) => updateSection(index, 'body', e.target.value)} /><div className="mt-2 flex flex-wrap gap-4 text-xs"><label><input type="checkbox" disabled={disabled} checked={item.enabled !== false} onChange={(e) => updateSection(index, 'enabled', e.target.checked)} /> Enabled</label><label>Order <input className="w-20 rounded border px-1 dark:border-ink-700 dark:bg-ink-950" type="number" disabled={disabled} value={item.order || 0} onChange={(e) => updateSection(index, 'order', Number(e.target.value))} /></label></div><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-brand-600">Edit steps, examples, FAQs and media</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs">Steps JSON<textarea className={input} rows={5} disabled={disabled} value={JSON.stringify(item.steps || [], null, 2)} onChange={(e) => updateArray(index, 'steps', e.target.value)} /></label><label className="text-xs">Examples JSON<textarea className={input} rows={5} disabled={disabled} value={JSON.stringify(item.examples || [], null, 2)} onChange={(e) => updateArray(index, 'examples', e.target.value)} /></label><label className="text-xs">FAQs JSON<textarea className={input} rows={5} disabled={disabled} value={JSON.stringify(item.faqs || [], null, 2)} onChange={(e) => updateArray(index, 'faqs', e.target.value)} /></label><label className="text-xs">Screenshots/media JSON<textarea className={input} rows={5} disabled={disabled} value={JSON.stringify(item.media || [], null, 2)} onChange={(e) => updateArray(index, 'media', e.target.value)} /></label></div></details></div>)}</div><button type="button" disabled={disabled || saving} onClick={onSave} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save AI documentation'}</button></div>;
}

function MessagesPanel() {
  const notif = useNotifications();
  const [rows, setRows] = useState([]);
  const [persisted, setPersisted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.messages(200);
      setRows(data.items || []);
      setPersisted(data.persisted);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load messages.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleRead = async (msg) => {
    try {
      const updated = await adminApi.markMessage(msg._id, !msg.read);
      setRows((prev) => prev.map((m) => (m._id === msg._id ? { ...m, ...updated } : m)));
    } catch (e) {
      notif.error(e.message || 'Update failed.');
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this message permanently?')) return;
    try {
      await adminApi.deleteMessage(id);
      setRows((prev) => prev.filter((m) => m._id !== id));
      notif.success('Message deleted.');
    } catch (e) {
      notif.error(e.message || 'Delete failed.');
    }
  };

  if (loading) return <Loading />;
  if (err) return <ErrorNote message={err} onRetry={load} />;

  return (
    <Section title="Contact inbox" onReload={load}>
      {!persisted ? (
        <InfoNote>The inbox is empty because no database is connected — contact submissions are stored in MongoDB.</InfoNote>
      ) : null}
      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400 dark:border-ink-800">
          No messages yet. Submissions from the Contact form appear here.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => {
            const open = openId === m._id;
            return (
              <li key={m._id} className={`rounded-xl border bg-white p-4 dark:bg-ink-900 ${m.read ? 'border-slate-200 dark:border-ink-800' : 'border-brand-300 dark:border-brand-500/40'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => setOpenId(open ? null : m._id)} className="focus-ring flex flex-1 items-center gap-2 text-left">
                    {!m.read ? <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" title="Unread" /> : <Mail size={15} className="shrink-0 text-slate-400" />}
                    <span className="font-medium text-slate-800 dark:text-slate-100">{m.subject || '(no subject)'}</span>
                    <span className="text-xs text-slate-400">· {m.name} &lt;{m.email}&gt;</span>
                  </button>
                  <span className="text-xs text-slate-400">{new Date(m.createdAt).toLocaleString()}</span>
                  <div className="ml-1 flex items-center gap-1">
                    <button type="button" onClick={() => toggleRead(m)} className="focus-ring rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800">
                      {m.read ? 'Unread' : 'Read'}
                    </button>
                    <a href={`mailto:${m.email}?subject=${encodeURIComponent('Re: ' + (m.subject || 'StackAmit-IDE'))}`} className="focus-ring rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-500/10 dark:text-brand-300">
                      Reply
                    </a>
                    <button type="button" onClick={() => remove(m._id)} aria-label="Delete" className="focus-ring rounded-lg p-1.5 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400">
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
                {open ? (
                  <p className="mt-3 whitespace-pre-wrap border-t border-slate-100 pt-3 text-sm leading-relaxed text-slate-600 dark:border-ink-800 dark:text-slate-300">{m.message}</p>
                ) : (
                  <p className="mt-1 truncate text-sm text-slate-400">{m.message}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/* ---------- small shared UI ---------- */

function Section({ title, onReload, children }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        {onReload ? (
          <button type="button" onClick={onReload} className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-ink-800">
            <RefreshCw size={14} /> Refresh
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-ink-700'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
      <Loader2 className="animate-spin" size={20} /> Loading…
    </div>
  );
}

function ErrorNote({ message, onRetry }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-700 dark:text-rose-300">
      <XCircle size={20} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium">{message}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="focus-ring mt-2 rounded-lg bg-rose-500/20 px-3 py-1 text-xs font-medium hover:bg-rose-500/30">
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

function InfoNote({ children }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {children}
    </div>
  );
}
