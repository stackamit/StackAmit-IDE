import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

const NotificationContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  info: 'border-brand-500/40 bg-brand-500/10 text-brand-700 dark:text-brand-300',
};

let counter = 0;

export function NotificationProvider({ children }) {
  const [items, setItems] = useState([]);

  const dismiss = useCallback((id) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const push = useCallback(
    (type, message, { duration = 5000 } = {}) => {
      const id = ++counter;
      setItems((prev) => [...prev, { id, type, message }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      notify: push,
      dismiss,
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, { duration: 7000, ...o }),
      warning: (m, o) => push('warning', m, o),
      info: (m, o) => push('info', m, o),
    }),
    [push, dismiss],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2" aria-live="polite">
        {items.map((n) => {
          const Icon = ICONS[n.type] || Info;
          return (
            <div
              key={n.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur transition ${STYLES[n.type]}`}
            >
              <Icon size={18} className="mt-0.5 shrink-0" />
              <span className="flex-1 leading-snug">{n.message}</span>
              <button
                type="button"
                onClick={() => dismiss(n.id)}
                className="focus-ring shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within a NotificationProvider');
  return ctx;
}
