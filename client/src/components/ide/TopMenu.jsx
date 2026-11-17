import { useEffect, useRef, useState } from 'react';
import {
  FilePlus2, FolderOpen, Save, X, Undo2, Redo2, Copy, Scissors, Clipboard,
  Search as SearchIcon, Replace, List, PanelBottom, PanelRight, Columns2,
  Play, Terminal as TerminalIcon, Command, HelpCircle, ChevronLeft, BookOpen, LogIn, LogOut, UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useIdeStore } from '../../store/ideStore.js';
import { workspace } from '../../services/workspace.js';
import { useUserAuth } from '../../context/UserAuthContext.jsx';

/**
 * Top menu bar. Every item performs its stated action (Monaco commands via the
 * editor ref, workspace actions, or panel toggles) — no decorative buttons.
 */
export default function TopMenu({ actions, editorRef, openPalette, openQuickOpen, onRequestAI }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);
  const barRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) setOpen(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const run = (fn) => () => {
    setOpen(null);
    const ed = editorRef.current;
    if (typeof fn === 'function') fn(ed);
    else if (fn?.command && ed) ed.getAction(fn.command)?.run();
  };

  const store = useIdeStore.getState;
  const isDesktop = workspace.mode === 'desktop';

  const MENUS = {
    File: [
      { label: 'New File', icon: FilePlus2, run: () => store().newUntitled() },
      // One folder entry per mode: in the browser "Open Folder…" is the real
      // File System Access import, and the virtual workspace says so itself.
      ...(isDesktop
        ? [{ label: 'Open Workspace…', icon: FolderOpen, run: () => actions.openWorkspace() }]
        : [
            { label: 'Open Folder…', icon: FolderOpen, run: () => actions.importFolder() },
            { label: 'Use Browser Workspace', icon: FolderOpen, run: () => actions.openWorkspace() },
          ]),
      { sep: true },
      { label: 'Save', icon: Save, shortcut: 'Ctrl+S', run: () => actions.saveActive() },
      { label: 'Save As…', icon: Save, shortcut: 'Ctrl+Shift+S', run: () => actions.saveAs() },
      { label: 'Close Editor', icon: X, shortcut: 'Ctrl+W', run: () => { const p = store().activePath; if (p) actions.closeTab(p); } },
      { sep: true },
      { label: 'Back to Home', icon: ChevronLeft, run: () => navigate('/') },
    ],
    Edit: [
      { label: 'Undo', icon: Undo2, shortcut: 'Ctrl+Z', command: 'undo' },
      { label: 'Redo', icon: Redo2, shortcut: 'Ctrl+Y', command: 'redo' },
      { sep: true },
      { label: 'Find', icon: SearchIcon, shortcut: 'Ctrl+F', command: 'actions.find' },
      { label: 'Replace', icon: Replace, shortcut: 'Ctrl+H', command: 'editor.action.startFindReplaceAction' },
      { sep: true },
      { label: 'Select All', icon: List, shortcut: 'Ctrl+A', command: 'editor.action.selectAll' },
    ],
    Selection: [
      { label: 'Copy', icon: Copy, shortcut: 'Ctrl+C', command: 'editor.action.clipboardCopyAction' },
      { label: 'Cut', icon: Scissors, shortcut: 'Ctrl+X', command: 'editor.action.clipboardCutAction' },
      { label: 'Paste', icon: Clipboard, shortcut: 'Ctrl+V', command: 'editor.action.clipboardPasteAction' },
      { sep: true },
      { label: 'Format Document', icon: List, shortcut: 'Shift+Alt+F', command: 'editor.action.formatDocument' },
    ],
    View: [
      { label: 'Toggle Sidebar', icon: Columns2, shortcut: 'Ctrl+B', run: () => store().toggleSidebar() },
      { label: 'Toggle Panel', icon: PanelBottom, shortcut: 'Ctrl+J', run: () => store().toggleBottomPanel() },
      { label: 'AI Chat / Sign in', icon: PanelRight, shortcut: 'Ctrl+I', run: () => onRequestAI() },
      { sep: true },
      { label: 'Command Palette…', icon: Command, shortcut: 'F1', run: () => openPalette() },
    ],
    Go: [
      { label: 'Go to Line…', icon: List, shortcut: 'Ctrl+G', command: 'editor.action.gotoLine' },
      { label: 'Quick Open…', icon: SearchIcon, shortcut: 'Ctrl+P', run: () => openQuickOpen() },
    ],
    Run: [
      { label: 'Run Active File', icon: Play, shortcut: 'Ctrl+Enter', run: () => actions.runActive() },
      { label: 'Show Output', icon: Play, run: () => store().setBottomTab('output') },
      { sep: true },
      // Capability browser: which languages highlight, lint, run online, or need a
      // local toolchain — driven by the registry, never by a hardcoded list here.
      { label: 'Languages & Capabilities…', icon: BookOpen, run: () => store().setActivityView('languages') },
    ],
    // The browser cannot spawn a shell. The item stays visible with the reason
    // it is unavailable rather than opening a panel that has no terminal in it.
    Terminal: isDesktop
      ? [
          { label: 'New Terminal', icon: TerminalIcon, run: () => store().setBottomTab('terminal') },
          { label: 'Toggle Terminal', icon: TerminalIcon, shortcut: 'Ctrl+`', run: () => store().toggleBottomPanel() },
        ]
      : [
          {
            label: 'New Terminal (desktop app only)',
            icon: TerminalIcon,
            disabled: true,
            note: 'A browser page cannot start a Windows shell. The desktop app runs a real terminal through Electron.',
          },
          { label: 'Show Output', icon: Play, run: () => store().setBottomTab('output') },
        ],
    Help: [
      { label: 'Keyboard Shortcuts', icon: Command, run: () => openPalette() },
      { label: 'About StackAmit-IDE', icon: HelpCircle, run: () => navigate('/about') },
    ],
  };

  const keys = Object.keys(MENUS);

  return (
    <div ref={barRef} className="relative z-40 flex h-9 shrink-0 items-center gap-0.5 border-b border-white/10 bg-ink-900 px-2 text-[13px] dark:bg-[#141821]">
      {keys.map((k) => (
        <div key={k} className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => (o === k ? null : k))}
            onMouseEnter={() => open && setOpen(k)}
            className={`rounded px-2 py-1 ${open === k ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5'}`}
          >
            {k}
          </button>
          {open === k ? (
            <div className="absolute left-0 top-full mt-0.5 min-w-[240px] rounded-md border border-white/15 bg-slate-900 py-1 shadow-xl dark:bg-[#1b1f27]">
              {MENUS[k].map((it, i) =>
                it.sep ? (
                  <div key={`sep-${i}`} className="my-1 border-t border-white/10" />
                ) : (
                  <button
                    key={it.label}
                    type="button"
                    disabled={it.disabled}
                    title={it.disabled ? it.note : undefined}
                    onClick={run(it.command ? it.command : it.run)}
                    className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] ${
                      it.disabled
                        ? 'cursor-not-allowed text-slate-500'
                        : 'text-slate-200 hover:bg-brand-600/30'
                    }`}
                  >
                    {it.icon ? <it.icon size={14} className="shrink-0 text-slate-400" /> : <span className="w-[14px]" />}
                    <span className="truncate">{it.label}</span>
                    {it.shortcut ? <span className="ml-auto pl-4 text-[11px] text-slate-500">{it.shortcut}</span> : null}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
      ))}
      <AccountEntry />
    </div>
  );
}

function AccountEntry() {
  const { user, logout } = useUserAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (!user) return <button type="button" onClick={() => navigate('/account/login', { state: { from: '/ide' } })} className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] text-slate-300 hover:bg-white/10"><LogIn size={14} />Sign in</button>;
  return <div className="relative ml-auto"><button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] text-slate-200 hover:bg-white/10" aria-expanded={open}><span className="grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white">{(user.displayName || user.email || 'U').slice(0, 1).toUpperCase()}</span>{user.displayName || 'Account'}</button>{open ? <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-md border border-white/15 bg-slate-900 py-1 shadow-xl"><button type="button" onClick={() => navigate('/account/dashboard')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-brand-600/30"><UserRound size={14} />Account Dashboard</button><button type="button" onClick={() => navigate('/account/dashboard')} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-brand-600/30"><PanelRight size={14} />AI Providers & Settings</button><button type="button" onClick={async () => { await logout(); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose-300 hover:bg-rose-600/20"><LogOut size={14} />Logout</button></div> : null}</div>;
}
