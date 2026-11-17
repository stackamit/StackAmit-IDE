import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

type AuthUser = { id: string; email: string; status: string; emailVerified: boolean; createdAt?: string; displayName?: string; preferences?: { theme?: string } };
const fileName = 'desktop-auth.bin';

function originOf(apiOrigin: string): string {
  let parsed: URL;
  try { parsed = new URL(apiOrigin); } catch { throw new Error('Desktop cloud authentication is not configured for this build.'); }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol !== 'https:' && !local)) throw new Error('Desktop cloud authentication requires HTTPS.');
  return parsed.toString().replace(/\/+$/, '');
}

function storePath() { return path.join(app.getPath('userData'), fileName); }

async function writeToken(token: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable.');
  const encrypted = safeStorage.encryptString(token);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(storePath(), encrypted, { mode: 0o600 });
}

async function readToken(): Promise<string | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = await fs.readFile(storePath());
    return safeStorage.decryptString(encrypted);
  } catch { return null; }
}

async function clearToken() { await fs.rm(storePath(), { force: true }).catch(() => {}); }

async function request(apiOrigin: string, pathName: string, options: RequestInit = {}) {
  const response = await fetch(`${originOf(apiOrigin)}${pathName}`, { ...options, signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : 'Authentication request failed.');
  return data;
}

export async function login(apiOrigin: string, email: string, password: string) {
  const data = await request(apiOrigin, '/api/auth/desktop/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (typeof data.accessToken !== 'string' || !data.user) throw new Error('Authentication response was invalid.');
  await writeToken(data.accessToken);
  return { user: data.user as AuthUser, expiresAt: data.session?.expiresAt || null };
}

export async function register(apiOrigin: string, email: string, password: string) {
  return request(apiOrigin, '/api/auth/desktop/register', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export async function restore(apiOrigin: string) {
  const token = await readToken();
  if (!token) return { user: null };
  try {
    const data = await request(apiOrigin, '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    return { user: data.user as AuthUser };
  } catch {
    await clearToken();
    return { user: null };
  }
}

export async function logout(apiOrigin: string) {
  const token = await readToken();
  try { if (token) await request(apiOrigin, '/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); }
  finally { await clearToken(); }
  return { ok: true };
}

export async function updateProfile(apiOrigin: string, profile: { displayName?: string; theme?: string }) {
  if (typeof profile?.displayName !== 'undefined' && (typeof profile.displayName !== 'string' || profile.displayName.length > 80)) throw new Error('Invalid display name.');
  if (typeof profile?.theme !== 'undefined' && !['dark', 'light'].includes(profile.theme)) throw new Error('Invalid theme.');
  const token = await readToken();
  if (!token) throw new Error('Desktop session is not available.');
  const data = await request(apiOrigin, '/api/auth/profile', { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(profile) });
  return { user: data.user as AuthUser };
}

const allowedUserPaths = /^\/api\/user\/ai\/(providers|plugins)(\/|$)/;
const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export async function requestJson(apiOrigin: string, pathName: string, method = 'GET', body?: unknown) {
  if (!allowedUserPaths.test(pathName) || !allowedMethods.has(method)) throw new Error('Unsupported desktop account request.');
  const token = await readToken();
  if (!token) throw new Error('Desktop session is not available.');
  return request(apiOrigin, pathName, { method, headers: { Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

export async function streamAi(apiOrigin: string, payload: unknown, signal: AbortSignal, onChunk: (chunk: string) => void) {
  const token = await readToken();
  if (!token) throw new Error('Desktop session is not available.');
  const response = await fetch(`${originOf(apiOrigin)}/api/ai/chat/stream`, { method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal });
  if (!response.ok || !response.body) throw new Error('Authenticated AI request failed.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) { const { done, value } = await reader.read(); if (done) break; onChunk(decoder.decode(value, { stream: true })); }
}
