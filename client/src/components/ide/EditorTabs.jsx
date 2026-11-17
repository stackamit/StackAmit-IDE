import { X, Circle, Loader2, AlertTriangle } from 'lucide-react';
import { useIdeStore, saveStateFor } from '../../store/ideStore.js';
import { fileIconMeta } from '../../utils/fileIcons.js';

/** Tab strip with active + per-document save indicators and per-tab close. */
export default function EditorTabs({ actions }) {
  const order = useIdeStore((s) => s.order);
  const docs = useIdeStore((s) => s.docs);
  const activePath = useIdeStore((s) => s.activePath);
  const setActive = useIdeStore((s) => s.setActive);
  const fileIconsOn = useIdeStore((s) => Boolean(s.extensions['file-icons']?.enabled));

  if (!order.length) return null;

  return (
    <div className="scroll-slim flex shrink-0 items-stretch overflow-x-auto border-b border-white/10 bg-ink-900 dark:bg-[#141821]" role="tablist" aria-label="Open editors">
      {order.map((path) => {
        const doc = docs[path];
        if (!doc) return null;
        // 'saved' | 'modified' | 'saving' | 'failed' — derived per document so
        // every tab keeps its own independent save status.
        const state = saveStateFor(doc);
        const unsaved = state !== 'saved';
        const active = path === activePath;
        return (
          <div
            key={path}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => setActive(path)}
            onKeyDown={(e) => e.key === 'Enter' && setActive(path)}
            title={doc.path}
            className={`group flex cursor-pointer items-center gap-2 border-r border-white/10 px-3 py-1.5 text-[13px] select-none ${
              active
                ? 'bg-[#1b1f27] text-white dark:bg-[#1b1f27]'
                : 'bg-ink-900 text-slate-400 hover:text-slate-200 dark:bg-[#141821]'
            }`}
          >
            {active ? <span className="absolute" /> : null}
            {(() => {
              if (!fileIconsOn) return null;
              const { Icon, className } = fileIconMeta(doc.name);
              return <Icon size={13} aria-hidden="true" className={`shrink-0 ${unsaved ? 'text-brand-300' : className}`} />;
            })()}
            <span className="truncate">{doc.name}</span>
            {unsaved ? (
              <button
                type="button"
                aria-label="Close (unsaved)"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.closeTab(path);
                }}
                className={state === 'failed' ? 'text-red-400' : 'text-brand-300'}
                title={
                  state === 'saving'
                    ? 'Saving…'
                    : state === 'failed'
                      ? doc.saveError || 'Save failed'
                      : 'Unsaved changes'
                }
              >
                {state === 'saving' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : state === 'failed' ? (
                  <AlertTriangle size={12} />
                ) : (
                  <Circle size={9} fill="currentColor" strokeWidth={0} />
                )}
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Close ${doc.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  actions.closeTab(path);
                }}
                className="rounded p-0.5 text-slate-500 opacity-0 hover:bg-white/10 hover:text-slate-200 group-hover:opacity-100"
              >
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
