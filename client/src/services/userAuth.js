import { http } from './api.js';
function desktopAuth() { return typeof window !== 'undefined' && window.stackamit?.isDesktop ? window.stackamit.auth : null; }
function csrf() { return decodeURIComponent(document.cookie.match(/(?:^|;\s*)stackamit_csrf=([^;]+)/)?.[1] || ''); }
async function ensureCsrf() { await http.get('/api/auth/csrf', { withCredentials: true }); return csrf(); }
export const userAuthApi = {
  async register(email, password) { const desktop = desktopAuth(); if (desktop?.register) return desktop.register(email, password); await ensureCsrf(); const { data } = await http.post('/api/auth/register', { email, password }, { withCredentials: true }); return data; },
  async verifyEmail(token) { const { data } = await http.post('/api/auth/verify-email', { token }); return data; },
  async requestPasswordReset(email) { const { data } = await http.post('/api/auth/password-reset/request', { email }); return data; },
  async resetPassword(token, password) { const { data } = await http.post('/api/auth/password-reset/confirm', { token, password }); return data; },
  async login(email, password) { const desktop = desktopAuth(); if (desktop) return desktop.login(email, password); await ensureCsrf(); const { data } = await http.post('/api/auth/login', { email, password }, { withCredentials: true }); return data; },
  async me() { const desktop = desktopAuth(); if (desktop) return (await desktop.restore()).user; const { data } = await http.get('/api/auth/me', { withCredentials: true }); return data.user; },
  async updateProfile(profile) { const desktop = desktopAuth(); if (desktop?.updateProfile) return (await desktop.updateProfile(profile)).user; const token = await ensureCsrf(); const { data } = await http.patch('/api/auth/profile', profile, { withCredentials: true, headers: { 'x-csrf-token': token } }); return data.user; },
  async logout() { const desktop = desktopAuth(); if (desktop) { await desktop.logout(); return; } const token = await ensureCsrf(); await http.post('/api/auth/logout', {}, { withCredentials: true, headers: { 'x-csrf-token': token } }); },
};
