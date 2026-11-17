import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// The hook caches at module scope, so every test loads a fresh module graph.
const mockApi = vi.hoisted(() => ({ siteContent: vi.fn() }));
const mockAvailability = vi.hoisted(() => ({ current: { ok: true, target: 'http://api.test' } }));

vi.mock('../../services/api.js', () => ({
  api: mockApi,
  remoteRunAvailability: () => mockAvailability.current,
}));

async function loadHook() {
  vi.resetModules();
  const mod = await import('../useSiteContent.js');
  return mod.useSiteContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAvailability.current = { ok: true, target: 'http://api.test' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * An offline desktop build used to fire `/api/site/content` against the
 * filesystem (file:// origin), which the production console logs as a failed
 * request on every launch. The hook must fall back to the built-in copy
 * without making the doomed call, while a reachable server is still queried.
 */
describe('useSiteContent', () => {
  it('does not request site content when no API server is reachable', async () => {
    mockAvailability.current = { ok: false, code: 'NO_API_SERVER' };
    const useSiteContent = await loadHook();

    const { result } = renderHook(() => useSiteContent());
    await waitFor(() => expect(result.current.home).toBeDefined());

    expect(mockApi.siteContent).not.toHaveBeenCalled();
    const defaults = await import('../../content/siteContent.js');
    expect(result.current).toEqual(defaults.DEFAULT_CONTENT);
  });

  it('still fetches from a reachable server and merges server copy over defaults', async () => {
    mockApi.siteContent.mockResolvedValue({ home: { heroTitle: 'Server Title' } });
    const useSiteContent = await loadHook();

    const { result } = renderHook(() => useSiteContent());
    await waitFor(() => expect(result.current.home.heroTitle).toBe('Server Title'));

    expect(mockApi.siteContent).toHaveBeenCalledTimes(1);
    const defaults = await import('../../content/siteContent.js');
    expect(result.current.home.badge).toBe(defaults.DEFAULT_CONTENT.home.badge);
  });

  it('falls back to defaults when the request fails', async () => {
    mockApi.siteContent.mockRejectedValue(new Error('boom'));
    const useSiteContent = await loadHook();

    const { result } = renderHook(() => useSiteContent());
    await waitFor(() => expect(result.current.home).toBeDefined());

    const defaults = await import('../../content/siteContent.js');
    expect(result.current).toEqual(defaults.DEFAULT_CONTENT);
  });
});
