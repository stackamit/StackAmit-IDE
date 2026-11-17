import { aiConfig } from './aiConfig.js';
import { normalizeAiError, providerError } from './aiErrors.js';

function mergeSignals(signals) {
  const usable = signals.filter(Boolean);
  if (usable.length < 2) return usable[0];
  const controller = new AbortController();
  const abort = () => controller.abort();
  usable.forEach((signal) => {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
  return controller.signal;
}

export async function fetchJson(url, options = {}, provider) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || aiConfig.timeoutMs);
  const signal = mergeSignals([options.signal, controller.signal]);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    });
    if (!response.ok) throw providerError(provider, response);
    return await response.json();
  } catch (error) {
    throw normalizeAiError(error, provider);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchStream(url, options = {}, provider, onChunk) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || aiConfig.timeoutMs);
  const signal = mergeSignals([options.signal, controller.signal]);
  try {
    const response = await fetch(url, {
      method: options.method || 'POST',
      headers: { Accept: 'text/event-stream, application/x-ndjson, application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    });
    if (!response.ok) throw providerError(provider, response);
    if (!response.body) throw new Error('Provider returned no response stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) await onChunk(line);
    }
    if (buffer.trim()) await onChunk(buffer);
  } catch (error) {
    throw normalizeAiError(error, provider);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseSseLine(line) {
  if (!line.startsWith('data:')) return null;
  const value = line.slice(5).trim();
  if (!value || value === '[DONE]') return null;
  try { return JSON.parse(value); } catch { return null; }
}

export function safeModelId(model) {
  return typeof model === 'string' && /^[\w.:/@+-]{1,200}$/.test(model) ? model : null;
}

export function publicProvider(provider, config) {
  return {
    id: provider,
    name: config.name,
    local: Boolean(config.local),
    configured: Boolean(config.configured),
    capabilities: ['chat', 'stream', 'cancel'],
  };
}
