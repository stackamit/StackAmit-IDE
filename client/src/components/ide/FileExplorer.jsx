import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, ChevronDown, File as FileIcon, Folder as FolderIcon,
  FolderOpen, RefreshCw, FilePlus2, FolderPlus, Pencil, Trash2, Loader2, FolderInput,
} from 'lucide-react';
import { workspace } from '../../services/workspace.js';
import { useIdeStore } from '../../store/ideStore.js';
import { fileIconMeta, folderColorClass } from '../../utils/fileIcons.js';

function DirNode({ dir, depth, actions, selected, setSelected, reloadNonce, onReload }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileIconsOn = useIdeStore((s) => Boolean(s.extensions['file-icons']?.enabled));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const res = await workspace.readDirectory(dir);
    setLoading(false);
    if (res.ok) setEntries(res.entries);
    else setError(res.message || 'Could not read this folder.');
  }, [dir]);

  useEffect(() => {
    if (expanded) load();
  }, [expanded, load, reloadNonce]);

  const toggle = () => setExpanded((v) => !v);
  const name = dir.split(/[\\/]/).filter(Boolean).pop() || dir;

  return (
    <div role="group">
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={expanded}
        aria-level={depth + 1}
        aria-selected={selected === dir}
        aria-label={`Folder ${name}`}
        data-explorer-path={dir}
        title={dir}
        onClick={toggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
        className={`group flex items-center gap-1 rounded px-1 py-0.5 text-[13px] ${
          selected === dir ? 'bg-brand-600/25 text-white' : 'hover:bg-white/5'
        }`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {expanded ? <ChevronDown size={15} aria-hidden="true" className="shrink-0 opacity-70" /> : <ChevronRight size={15} aria-hidden="true" className="shrink-0 opacity-70" />}
        {(() => {
          const color = fileIconsOn ? folderColorClass(name) : 'text-amber-400/80';
          return expanded
            ? <FolderOpen size={15} aria-hidden="true" className={`shrink-0 ${color}`} />
            : <FolderIcon size={15} aria-hidden="true" className={`shrink-0 ${color}`} />;
        })()}
        <span className="truncate">{name}</span>
        <NodeActions kind="dir" path={dir} actions={actions} onReload={onReload} setSelected={setSelected} />
      </div>
      {expanded ? (
        <div>
          {loading ? (
            <div className="flex items-center gap-2 py-1 text-xs text-slate-400" style={{ paddingLeft: (depth + 1) * 12 + 20 }}>
              <Loader2 size={13} className="animate-spin" /> loading…
            </div>
          ) : null}
          {error ? (
            <div className="py-1 text-xs text-rose-400" style={{ paddingLeft: (depth + 1) * 12 + 20 }}>{error}</div>
          ) : null}
          {entries.map((e) =>
            e.isDirectory ? (
              <DirNode
                key={e.path}
                dir={e.path}
                depth={depth + 1}
                actions={actions}
                selected={selected}
                setSelected={setSelected}
                reloadNonce={reloadNonce}
                onReload={onReload}
              />
            ) : (
              <FileNode
                key={e.path}
                entry={e}
                depth={depth + 1}
                actions={actions}
                selected={selected}
                setSelected={setSelected}
                onReload={onReload}
              />
            ),
          )}
          {!loading && !error && entries.length === 0 ? (
            <div className="py-0.5 text-xs italic text-slate-500" style={{ paddingLeft: (depth + 1) * 12 + 20 }}>
              (empty)
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FileNode({ entry, depth, actions, selected, setSelected, onReload }) {
  const openDocs = useIdeStore((s) => s.docs);
  const activePath = useIdeStore((s) => s.activePath);
  const fileIconsOn = useIdeStore((s) => Boolean(s.extensions['file-icons']?.enabled));
  const isOpen = Boolean(openDocs[entry.path]);
  const isActive = activePath === entry.path;
  const dirty = isOpen && openDocs[entry.path].content !== openDocs[entry.path].savedContent;
  // Providers are expected to hand back `name`, but a missing one must not
  // silently degrade the icon to "unknown" (that looked like a broken icon set).
  const name = entry.name || String(entry.path).split(/[\\/]/).filter(Boolean).pop() || '';

  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-level={depth + 1}
      aria-selected={isActive || selected === entry.path}
      aria-label={`File ${name}`}
      data-explorer-path={entry.path}
      title={entry.path}
      onClick={() => {
        setSelected(entry.path);
        actions.openFileByPath(entry.path);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setSelected(entry.path);
          actions.openFileByPath(entry.path);
        }
      }}
      onDoubleClick={() => actions.openFileByPath(entry.path)}
      className={`group flex items-center gap-1 rounded px-1 py-0.5 text-[13px] ${
        isActive ? 'bg-brand-600/30 text-white' : selected === entry.path ? 'bg-white/8 text-slate-100' : 'hover:bg-white/5'
      }`}
      style={{ paddingLeft: depth * 12 + 20 }}
    >
      {(() => {
        if (fileIconsOn) {
          const { Icon, className } = fileIconMeta(name);
          return <Icon size={14} aria-hidden="true" data-file-icon={name.split('.').pop() || 'file'} className={`shrink-0 ${dirty ? 'text-brand-300' : className}`} />;
        }
        return <FileIcon size={14} aria-hidden="true" className={`shrink-0 ${dirty ? 'text-brand-300' : 'text-slate-400'}`} />;
      })()}
      <span className="truncate">{name}</span>
      {dirty ? <span className="ml-1 h-1.5 w-1.5 rounded-full bg-brand-400" title="Unsaved" /> : null}
      <NodeActions kind="file" path={entry.path} actions={actions} onReload={onReload} setSelected={setSelected} />
    </div>
  );
}

function NodeActions({ kind, path, actions, onReload, setSelected }) {
  return (
    <span className="ml-auto hidden items-center gap-0.5 group-hover:flex">
      <button
        type="button"
        title="Rename (F2)"
        aria-label="Rename"
        onClick={(e) => {
          e.stopPropagation();
          setSelected(path);
          actions.rename(path);
        }}
        className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-slate-100"
      >
        <Pencil size={13} />
      </button>
      <button
        type="button"
        title="Delete"
        aria-label="Delete"
        onClick={(e) => {
          e.stopPropagation();
          actions.remove(path).then((r) => r && r.ok && onReload());
        }}
        className="rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-rose-300"
      >
        <Trash2 size={13} />
      </button>
    </span>
  );
}

export default function FileExplorer({ actions, parentDirForNew }) {
  const root = useIdeStore((s) => s.root);
  const rootName = useIdeStore((s) => s.rootName);
  const treeRevision = useIdeStore((s) => s.treeRevision);
  const selected = useIdeStore((s) => s.selectedPath);
  const setSelected = useIdeStore((s) => s.setSelectedPath);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (selected == null) setSelected(root || '/');
  }, [root, selected, setSelected]);

  const reloadNonce = nonce + treeRevision;

  const targetDir = useMemo(() => {
    if (parentDirForNew) return parentDirForNew;
    if (!selected) return root || '/';
    // If a file is selected, new items go to its parent directory.
    if (selected.includes('.') && !selected.endsWith('/')) return selected.split(/[\\/]/).slice(0, -1).join(workspace.mode === 'web' ? '/' : '\\') || root || '/';
    return selected;
  }, [selected, parentDirForNew, root]);

  const wrappedActions = { ...actions };

  if (!root) {
    return (
      <div className="flex h-full flex-col p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Explorer</div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded border border-dashed border-white/15 p-4 text-center">
          <FolderInput size={26} className="text-slate-500" />
          <p className="text-sm text-slate-300">No folder open</p>
          <p className="text-xs text-slate-500">
            {workspace.mode === 'desktop'
              ? 'Open a workspace folder to edit real files on your computer.'
              : 'Browser mode uses a local workspace. Open a real folder where supported, or create files here.'}
          </p>
          <div className="mt-1 flex flex-col gap-2">
            {/* Same rule as the welcome pane: in the browser the button that says
                "Open Folder…" must run the folder picker, not openWorkspace(). */}
            <button
              type="button"
              onClick={workspace.mode === 'desktop' ? actions.openWorkspace : actions.importFolder}
              className="focus-ring rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-500"
            >
              {workspace.mode === 'desktop' ? 'Open Workspace…' : 'Open Folder…'}
            </button>
            <button
              type="button"
              onClick={actions.newUntitled}
              className="focus-ring rounded border border-white/15 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5"
            >
              New File
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-slate-300" title={root}>
          {rootName}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" title="New File" aria-label="New File" onClick={() => actions.createFile(targetDir)} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100">
            <FilePlus2 size={15} />
          </button>
          <button type="button" title="New Folder" aria-label="New Folder" onClick={() => actions.createDirectory(targetDir)} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100">
            <FolderPlus size={15} />
          </button>
          <button type="button" title="Refresh" aria-label="Refresh" onClick={reload} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-slate-100">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>
      <div className="scroll-slim min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label="File Explorer">
        <DirNode dir={root} depth={0} actions={wrappedActions} selected={selected} setSelected={setSelected} reloadNonce={reloadNonce} onReload={reload} />
      </div>
    </div>
  );
}
