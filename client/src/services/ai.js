import { http } from './api.js';
import { adminApi } from './admin.js';

const desktop = () => typeof window !== 'undefined' ? window.stackamit?.ai?.ollama : null;
const currentMode = () => 'user';
export async function getAiCatalog(mode = currentMode()) { if (mode === 'admin') return adminApi.aiProviders(); const { data } = await http.get('/api/ai/providers'); return data; }
export async function getProviderHealth(provider, mode = currentMode()) { if (mode === 'admin') return adminApi.aiHealth(provider); if (provider === 'ollama' && desktop()) return desktop().health(); const { data } = await http.get(`/api/user/ai/providers/${encodeURIComponent(provider)}/test`, { withCredentials: true }); return data.health || data; }
export async function getProviderModels(provider, mode = currentMode()) { if (mode === 'admin') return adminApi.aiModels(provider); if (provider === 'ollama' && desktop()) { const data = await desktop().models(); return data.models || []; } const { data } = await http.get(`/api/user/ai/providers/${encodeURIComponent(provider)}/models`, { withCredentials: true }); return data.models || []; }
async function readSse(response, handlers) {
  if (!response.ok) throw new Error(`AI request failed (${response.status}).`);
  const reader = response.body?.getReader(); if (!reader) throw new Error('AI provider returned no stream.');
  const decoder = new TextDecoder(); let buffer = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const blocks = buffer.split(/\n\n/); buffer = blocks.pop() || ''; for (const block of blocks) { const event = block.match(/^event:\s*(.+)$/m)?.[1]; const raw = block.match(/^data:\s*(.+)$/m)?.[1]; if (raw) handlers[event]?.(JSON.parse(raw)); } }
}
export async function streamAiChat({ provider, model, messages, context, signal, onDelta, onComplete, onStatus, mode = currentMode() }) {
  if (mode === 'admin') return adminApi.aiStream({ provider, model, messages, context, signal, onEvent: (event, data) => { onStatus?.(event); if (event === 'delta') onDelta?.(data.text); if (event === 'completed') onComplete?.(data.usage); if (event === 'error') throw new Error(data.message || 'Admin AI provider error.'); } });
  if (provider === 'ollama' && desktop()) { const bridge = desktop(); const result = await bridge.start({ model, messages }); if (!result?.ok) throw new Error(result?.message || 'Unable to start Ollama.'); return new Promise((resolve, reject) => { const off = bridge.onEvent((event) => { if (event.sessionId !== result.sessionId) return; onStatus?.(event.type); if (event.type === 'delta') onDelta?.(event.text); if (event.type === 'completed') { onComplete?.(event.usage); off(); resolve(event); } if (event.type === 'cancelled') { off(); resolve(event); } if (event.type === 'error') { off(); reject(new Error(event.message)); } }); signal?.addEventListener('abort', () => { void bridge.stop(result.sessionId); }, { once: true }); }); }
  if (desktop()) { const bridge = desktop(); const result = await bridge.ai.start({ provider, model, messages, context }); if (!result?.ok) throw new Error(result?.message || 'Unable to start authenticated AI request.'); return new Promise((resolve, reject) => { const off = bridge.ai.onEvent((event) => { if (event.sessionId !== result.sessionId) return; onStatus?.(event.type); if (event.type === 'delta') onDelta?.(event.text); if (event.type === 'completed') { onComplete?.(event.usage); off(); resolve(event); } if (event.type === 'cancelled') { off(); resolve(event); } if (event.type === 'error') { off(); reject(new Error(event.message)); } }); signal?.addEventListener('abort', () => { void bridge.ai.stop(result.sessionId); }, { once: true }); }); }
  const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
  const csrfToken = decodeURIComponent(document.cookie.match(/(?:^|;\s*)stackamit_csrf=([^;]+)/)?.[1] || '');
  const response = await fetch(`${apiBase}/api/ai/chat/stream`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) }, body: JSON.stringify({ provider, model, messages, context }), signal });
  return readSse(response, { started: onStatus, delta: (data) => onDelta?.(data.text), completed: (data) => onComplete?.(data.usage), cancelled: onStatus, error: (data) => { throw new Error(data.message || 'AI provider error.'); } });
}
