import { aiConfig } from '../aiConfig.js';
import { AiError } from '../aiErrors.js';
import { fetchJson, fetchStream, safeModelId } from '../baseProvider.js';

export function createOllamaProvider(config = aiConfig.ollama) {
  const base = config.baseUrl.replace(/\/+$/, '');
  const provider = 'ollama';
  const ensureModel = (model) => safeModelId(model) || config.defaultModel || null;
  return {
    id: provider,
    name: 'Ollama',
    local: true,
    configured: Boolean(config.enabled),
    async healthCheck({ signal } = {}) {
      if (!config.enabled) return { available: false, configured: false, reason: 'NOT_CONFIGURED' };
      try { await fetchJson(`${base}/api/tags`, { signal, timeoutMs: 5000 }, provider); return { available: true, configured: true }; }
      catch (error) { return { available: false, configured: true, code: error.code, message: error.message }; }
    },
    async listModels({ signal } = {}) {
      if (!config.enabled) return [];
      const data = await fetchJson(`${base}/api/tags`, { signal }, provider);
      return (Array.isArray(data.models) ? data.models : []).map((m) => ({ id: m.name, name: m.name, size: m.size || null, modifiedAt: m.modified_at || null }));
    },
    async getModelDetails(model, { signal } = {}) {
      const id = ensureModel(model);
      if (!id) throw new AiError('An Ollama model must be selected.', { code: 'AI_MODEL_REQUIRED', status: 400, provider });
      return fetchJson(`${base}/api/show`, { method: 'POST', body: { name: id }, signal }, provider);
    },
    async generate({ model, messages, signal }) {
      let output = '';
      let usage = null;
      await this.stream({ model, messages, signal, onDelta: (delta) => { output += delta; }, onComplete: (meta) => { usage = meta?.usage || null; } });
      return { text: output, usage, model: ensureModel(model) };
    },
    async stream({ model, messages, signal, onDelta, onComplete }) {
      const id = ensureModel(model);
      if (!id) throw new AiError('An Ollama model must be selected.', { code: 'AI_MODEL_REQUIRED', status: 400, provider });
      let sawModel = id;
      await fetchStream(`${base}/api/chat`, { body: { model: id, messages, stream: true }, signal }, provider, async (line) => {
        if (!line.trim()) return;
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.error) throw new AiError(event.error, { code: /not found/i.test(event.error) ? 'AI_MODEL_NOT_FOUND' : 'AI_PROVIDER_ERROR', status: 502, provider });
        sawModel = event.model || sawModel;
        const delta = event.message?.content || '';
        if (delta) await onDelta(delta);
        if (event.done) await onComplete?.({ model: sawModel, usage: { promptTokens: event.prompt_eval_count, completionTokens: event.eval_count, totalTokens: (event.prompt_eval_count || 0) + (event.eval_count || 0) } });
      });
    },
    cancel() { return true; },
    getCapabilities() { return { chat: true, stream: true, cancel: true, modelDetails: true }; },
  };
}
