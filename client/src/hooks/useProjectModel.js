import { useCallback, useEffect, useRef } from 'react';
import { workspace } from '../services/workspace.js';
import { useIdeStore } from '../store/ideStore.js';
import { detectProject, projectDiagnostics } from '../utils/projectModel.js';

// Descriptor files decide what a project is; the source files are only read to
// check what they import. Both are capped so a huge folder cannot be scanned.
const DESCRIPTORS = ['package.json', 'tsconfig.json', 'index.html'];
const MAX_SOURCE_FILES = 120;

async function listFiles(root, cap = 800) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < cap) {
    const dir = stack.pop();
    const res = await workspace.readDirectory(dir);
    if (!res?.ok) continue;
    for (const e of res.entries || []) {
      if (e.isDirectory) {
        // Neither a dependency tree nor build output describes the project.
        if (/(^|[\\/])(node_modules|dist|build|\.git)$/.test(e.path)) continue;
        stack.push(e.path);
      } else {
        out.push(e.path);
      }
    }
  }
  return out;
}

/**
 * The Web Mode project model: reads what the workspace declares and pushes the
 * resulting diagnostics into the Problems panel and the editor.
 *
 * Desktop Mode is deliberately untouched — it has a real package manager, a
 * real tsc and a language server, and its own run already reports these
 * problems from the compiler rather than from an app-side guess.
 */
export function useProjectModel({ applyMarkers } = {}) {
  const root = useIdeStore((s) => s.root);
  const treeRevision = useIdeStore((s) => s.treeRevision);
  const docs = useIdeStore((s) => s.docs);
  const marked = useRef(new Set());
  const timer = useRef(0);

  const rescan = useCallback(async () => {
    if (!root || workspace.mode !== 'web') {
      useIdeStore.getState().setProject(null);
      return null;
    }
    const paths = await listFiles(root);
    const descriptorPaths = paths.filter((p) => DESCRIPTORS.includes(String(p).split(/[\\/]/).pop().toLowerCase()));
    const files = [];
    for (const p of descriptorPaths) {
      const res = await workspace.readFile(p);
      if (res?.ok) files.push({ path: p, content: res.content });
    }
    const detected = detectProject(files);
    // Held in the store, so the preview panel and the status bar report the very
    // same project the diagnostics were derived from.
    useIdeStore.getState().setProject(detected);

    // Only the open editors are diagnosed, plus the ones already showing
    // problems — a browser scan of a whole imported tree on every keystroke
    // would be the expensive part, not the checking.
    const openPaths = Object.keys(docs);
    const candidates = [...new Set([...openPaths, ...marked.current, ...paths.filter((p) => /\.(m|c)?[jt]sx?$/i.test(p)).slice(0, MAX_SOURCE_FILES)])];
    const documents = [];
    for (const p of candidates) {
      if (docs[p]) {
        documents.push({ path: p, content: docs[p].content });
        continue;
      }
      if (!/\.(m|c)?[jt]sx?$/i.test(p)) continue;
      const res = await workspace.readFile(p);
      if (res?.ok) documents.push({ path: p, content: res.content });
    }
    const markers = projectDiagnostics({ project: detected, documents });
    const byPath = new Map();
    for (const m of markers) {
      if (!byPath.has(m.path)) byPath.set(m.path, []);
      byPath.get(m.path).push(m);
    }
    for (const p of marked.current) {
      if (!byPath.has(p)) applyMarkers?.(p, []);
    }
    marked.current = new Set(byPath.keys());
    for (const [p, list] of byPath) applyMarkers?.(p, list);
    return detected;
  }, [root, docs, applyMarkers]);

  // Debounced: a keystroke re-scans at most a second later, and the tree only
  // matters when files were created, renamed or deleted.
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      rescan().catch(() => {});
    }, 400);
    return () => clearTimeout(timer.current);
  }, [root, treeRevision, rescan]);

  useEffect(() => {
    // Leaving the workspace (or a reload) must not leave stale markers behind.
    marked.current = new Set();
  }, [root]);

  return { rescan };
}

export default useProjectModel;
