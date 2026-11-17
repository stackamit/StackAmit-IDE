/**
 * Java dependency state (Zustand), kept separate from the editor store so the
 * feature owns its own slice and never disturbs tabs/files/themes.
 *
 * Everything is namespaced by a `projectKey` (the opened workspace root, or a
 * stable buffer key when no folder is open): dependencies are a per-project
 * decision, never global. Only the *added* coordinates persist; resolution
 * progress and transient status live in memory.
 *
 * This store holds intent and results — it never downloads. The actual resolve
 * is performed by `useIdeActions` through the Desktop `javaDeps` bridge, and the
 * outcome is written back here for the panel to render.
 */
import { create } from 'zustand';
import { getById } from '../data/javaLibraryCatalog.js';

const DEP_KEY = 'stackamit:java-dependencies';

// projectKey -> [ { id, coordinate } ] — the user's explicit additions.
function loadAll() {
  try {
    const raw = window.localStorage.getItem(DEP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function persist(byProjectAdded) {
  try {
    // Store only the durable part (added coordinates), not transient status.
    const slim = {};
    for (const [k, v] of Object.entries(byProjectAdded)) {
      if (v && v.added && v.added.length) slim[k] = { added: v.added.map(({ id, coordinate }) => ({ id, coordinate })) };
    }
    window.localStorage.setItem(DEP_KEY, JSON.stringify(slim));
  } catch {
    /* ignore */
  }
}

const EMPTY_PROJECT = {
  added: [], // [{ id, coordinate }]
  suggestions: [], // [{ id, coordinate, fqn }] detected but not yet added
  dismissed: [], // fqn strings the user chose not to be reminded about
  detection: null, // last analyzeJavaImports() summary
  status: 'idle', // idle | resolving | ready | error
  progress: null, // { message, completed, total, phase }
  result: null, // last resolve outcome (classpath/resolved/missing/errors)
  offline: false, // resolve ran using cache only
  fromCacheOnly: false,
  error: null, // string message
};

function blank() {
  return { ...EMPTY_PROJECT, added: [], suggestions: [], dismissed: [] };
}

const stored = loadAll();

export const useDependencyStore = create((set, get) => {
  // The slice for a project: an existing one, or a fresh blank seeded with any
  // persisted `added`. Never mutates state — callers via patch() write it back.
  const sliceFor = (all, projectKey) => {
    if (all[projectKey]) return all[projectKey];
    const base = blank();
    const seeded = stored[projectKey];
    if (Array.isArray(seeded?.added)) base.added = seeded.added.filter((a) => a && a.coordinate);
    return base;
  };

  const patch = (projectKey, changes) =>
    set((state) => {
      const next = { ...sliceFor(state.byProject, projectKey), ...changes };
      const byProject = { ...state.byProject, [projectKey]: next };
      if ('added' in changes) persist(byProject);
      return { byProject };
    });

  return {
    byProject: (() => {
      const merged = {};
      for (const [k, v] of Object.entries(stored)) {
        merged[k] = { ...blank(), ...(v && v.added ? { added: v.added.filter((a) => a && a.coordinate) } : {}) };
      }
      return merged;
    })(),

    /** Snapshot for a project (creating its slice lazily). */
    selectProject: (projectKey) => sliceFor(get().byProject, projectKey),

    /** Replace the current import-detection result for a project. */
    setDetection: (projectKey, analysis) => {
      const current = sliceFor(get().byProject, projectKey);
      const dismissed = current.dismissed || [];
      const addedIds = new Set((current.added || []).map((a) => a.coordinate));
      const suggestions = [];
      for (const rec of analysis?.catalog || []) {
        // A catalog import already added (by coordinate) needs no suggestion.
        const entry = rec.catalog?.[0];
        if (!entry) continue;
        if (addedIds.has(entry.coordinate)) continue;
        if (dismissed.includes(rec.fqn)) continue;
        if (suggestions.some((s) => s.id === entry.id)) continue;
        suggestions.push({ id: entry.id, coordinate: entry.coordinate, fqn: rec.fqn });
      }
      patch(projectKey, { detection: summarize(analysis), suggestions });
    },

    /** Explicitly add a catalog entry (or a manual coordinate) to the project. */
    addDependency: (projectKey, idOrCoordinate) => {
      const current = sliceFor(get().byProject, projectKey);
      let entry = { id: null, coordinate: null };
      const byId = getById(idOrCoordinate);
      if (byId) {
        entry = { id: byId.id, coordinate: byId.coordinate };
      } else if (typeof idOrCoordinate === 'string' && idOrCoordinate.includes(':')) {
        entry = { id: null, coordinate: idOrCoordinate };
      }
      if (!entry.coordinate) return;
      if (current.added.some((a) => a.coordinate === entry.coordinate)) return;
      patch(projectKey, { added: [...current.added, entry], status: 'idle', result: null });
    },

    removeDependency: (projectKey, coordinate) => {
      const current = sliceFor(get().byProject, projectKey);
      patch(projectKey, {
        added: current.added.filter((a) => a.coordinate !== coordinate),
        status: 'idle',
        result: null,
      });
    },

    /** Stop suggesting a specific import (user declined; persists in-session). */
    dismissSuggestion: (projectKey, fqn) => {
      const current = sliceFor(get().byProject, projectKey);
      const suggestions = current.suggestions.filter((s) => s.fqn !== fqn);
      patch(projectKey, { suggestions, dismissed: [...new Set([...current.dismissed, fqn])] });
    },

    startResolve: (projectKey) =>
      patch(projectKey, { status: 'resolving', error: null, progress: { phase: 'start', message: 'Resolving…', completed: 0 } }),

    setProgress: (projectKey, progress) => patch(projectKey, { progress }),

    finishResolve: (projectKey, result, { offline = false } = {}) => {
      const ok = result?.ok;
      patch(projectKey, {
        status: ok ? 'ready' : 'error',
        result,
        offline,
        fromCacheOnly: Boolean(result?.fromCacheOnly),
        progress: null,
        ...(ok ? {} : { error: firstError(result) }),
      });
    },

    resolveError: (projectKey, message) => patch(projectKey, { status: 'error', error: String(message || 'Resolution failed'), progress: null }),

    clearStatus: (projectKey) => patch(projectKey, { status: 'idle', error: null, result: null, progress: null }),

    /** Absolute JAR paths to hand the Desktop run, or [] when unresolved. */
    classpathFor: (projectKey) => {
      const cur = get().byProject[projectKey];
      return cur?.status === 'ready' && cur.result?.classpath ? cur.result.classpath : [];
    },
  };
});

function summarize(analysis) {
  if (!analysis) return null;
  return {
    externalCount: (analysis.catalog?.length || 0) + (analysis.unknown?.length || 0),
    catalogCount: analysis.catalog?.length || 0,
    unknown: (analysis.unknown || []).map((r) => r.fqn),
    unresolved: (analysis.unresolved || []).map((r) => ({ fqn: r.fqn, kind: r.kind })),
  };
}

function firstError(result) {
  if (!result) return 'No result';
  if (result.errors?.length) return result.errors[0].message || result.errors[0].coordinate;
  if (result.missing?.length) return `Could not resolve ${result.missing.length} dependency(ies)`;
  return 'Dependency resolution did not complete';
}
