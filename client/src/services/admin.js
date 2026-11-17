import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const client = axios.create({
  baseURL: baseURL || undefined,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
  withCredentials: true, // send/receive the admin cookie when the API sets one
});

export function getToken() {
  return client.defaults.headers.common.Authorization?.replace(/^Bearer\s+/i, '') || null;
}

export function setToken(token) {
  if (token) client.defaults.headers.common.Authorization = `Bearer ${token}`;
  else delete client.defaults.headers.common.Authorization;
}

function csrfToken() { return decodeURIComponent(document.cookie.match(/(?:^|;\s*)stackamit_admin_csrf=([^;]+)/)?.[1] || ''); }
client.interceptors.request.use((config) => {
  if (['post', 'put', 'patch', 'delete'].includes(String(config.method || '').toLowerCase()) && !config.headers.Authorization) {
    const token = csrfToken();
    if (token) config.headers['x-csrf-token'] = token;
  }
  return config;
});

function toError(err) {
  if (err.response) {
    const data = err.response.data || {};
    return { status: err.response.status, code: data.code || 'HTTP_ERROR', message: data.message || 'Request failed.' };
  }
  return { status: 0, code: 'NETWORK', message: 'Network error — is the API server running?' };
}

export const adminApi = {
  async login(username, password) {
    const { data } = await client.post('/api/admin/login', { username, password });
    setToken(data.data.token);
    return data.data;
  },
  async logout() {
    try {
      await client.post('/api/admin/logout');
    } finally {
      setToken(null);
    }
  },
  async me() {
    const { data } = await client.get('/api/admin/me');
    return data.data;
  },
  async dashboard() {
    const { data } = await client.get('/api/admin/dashboard');
    return data.data;
  },
  async executions(limit = 50) {
    const { data } = await client.get('/api/admin/executions', { params: { limit } });
    return data.data;
  },
  async settings() {
    const { data } = await client.get('/api/admin/settings');
    return data.data;
  },
  async saveSettings(patch) {
    const { data } = await client.patch('/api/admin/settings', patch);
    return data.data;
  },
  async snippets(limit = 100) {
    const { data } = await client.get('/api/admin/snippets', { params: { limit } });
    return data.data;
  },
  async deleteSnippet(id) {
    const { data } = await client.delete(`/api/admin/snippets/${encodeURIComponent(id)}`);
    return data.data;
  },
  async content() {
    const { data } = await client.get('/api/admin/content');
    return data.data;
  },
  async saveContent(patch) {
    const { data } = await client.patch('/api/admin/content', patch);
    return data.data;
  },
  async messages(limit = 200) {
    const { data } = await client.get('/api/admin/messages', { params: { limit } });
    return data.data;
  },
  async markMessage(id, read) {
    const { data } = await client.patch(`/api/admin/messages/${encodeURIComponent(id)}`, { read });
    return data.data;
  },
  async deleteMessage(id) {
    const { data } = await client.delete(`/api/admin/messages/${encodeURIComponent(id)}`);
    return data.data;
  },
  async aiProviders() {
    const { data } = await client.get('/api/admin/ai/providers');
    return data;
  },
  async aiHealth(provider) {
    const { data } = await client.get(`/api/admin/ai/providers/${encodeURIComponent(provider)}/health`);
    return data;
  },
  async aiModels(provider) {
    const { data } = await client.get(`/api/admin/ai/providers/${encodeURIComponent(provider)}/models`);
    return data.models || [];
  },
  async aiStream({ provider, model, messages, context, signal, onEvent }) {
    const csrf = csrfToken();
    const response = await fetch(`${baseURL}/api/admin/ai/chat/stream`, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
      body: JSON.stringify({ provider, model, messages, context }),
    });
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch { /* safe fallback */ }
      throw new Error(body.message || 'Admin AI request failed.');
    }
    if (!response.body) throw new Error('Admin AI returned no stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\n\n/);
      buffer = events.pop() || '';
      events.forEach((raw) => {
        const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith('data:'));
        if (!dataLine) return;
        try { onEvent(raw.match(/^event:\s*(.+)$/m)?.[1] || 'message', JSON.parse(dataLine.slice(5).trim())); } catch { /* ignore malformed provider event */ }
      });
    }
  },
};

export { toError };
