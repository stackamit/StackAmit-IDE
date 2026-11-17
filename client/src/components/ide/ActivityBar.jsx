import { Files, Search, GitBranch, Bug, Puzzle, Settings, BookOpen, Package } from 'lucide-react';
import { useIdeStore } from '../../store/ideStore.js';

const ITEMS = [
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'scm', label: 'Source Control (placeholder)', icon: GitBranch },
  { id: 'debug', label: 'Run and Debug (placeholder)', icon: Bug },
  { id: 'extensions', label: 'Extensions', icon: Puzzle },
  { id: 'languages', label: 'Languages & capabilities', icon: BookOpen },
  { id: 'javaDeps', label: 'Java Dependencies', icon: Package },
];

/** VS Code-style activity bar. Bottom entry opens the Settings view. */
export default function ActivityBar() {
  const activityView = useIdeStore((s) => s.activityView);
  const setActivityView = useIdeStore((s) => s.setActivityView);
  const sidebarVisible = useIdeStore((s) => s.sidebarVisible);

  const pick = (id) => {
    if (id === activityView && sidebarVisible) useIdeStore.getState().toggleSidebar();
    else setActivityView(id);
  };

  return (
    <nav
      aria-label="Activity Bar"
      className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-white/10 bg-ink-900 py-2 dark:bg-[#141821]"
    >
      <div className="flex flex-col items-center gap-1">
        {ITEMS.map(({ id, label, icon: Icon }) => {
          const active = activityView === id && sidebarVisible;
          return (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={active}
              onClick={() => pick(id)}
              className={`focus-ring relative flex h-11 w-11 items-center justify-center rounded transition ${
                active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {active ? <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded bg-brand-400" /> : null}
              <Icon size={22} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => pick('settings')}
        className={`focus-ring flex h-11 w-11 items-center justify-center rounded transition ${
          activityView === 'settings' && sidebarVisible ? 'text-white' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Settings size={22} />
      </button>
    </nav>
  );
}
