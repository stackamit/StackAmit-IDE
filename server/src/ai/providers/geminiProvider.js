import { aiConfig } from '../aiConfig.js';
import { fetchJson, fetchStream, parseSseLine, safeModelId } from '../baseProvider.js';
import { AiError } from '../aiErrors.js';

function toGeminiContents(messages) {
  return messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] }));
}

export function createGeminiProvider(config = aiConfig.gemini) {
  const provider = 'gemini';
  const modelFor = (model) => safeModelId(model) || config.defaultModel || null;
  const url = (model, action) => `${config.baseUrl}/models/${encodeURIComponent(model)}:${action}?key=${encodeURIComponent(config.apiKey)}`;
  return {
    id: provider,
    name: 'Google Gemini',
    local: false,
    configured: Boolean(config.enabled),
    async healthCheck({ signal } = {}) {
      if (!config.enabled) return { available: false, configured: false, reason: 'NOT_CONFIGURED' };
      try { await this.listModels({ signal }); return { available: true, configured: true }; }
      catch (error) { return { available: false, configured: true, code: error.code, message: error.message }; }
    },
    async listModels({ signal } = {}) {
      if (!config.enabled) return [];
      const data = await fetchJson(`${config.baseUrl}/models?key=${encodeURIComponent(config.apiKey)}`, { signal }, provider);
      // The chat adapter always uses streamGenerateContent. Gemini exposes
      // other generateContent-capable models (TTS, image, research, etc.)
      // that cannot serve this text-streaming contract, so do not advertise
      // them as verified chat models.
      return (Array.isArray(data.models) ? data.models : []).filter((m) => {
        const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        return methods.includes('generateContent') && methods.includes('streamGenerateContent');
      }).map((m) => ({ id: String(m.name || '').replace(/^models\//, ''), name: m.displayName || m.name }));
    },
    async generate({ model, messages, signal }) {
      let text = '';
      let usage = null;
      await this.stream({ model, messages, signal, onDelta: (delta) => { text += delta; }, onComplete: (meta) => { usage = meta?.usage || null; } });
      return { text, usage, model: modelFor(model) };
    },
    async stream({ model, messages, signal, onDelta, onComplete }) {
      const id = modelFor(model);
      if (!id) throw new AiError('A Gemini model must be selected.', { code: 'AI_MODEL_REQUIRED', status: 400, provider });
      const system = messages.find((m) => m.role === 'system');
      const body = { contents: toGeminiContents(messages), ...(system ? { systemInstruction: { parts: [{ text: String(system.content || '') }] } } : {}) };
      await fetchStream(url(id, 'streamGenerateContent') + '&alt=sse', { body, signal }, provider, async (line) => {
        const event = parseSseLine(line);
        if (!event) return;
        const delta = event.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        if (delta) await onDelta(delta);
        if (event.usageMetadata) await onComplete?.({ model: id, usage: event.usageMetadata });
      });
    },
    cancel() { return true; },
    getCapabilities() { return { chat: true, stream: true, cancel: true, modelDetails: false }; },
  };
}
