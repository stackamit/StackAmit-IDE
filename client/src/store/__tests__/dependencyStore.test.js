import { describe, it, expect, beforeEach } from 'vitest';
import { useDependencyStore } from '../dependencyStore.js';

/**
 * The dependency store holds *intent* (added coordinates, dismissals) and the
 * last resolve outcome — it never downloads. These tests pin the state machine
 * the panel and the run path rely on, using a per-test project key so slices do
 * not bleed into one another.
 */

const KEY = 'proj-test';

function reset() {
  // Drop any persisted additions and start each case from a clean slice.
  window.localStorage.clear();
  useDependencyStore.setState({ byProject: {} });
}

describe('dependencyStore', () => {
  beforeEach(reset);

  it('starts empty and idle', () => {
    const s = useDependencyStore.getState().selectProject(KEY);
    expect(s.added).toEqual([]);
    expect(s.status).toBe('idle');
  });

  it('adds a catalog dependency by id and de-duplicates by coordinate (req: explicit add)', () => {
    const st = useDependencyStore.getState();
    st.addDependency(KEY, 'commons-lang3');
    let s = useDependencyStore.getState().selectProject(KEY);
    expect(s.added).toHaveLength(1);
    expect(s.added[0].coordinate).toBe('org.apache.commons:commons-lang3:3.17.0');
    // Adding the same id again is a no-op.
    useDependencyStore.getState().addDependency(KEY, 'commons-lang3');
    s = useDependencyStore.getState().selectProject(KEY);
    expect(s.added).toHaveLength(1);
  });

  it('adds a manual coordinate that is not in the catalog', () => {
    useDependencyStore.getState().addDependency(KEY, 'com.acme:widget:1.2.3');
    const s = useDependencyStore.getState().selectProject(KEY);
    expect(s.added[0]).toEqual({ id: null, coordinate: 'com.acme:widget:1.2.3' });
  });

  it('ignores a non-coordinate, non-id value', () => {
    useDependencyStore.getState().addDependency(KEY, 'not-a-coordinate');
    expect(useDependencyStore.getState().selectProject(KEY).added).toEqual([]);
  });

  it('removes a dependency and resets transient status', () => {
    const st = useDependencyStore.getState();
    st.addDependency(KEY, 'guava');
    st.removeDependency(KEY, 'com.google.guava:guava:33.4.8-jre');
    const s = useDependencyStore.getState().selectProject(KEY);
    expect(s.added).toEqual([]);
    expect(s.status).toBe('idle');
  });

  it('builds suggestions from detection, skipping already-added and dismissed', () => {
    const st = useDependencyStore.getState();
    // Pre-add one coordinate so its import should not be suggested.
    st.addDependency(KEY, 'commons-lang3');
    st.setDetection(KEY, {
      catalog: [
        { fqn: 'org.apache.commons.lang3.StringUtils', catalog: [{ id: 'commons-lang3', coordinate: 'org.apache.commons:commons-lang3:3.17.0' }] },
        { fqn: 'com.google.common.collect.ImmutableList', catalog: [{ id: 'guava', coordinate: 'com.google.guava:guava:33.4.8-jre' }] },
      ],
      unknown: [],
    });
    let s = useDependencyStore.getState().selectProject(KEY);
    // Only guava is suggested (commons-lang3 is already added).
    expect(s.suggestions.map((x) => x.id)).toEqual(['guava']);

    // Dismissing it removes the suggestion and remembers the dismissal.
    useDependencyStore.getState().dismissSuggestion(KEY, 'com.google.common.collect.ImmutableList');
    s = useDependencyStore.getState().selectProject(KEY);
    expect(s.suggestions).toEqual([]);
    expect(s.dismissed).toContain('com.google.common.collect.ImmutableList');
  });

  it('runs the resolve status lifecycle and exposes a classpath only when ready', () => {
    const st = useDependencyStore.getState();
    st.addDependency(KEY, 'commons-lang3');

    st.startResolve(KEY);
    expect(useDependencyStore.getState().selectProject(KEY).status).toBe('resolving');

    st.setProgress(KEY, { phase: 'fetch', message: 'Downloading…', completed: 1, total: 1 });
    expect(useDependencyStore.getState().selectProject(KEY).progress.message).toBe('Downloading…');

    st.finishResolve(KEY, { ok: true, classpath: ['/home/.m2/repo/commons-lang3.jar'], resolved: [{ coordinate: 'x' }], fromCacheOnly: true });
    let s = useDependencyStore.getState().selectProject(KEY);
    expect(s.status).toBe('ready');
    expect(s.fromCacheOnly).toBe(true);
    expect(useDependencyStore.getState().classpathFor(KEY)).toEqual(['/home/.m2/repo/commons-lang3.jar']);

    // An errored resolve yields no classpath.
    st.finishResolve(KEY, { ok: false, errors: [{ coordinate: 'a:b:1', message: 'boom' }], classpath: [] });
    s = useDependencyStore.getState().selectProject(KEY);
    expect(s.status).toBe('error');
    expect(s.error).toBe('boom');
    expect(useDependencyStore.getState().classpathFor(KEY)).toEqual([]);
  });

  it('classpathFor returns [] while resolving or after an edit (unresolved)', () => {
    const st = useDependencyStore.getState();
    st.addDependency(KEY, 'guava');
    st.startResolve(KEY);
    expect(useDependencyStore.getState().classpathFor(KEY)).toEqual([]);
  });

  it('persists only added coordinates, not transient status', () => {
    const st = useDependencyStore.getState();
    st.addDependency(KEY, 'commons-lang3');
    st.startResolve(KEY);
    const raw = JSON.parse(window.localStorage.getItem('stackamit:java-dependencies'));
    expect(raw[KEY].added).toHaveLength(1);
    expect(raw[KEY].status).toBeUndefined();
  });
});
