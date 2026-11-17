import { aiConfig } from '../aiConfig.js';
import { fetchJson, fetchStream, parseSseLine, safeModelId } from '../baseProvider.js';
import { AiError } from '../aiErrors.js';

export function createCompatibleProvider(config = aiConfig.compatible) {
  const provider = 'compatible';
  const headers = config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
  const modelFor = (model) => safeModelId(model) || config.defaultModel || null;
  return {
    id: provider,
    name: config.name,
    local: false,
    configured: Boolean(config.enabled),
    async healthCheck({ signal } = {}) {
      if (!config.enabled) return { available: false, configured: false, reason: 'NOT_CONFIGURED' };
      try { await fetchJson(`${config.baseUrl}/models`, { headers, signal, timeoutMs: 8000 }, provider); return { available: true, configured: true }; }
      catch (error) { return { available: false, configured: true, code: error.code, message: error.message }; }
    },
    async listModels({ signal } = {}) {
      if (!config.enabled) return [];
      const data = await fetchJson(`${config.baseUrl}/models`, { headers, signal }, provider);
      return (Array.isArray(data.data) ? data.data : []).map((m) => ({ id: m.id, name: m.id }));
    },
    async generate({ model, messages, signal }) {
      let text = '';
      let usage = null;
      await this.stream({ model, messages, signal, onDelta: (delta) => { text += delta; }, onComplete: (meta) => { usage = meta?.usage || null; } });
      return { text, usage, model: modelFor(model) };
    },
    async stream({ model, messages, signal, onDelta, onComplete }) {
      const id = modelFor(model);
      if (!id) throw new AiError('A compatible-provider model must be selected.', { code: 'AI_MODEL_REQUIRED', status: 400, provider });
      await fetchStream(`${config.baseUrl}/chat/completions`, { headers, body: { model: id, messages, stream: true }, signal }, provider, async (line) => {
        const event = parseSseLine(line);
        if (!event) return;
        const delta = event.choices?.[0]?.delta?.content || '';
        if (delta) await onDelta(delta);
        if (event.usage) await onComplete?.({ model: id, usage: event.usage });
      });
    },
    cancel() { return true; },
    getCapabilities() { return { chat: true, stream: true, cancel: true, modelDetails: false }; },
  };
}
