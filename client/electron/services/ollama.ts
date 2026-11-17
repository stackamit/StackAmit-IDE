const DEFAULT_URL = 'http://127.0.0.1:11434';

export function normalizeOllamaUrl(raw?: string | null): string {
  const parsed = new URL(raw || DEFAULT_URL);
  if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error('Ollama must use a loopback URL.');
  }
  return parsed.origin;
}

async function request(baseUrl: string, path: string, init?: RequestInit) {
  const response = await fetch(`${normalizeOllamaUrl(baseUrl)}${path}`, { ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) } });
  if (!response.ok) throw new Error(`Ollama request failed (${response.status}).`);
  return response;
}

export async function health(baseUrl?: string | null) {
  try { await request(baseUrl || DEFAULT_URL, '/api/tags'); return { ok: true, available: true, baseUrl: normalizeOllamaUrl(baseUrl) }; }
  catch (error) { return { ok: false, available: false, baseUrl: baseUrl || DEFAULT_URL, message: error instanceof Error ? error.message : 'Ollama unavailable.' }; }
}

export async function models(baseUrl?: string | null) {
  const response = await request(baseUrl || DEFAULT_URL, '/api/tags');
  const data = await response.json() as { models?: Array<Record<string, unknown>> };
  return { ok: true, models: (data.models || []).map((model) => ({ id: String(model.name || model.model || ''), name: String(model.name || model.model || ''), local: true, details: model.details || null })) };
}

export async function stream(baseUrl: string | null | undefined, args: { model: string; messages: Array<{ role: string; content: string }> }, signal: AbortSignal, onEvent: (event: Record<string, unknown>) => void) {
  const response = await request(baseUrl || DEFAULT_URL, '/api/chat', { method: 'POST', body: JSON.stringify({ model: args.model, messages: args.messages, stream: true }), signal });
  if (!response.body) throw new Error('Ollama returned no stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}
