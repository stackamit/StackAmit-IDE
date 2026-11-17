import { describe, it, expect, vi } from 'vitest';
import {
  EXTENSIONS,
  CATEGORIES,
  builtinExtensionDefaults,
  extensionById,
  activeExtensionIds,
  curatedAdapter,
  createRegistryAdapter,
  listCatalog,
  resolveExtensionState,
  compareVersions,
  updatesAvailable,
} from '../registry.js';

describe('extension registry', () => {
  it('declares well-formed, uniquely-identified extensions', () => {
    expect(EXTENSIONS.length).toBeGreaterThan(0);
    const ids = new Set();
    for (const e of EXTENSIONS) {
      expect(typeof e.id).toBe('string');
      expect(e.id).toMatch(/^[a-z0-9-]+$/);
      expect(e.name).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(CATEGORIES).toContain(e.category);
      expect(Array.isArray(e.keywords)).toBe(true);
      expect(typeof e.activate).toBe('function');
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
  });

  it('extensionById resolves and returns null for unknown', () => {
    expect(extensionById('prettier')?.name).toBe('Prettier');
    expect(extensionById('nope')).toBeNull();
  });

  it('activeExtensionIds only returns installed AND enabled, in registry order', () => {
    const state = {
      'sticky-scroll': { installed: true, enabled: true },
      prettier: { installed: true, enabled: true },
      'todo-tree': { installed: true, enabled: false }, // enabled:false → skip
      'indent-guides': { installed: false, enabled: true }, // not installed → skip
    };
    const active = activeExtensionIds(state);
    // Order follows EXTENSIONS declaration order.
    expect(active).toEqual(
      EXTENSIONS.map((e) => e.id).filter((id) => active.includes(id)),
    );
    expect(active).toContain('prettier');
    expect(active).toContain('sticky-scroll');
    expect(active).not.toContain('todo-tree');
    expect(active).not.toContain('indent-guides');
  });

  it('every catalog entry carries license, compatibility and capability metadata', () => {
    for (const e of EXTENSIONS) {
      expect(e.license).toBeTruthy();
      expect(Array.isArray(e.compatibility)).toBe(true);
      expect(e.compatibility.length).toBeGreaterThan(0);
      for (const c of e.compatibility) expect(['web', 'desktop']).toContain(c);
      expect(Array.isArray(e.capabilities)).toBe(true);
    }
  });

  it('curated adapter lists first-party entries with their activate intact', async () => {
    const { entries, errors } = await listCatalog([curatedAdapter]);
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(EXTENSIONS.length);
    expect(entries.every((e) => e.source === 'curated-stackamit' && e.quarantined === false)).toBe(true);
    expect(entries.every((e) => typeof e.activate === 'function')).toBe(true);
  });

  it('foreign adapters are allowed for discovery but code surface is quarantined', async () => {
    const foreign = createRegistryAdapter({
      id: 'demo-registry',
      fetchManifest: async () => ({
        extensions: [
          { id: 'sneaky', name: 'Sneaky', version: '9.9.9', activate: () => alert('pwned') },
          { id: 'nope', name: 'missing version' }, // dropped: no version
        ],
      }),
    });
    const { entries } = await listCatalog([foreign]);
    expect(entries).toHaveLength(1);
    expect(entries[0].quarantined).toBe(true);
    expect(entries[0].activate).toBeUndefined(); // executable surface stripped
  });

  it('curated entries win id collisions and failing adapters surface errors, not crashes', async () => {
    const clash = createRegistryAdapter({
      id: 'clash',
      fetchManifest: async () => [{ id: 'prettier', name: 'Fake Prettier', version: '99.0.0' }],
    });
    const broken = createRegistryAdapter({ id: 'broken', fetchManifest: async () => { throw new Error('offline'); } });
    const { entries, errors } = await listCatalog([clash, broken, curatedAdapter]);
    expect(entries.find((e) => e.id === 'prettier').name).toBe('Prettier'); // curated wins
    expect(errors).toEqual([{ adapter: 'broken', message: 'offline' }]);
  });

  it('compareVersions and updatesAvailable report only real version deltas', () => {
    expect(compareVersions('1.1.0', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.10', '0.9.9')).toBeGreaterThan(0);
    // Against the bundled catalog, same-version installs are "up to date"…
    expect(updatesAvailable([{ id: 'prettier', version: '1.0.0' }], { prettier: { installed: true, version: '1.0.0' } })).toEqual([]);
    // …while an older captured install yields a genuine update entry.
    expect(updatesAvailable([{ id: 'prettier', version: '1.0.0' }], { prettier: { installed: true, version: '0.9.0' } })).toEqual([
      { id: 'prettier', from: '0.9.0', to: '1.0.0', quarantined: false },
    ]);
  });

  it('editor-option extensions apply and revert real Monaco options', () => {
    const updateOptions = vi.fn();
    const editor = { updateOptions };
    extensionById('sticky-scroll').activate({ editor, monaco: {}, store: {} });
    expect(updateOptions).toHaveBeenLastCalledWith({ stickyScroll: { enabled: true } });
    // dispose reverts
    const handle = extensionById('color-highlight').activate({ editor, monaco: {}, store: {} });
    expect(updateOptions).toHaveBeenLastCalledWith({ colorDecorators: true });
    handle.dispose();
    expect(updateOptions).toHaveBeenLastCalledWith({ colorDecorators: false });
  });

  it('extra-themes activate is a safe no-op returning a disposable', () => {
    const handle = extensionById('extra-themes').activate({ editor: {}, monaco: {}, store: {} });
    expect(typeof handle.dispose).toBe('function');
    expect(() => handle.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Built-in extensions: the Explorer icons on a fresh / offline profile
// ---------------------------------------------------------------------------
describe('built-in extension defaults', () => {
  it('ships file-icons installed and enabled, so a fresh profile is not icon-less', () => {
    expect(extensionById('file-icons').builtin).toBe(true);
    expect(activeExtensionIds(resolveExtensionState({}))).toContain('file-icons');
    expect(builtinExtensionDefaults()['file-icons']).toMatchObject({ installed: true, enabled: true });
  });

  it('honors an explicit user choice to turn it off (and never forces it back on)', () => {
    const stored = { 'file-icons': { installed: true, enabled: false } };
    const state = resolveExtensionState(stored);
    expect(state['file-icons'].enabled).toBe(false);
    expect(activeExtensionIds(state)).not.toContain('file-icons');
  });

  it('keeps a stored version/first-run marker instead of overwriting it with the default', () => {
    const state = resolveExtensionState({ 'file-icons': { installed: true, enabled: true, version: '0.9.0' } });
    expect(state['file-icons'].version).toBe('0.9.0');
  });

  it('ignores garbage in the stored profile rather than throwing during load', () => {
    expect(() => resolveExtensionState(undefined)).not.toThrow();
    expect(resolveExtensionState({ prettier: null, 'file-icons': 'yes' })['file-icons']).toMatchObject({ enabled: true });
    expect(resolveExtensionState({ prettier: null }).prettier).toBeUndefined();
  });

  it('only treats first-party curated entries as built-in', () => {
    for (const [id, st] of Object.entries(builtinExtensionDefaults())) {
      expect(extensionById(id)?.publisher, id).toBe('StackAmit');
      expect(st.enabled, id).toBe(true);
    }
  });
});
