import { http } from './api.js';

let csrfToken = '';

function cookieToken() {
  if (typeof document === 'undefined') return '';
  return decodeURIComponent(document.cookie.match(/(?:^|;\s*)stackamit_csrf=([^;]+)/)?.[1] || '');
}

// On a Netlify -> Render deployment the API cookie is not readable by the
// renderer. Keep the token returned by the API in memory for CSRF headers.
export async function ensureUserCsrf() {
  const { data } = await http.get('/api/auth/csrf', { withCredentials: true });
  csrfToken = String(data?.token || cookieToken());
  return csrfToken;
}

export function currentUserCsrf() {
  return csrfToken || cookieToken();
}
