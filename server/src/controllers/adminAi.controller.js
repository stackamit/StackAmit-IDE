import { aiConfig, publicAiConfig } from '../ai/aiConfig.js';
import { buildMessages } from '../ai/context.js';
import { normalizeAiError, AiError } from '../ai/aiErrors.js';
import { getProvider, listProviderMetadata, modelDefaults } from '../ai/providerRegistry.js';
import { validateMessages } from '../ai/modelRouter.js';

const names = { ollama: 'Ollama', openai: 'OpenAI', gemini: 'Google Gemini', compatible: 'OpenAI-compatible' };

function configuredProvider(id) {
  const provider = getProvider(id);
  if (!provider || !provider.configured) {
    throw new AiError('This server-configured AI provider is not available.', { code: 'AI_NOT_CONFIGURED', status: 503, provider: id });
  }
  return provider;
}

function safeProviderList() {
  const config = publicAiConfig();
  const defaults = modelDefaults();
  return listProviderMetadata()
    .filter((item) => config.providers[item.id]?.configured)
    .map((item) => ({
      id: item.id,
      name: names[item.id] || item.name,
      local: item.local,
      configured: true,
      defaultModel: defaults[item.id] || null,
      capabilities: item.capabilities,
    }));
}

export function adminProviders(_req, res) {
  res.json({ providers: safeProviderList() });
}

export async function adminProviderHealth(req, res, next) {
  try {
    const provider = configuredProvider(req.params.provider);
    res.json(await provider.healthCheck());
  } catch (error) {
    next(normalizeAiError(error, req.params.provider));
  }
}

export async function adminProviderModels(req, res, next) {
  try {
    const provider = configuredProvider(req.params.provider);
    res.json({ models: await provider.listModels() });
  } catch (error) {
    next(normalizeAiError(error, req.params.provider));
  }
}

function sendEvent(res, event, data = {}) {
  if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function adminStreamChat(req, res, next) {
  let started = false;
  const controller = new AbortController();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  req.on('close', onClose);
  try {
    if (!aiConfig.enabled) throw new AiError('AI features are disabled on this server.', { code: 'AI_DISABLED', status: 503 });
    const providerName = String(req.body?.provider || req.body?.providerName || '').trim().toLowerCase();
    const provider = configuredProvider(providerName);
    const model = req.body?.model || null;
    const messages = buildMessages(validateMessages(req.body?.messages), req.body?.context);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    started = true;
    sendEvent(res, 'started', { provider: providerName, model });
    let responseChars = 0;
    await provider.stream({
      model,
      messages,
      signal: controller.signal,
      onDelta: (delta) => {
        responseChars += String(delta || '').length;
        if (responseChars > aiConfig.maxResponseChars) {
          controller.abort();
          throw new AiError('AI response exceeded the configured size limit.', { code: 'AI_RESPONSE_TOO_LARGE', status: 413, provider: providerName });
        }
        sendEvent(res, 'delta', { text: delta });
      },
      onComplete: (usage) => sendEvent(res, 'completed', { usage: usage || null }),
    });
    if (!res.writableEnded) res.end();
  } catch (error) {
    const normalized = normalizeAiError(error, req.params.provider || req.body?.provider);
    if (started && !res.writableEnded) {
      sendEvent(res, controller.signal.aborted ? 'cancelled' : 'error', { code: normalized.code, message: normalized.message });
      res.end();
    } else if (!res.headersSent) next(normalized);
  } finally {
    req.off?.('close', onClose);
  }
}
