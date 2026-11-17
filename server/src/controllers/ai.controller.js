import { aiConfig, publicAiConfig } from '../ai/aiConfig.js';
import { buildMessages } from '../ai/context.js';
import { normalizeAiError } from '../ai/aiErrors.js';
import { getProvider, listProviderMetadata } from '../ai/providerRegistry.js';
import { validateMessages } from '../ai/modelRouter.js';
import { getPluginManifest, listPluginManifests } from '../ai/plugins/catalog.js';
import { providerForUser } from '../services/userProvider.service.js';
import { providerCatalog as providerDirectory } from '../ai/providerCatalog.js';

function sendEvent(res, event, data = {}) {
  if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function providerCatalog(_req, res) {
  res.json({ providers: listProviderMetadata(), catalog: providerDirectory, defaults: publicAiConfig() });
}

export function pluginCatalog(_req, res) {
  res.json({ plugins: listPluginManifests(), trust: 'first-party-only' });
}

export function pluginDetails(req, res) {
  const plugin = getPluginManifest(req.params.pluginId);
  if (!plugin) return res.status(404).json({ code: 'AI_PLUGIN_UNKNOWN', message: 'AI plugin not found.' });
  return res.json({ plugin });
}

export async function providerHealth(req, res, next) {
  try { const { provider } = await providerForUser(req.user.id, req.params.provider); res.json(await provider.healthCheck()); }
  catch (error) { next(normalizeAiError(error)); }
}

export async function providerModels(req, res, next) {
  try { const { provider } = await providerForUser(req.user.id, req.params.provider); res.json({ models: await provider.listModels() }); }
  catch (error) { next(normalizeAiError(error)); }
}

export async function streamChat(req, res, next) {
  let started = false;
  const controller = new AbortController();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  req.on('close', onClose);
  try {
    if (!aiConfig.enabled) throw new Error('AI integration is disabled');
    const providerName = String(req.body?.provider || req.body?.providerName || '').trim().toLowerCase();
    const { provider } = await providerForUser(req.user.id, providerName);
    const model = req.body?.model || null;
    const messages = buildMessages(validateMessages(req.body?.messages), req.body?.context);
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    started = true;
    sendEvent(res, 'started', { provider: providerName, model });
    let responseChars = 0;
    await provider.stream({ model, messages, signal: controller.signal, onDelta: (delta) => {
      responseChars += String(delta || '').length;
      if (responseChars > aiConfig.maxResponseChars) { controller.abort(); throw new Error('AI response exceeded the configured size limit'); }
      sendEvent(res, 'delta', { text: delta });
    }, onComplete: (usage) => sendEvent(res, 'completed', { usage: usage || null }) });
    if (!res.writableEnded) res.end();
  } catch (error) {
    const normalized = normalizeAiError(error);
    if (started && !res.writableEnded) { sendEvent(res, controller.signal.aborted ? 'cancelled' : 'error', { code: normalized.code, message: normalized.message }); res.end(); }
    else if (!res.headersSent) next(normalized);
  } finally { req.off?.('close', onClose); }
}
