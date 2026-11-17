import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ httpGet: vi.fn(), adminHealth: vi.fn(), adminModels: vi.fn(), authRequest: vi.fn() }));

vi.mock('../api.js', () => ({ http: { get: mocks.httpGet } }));
vi.mock('../admin.js', () => ({ adminApi: { aiHealth: mocks.adminHealth, aiModels: mocks.adminModels } }));

import { getProviderHealth, getProviderModels } from '../ai.js';

describe('desktop user provider requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.stackamit = { auth: { request: mocks.authRequest }, ai: { ollama: { health: vi.fn(), models: vi.fn() } } };
  });

  it('uses the authenticated Electron bridge for cloud provider health checks', async () => {
    mocks.authRequest.mockResolvedValue({ health: { available: true, provider: 'gemini' } });

    await expect(getProviderHealth('gemini')).resolves.toEqual({ available: true, provider: 'gemini' });
    expect(mocks.authRequest).toHaveBeenCalledWith({ path: '/api/user/ai/providers/gemini/test', method: 'GET' });
    expect(mocks.httpGet).not.toHaveBeenCalled();
  });

  it('uses the authenticated Electron bridge for cloud provider model discovery', async () => {
    mocks.authRequest.mockResolvedValue({ models: [{ id: 'gemini-2.5-flash' }] });

    await expect(getProviderModels('gemini')).resolves.toEqual([{ id: 'gemini-2.5-flash' }]);
    expect(mocks.authRequest).toHaveBeenCalledWith({ path: '/api/user/ai/providers/gemini/models', method: 'GET' });
    expect(mocks.httpGet).not.toHaveBeenCalled();
  });
});
