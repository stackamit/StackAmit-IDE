import { aiConfig } from '../aiConfig.js';
import { fetchJson, fetchStream, parseSseLine, safeModelId } from '../baseProvider.js';
import { AiError } from '../aiErrors.js';

export function createOpenAiProvider(config = aiConfig.openai) {
  const provider = 'openai';
  const headers = { Authorization: `Bearer ${config.apiKey}` };
  const modelFor = (model) => safeModelId(model) || config.defaultModel || null;
  return {
    id: provider,
    name: 'OpenAI',
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
      return (Array.isArray(data.data) ? data.data : [])
        .filter((m) => /^(gpt|o[1-9]|chatgpt)/i.test(m.id))
        .filter((m) => !/(realtime|transcribe|audio|tts|search|image|embedding|moderation)/i.test(m.id))
        .map((m) => ({ id: m.id, name: m.id }));
    },
    async generate({ model, messages, signal }) {
      let text = '';
      let usage = null;
      await this.stream({ model, messages, signal, onDelta: (delta) => { text += delta; }, onComplete: (meta) => { usage = meta?.usage || null; } });
      return { text, usage, model: modelFor(model) };
    },
    async stream({ model, messages, signal, onDelta, onComplete }) {
      const id = modelFor(model);
      if (!id) throw new AiError('An OpenAI model must be selected.', { code: 'AI_MODEL_REQUIRED', status: 400, provider });
      await fetchStream(`${config.baseUrl}/responses`, { headers, body: { model: id, input: messages, stream: true, store: false }, signal }, provider, async (line) => {
        const event = parseSseLine(line);
        if (!event) return;
        if (event.type === 'response.output_text.delta' && event.delta) await onDelta(event.delta);
        if (event.type === 'response.completed') await onComplete?.({ model: id, usage: event.response?.usage || null });
        if (event.type === 'error' || event.type === 'response.error' || event.type === 'response.failed') {
          const details = event.error || event.response?.error || event;
          const message = details?.message || details?.code || event.message || 'OpenAI returned an error.';
          throw new AiError(message, { code: 'AI_PROVIDER_ERROR', status: 502, provider });
        }
      });
    },
    cancel() { return true; },
    getCapabilities() { return { chat: true, stream: true, cancel: true, modelDetails: false }; },
  };
}
