import { http } from './api.js';
import { ensureUserCsrf } from './userCsrf.js';

function desktop() { return typeof window !== 'undefined' && window.stackamit?.isDesktop ? window.stackamit.auth : null; }
async function request(path, method = 'GET', body) { const bridge = desktop(); const result = bridge?.request ? await bridge.request({ path, method, body }) : (await http.request({ url: path, method, data: body, withCredentials: true })).data; if (result?.ok === false) throw new Error(result.message || 'Authenticated request failed.'); return result; }

export async function getUserAiProviders() { return request('/api/user/ai/providers'); }
export async function saveUserAiProvider(provider, payload) { if (desktop()) return (await request(`/api/user/ai/providers/${encodeURIComponent(provider)}`, 'PUT', payload)).provider; const token = await ensureUserCsrf(); const { data } = await http.put(`/api/user/ai/providers/${encodeURIComponent(provider)}`, payload, { withCredentials: true, headers: { 'x-csrf-token': token } }); return data.provider; }
export async function removeUserAiProvider(provider) { if (desktop()) { await request(`/api/user/ai/providers/${encodeURIComponent(provider)}`, 'DELETE'); return; } const token = await ensureUserCsrf(); await http.delete(`/api/user/ai/providers/${encodeURIComponent(provider)}`, { withCredentials: true, headers: { 'x-csrf-token': token } }); }
export async function testUserAiProvider(provider) { return request(`/api/user/ai/providers/${encodeURIComponent(provider)}/test`); }
export async function getUserPlugins() { return request('/api/user/ai/plugins'); }
export async function installUserPlugin(pluginId) { if (desktop()) return (await request(`/api/user/ai/plugins/${encodeURIComponent(pluginId)}/install`, 'POST', {})).installation; const token = await ensureUserCsrf(); const { data } = await http.post(`/api/user/ai/plugins/${encodeURIComponent(pluginId)}/install`, {}, { withCredentials: true, headers: { 'x-csrf-token': token } }); return data.installation; }
export async function uninstallUserPlugin(pluginId) { if (desktop()) { await request(`/api/user/ai/plugins/${encodeURIComponent(pluginId)}`, 'DELETE'); return; } const token = await ensureUserCsrf(); await http.delete(`/api/user/ai/plugins/${encodeURIComponent(pluginId)}`, { withCredentials: true, headers: { 'x-csrf-token': token } }); }
