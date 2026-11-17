import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ideStore pulls in the Monaco theme registry, which imports monaco-editor —
// that cannot load under jsdom. The dependency panel never uses themes, so it is
// stubbed to a plain list exactly as the other ide-component suites do.
vi.mock('../../../monaco/themes.js', () => ({
  DEFAULT_THEME_ID: 'stackamit-dark-modern',
  THEMES: [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
  PACK_THEMES: [],
  getThemes: () => [{ id: 'stackamit-dark-modern', label: 'StackAmit Dark Modern', ui: 'dark' }],
}));

import JavaDependenciesPanel from '../JavaDependenciesPanel.jsx';
import { useDependencyStore } from '../../../store/dependencyStore.js';
import { useIdeStore } from '../../../store/ideStore.js';
import { workspace } from '../../../services/workspace.js';

/**
 * The Java Dependencies panel is where a user turns an import into a managed
 * dependency. Its promises are behavioral, so they are tested behaviorally:
 *  - Web Mode tells the truth about provider limits (reqs 16, 17);
 *  - an Add is always explicit; a suggestion is never auto-added;
 *  - nothing downloads on typing — a Resolve is a deliberate action and is
 *    disabled entirely in the browser.
 */

const PROJECT = '/workspace/demo';

const actions = {
  detectJavaProjectImports: vi.fn(),
  resolveJavaProject: vi.fn().mockResolvedValue({ ok: true, classpath: [] }),
  clearJavaProjectCache: vi.fn(),
  javaDepsCacheStatus: vi.fn().mockResolvedValue({ ok: true, exists: false }),
};

function freshStore() {
  window.localStorage.clear();
  useDependencyStore.setState({ byProject: {} });
  useIdeStore.setState({ root: PROJECT, activePath: `${PROJECT}/Main.java`, docs: {} });
}

const originalMode = workspace.mode;
function asDesktop() {
  Object.defineProperty(workspace, 'mode', { value: 'desktop', configurable: true, writable: true });
}
function asWeb() {
  Object.defineProperty(workspace, 'mode', { value: 'web', configurable: true, writable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  freshStore();
});

afterEach(() => {
  Object.defineProperty(workspace, 'mode', { value: originalMode, configurable: true, writable: true });
});

describe('JavaDependenciesPanel — Web Mode honesty (reqs 16, 17)', () => {
  it('explains that the browser provider cannot add Maven dependencies', () => {
    asWeb();
    render(<JavaDependenciesPanel actions={actions} />);
    const banner = screen.getByText(/cannot add Maven dependencies/i);
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(/Desktop Mode/);
  });

  it('disables Resolve in Web Mode (no download is pretend-offered)', () => {
    asWeb();
    // Add a dependency directly to the store so the Added tab has content.
    useDependencyStore.getState().addDependency(PROJECT, 'commons-lang3');
    render(<JavaDependenciesPanel actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /^added/i }));
    const resolve = screen.getByRole('button', { name: /resolve/i });
    expect(resolve.disabled).toBe(true);
    expect(actions.resolveJavaProject).not.toHaveBeenCalled();
  });
});

describe('JavaDependenciesPanel — explicit add/remove', () => {
  beforeEach(asDesktop);

  it('adds a catalog library only when the Add button is pressed', () => {
    render(<JavaDependenciesPanel actions={actions} />);
    // Search narrows the list; no dependency exists until Add is clicked.
    fireEvent.change(screen.getByRole('textbox', { name: /search java libraries/i }), { target: { value: 'commons-lang3' } });
    const addBtn = screen.getByRole('button', { name: /add Apache Commons Lang/i });
    expect(useDependencyStore.getState().selectProject(PROJECT).added).toHaveLength(0);
    fireEvent.click(addBtn);
    const added = useDependencyStore.getState().selectProject(PROJECT).added;
    expect(added).toHaveLength(1);
    expect(added[0].coordinate).toBe('org.apache.commons:commons-lang3:3.17.0');
  });

  it('lists an added dependency and removes it', () => {
    useDependencyStore.getState().addDependency(PROJECT, 'commons-lang3');
    render(<JavaDependenciesPanel actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /^added/i }));
    expect(screen.getByText('org.apache.commons:commons-lang3:3.17.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /remove org.apache.commons:commons-lang3:3.17.0/i }));
    expect(useDependencyStore.getState().selectProject(PROJECT).added).toHaveLength(0);
  });

  it('triggers a resolve for the current project from the Resolve button', () => {
    useDependencyStore.getState().addDependency(PROJECT, 'commons-lang3');
    render(<JavaDependenciesPanel actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /^added/i }));
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
    expect(actions.resolveJavaProject).toHaveBeenCalledWith(PROJECT);
  });
});

describe('JavaDependenciesPanel — detected suggestions are hints, not auto-added', () => {
  it('shows a detected catalog import with Add / Dismiss, adding nothing by itself', () => {
    asDesktop();
    useDependencyStore.getState().setDetection(PROJECT, {
      catalog: [{ fqn: 'com.google.common.collect.ImmutableList', catalog: [{ id: 'guava', coordinate: 'com.google.guava:guava:33.4.8-jre' }] }],
      unknown: [],
      imports: [],
    });
    render(<JavaDependenciesPanel actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /^detected/i }));
    // Present as a suggestion, but the store still has nothing added.
    expect(screen.getByText('com.google.common.collect.ImmutableList')).toBeTruthy();
    expect(useDependencyStore.getState().selectProject(PROJECT).added).toHaveLength(0);
    // Explicit Add now records it.
    fireEvent.click(screen.getByRole('button', { name: /add com.google.guava:guava:33.4.8-jre/i }));
    expect(useDependencyStore.getState().selectProject(PROJECT).added).toHaveLength(1);
  });

  it('lists an unknown import as needing manual handling', () => {
    asDesktop();
    useDependencyStore.getState().setDetection(PROJECT, {
      catalog: [],
      unknown: [{ fqn: 'com.acme.mystery.Thing' }],
      imports: [],
    });
    render(<JavaDependenciesPanel actions={actions} />);
    fireEvent.click(screen.getByRole('button', { name: /^detected/i }));
    // The unknown import is shown and flagged as needing manual handling.
    expect(screen.getByText('com.acme.mystery.Thing')).toBeTruthy();
    expect(screen.getByText(/No catalog match/i)).toBeTruthy();
  });
});

describe('languageCapabilities — Java dependency truthfulness', () => {
  it('marks Java deps as desktop-resolvable and web-unsupported', async () => {
    const { capabilityForMonacoLanguage } = await import('../../../languages/languageCapabilities.js');
    const cap = capabilityForMonacoLanguage('java');
    expect(cap.externalDependencies).toEqual({ desktop: 'resolvable', web: 'unsupported' });
  });
});
