import { aiConfig } from '../ai/aiConfig.js';
import { getProvider } from '../ai/providerRegistry.js';
import { createCompatibleProvider } from '../ai/providers/compatibleProvider.js';
import { createGeminiProvider } from '../ai/providers/geminiProvider.js';
import { createOllamaProvider } from '../ai/providers/ollamaProvider.js';
import { createOpenAiProvider } from '../ai/providers/openaiProvider.js';
import { UserProviderCredential } from '../models/UserProviderCredential.js';
import { ApiError } from '../utils/ApiError.js';
import { decryptCredential, encryptCredential, maskCredential } from './credentialVault.service.js';

const supportedProviders = new Set(['ollama', 'openai', 'gemini', 'compatible']);
const cloudProviders = new Set(['openai', 'gemini', 'compatible']);

function assertProvider(providerId) {
  const id = String(providerId || '').trim().toLowerCase();
  if (!supportedProviders.has(id) || !getProvider(id)) throw new ApiError('Unknown AI provider.', { status: 404, code: 'AI_PROVIDER_UNKNOWN' });
  return id;
}

function safeUrl(value, provider) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase());
    if (url.protocol !== 'https:' && !(provider === 'ollama' && url.protocol === 'http:' && localHost)) throw new Error('unsafe');
    if (url.username || url.password) throw new Error('unsafe');
    return url.toString().replace(/\/$/, '');
  } catch { throw new ApiError('Provider endpoint must be a valid HTTP or HTTPS URL.', { status: 400, code: 'AI_INVALID_ENDPOINT' }); }
}

function responseCredential(doc) {
  return { provider: doc.providerId, maskedApiKey: doc.maskedApiKey || null, enabled: doc.enabled, baseUrl: doc.baseUrl || null, defaultModel: doc.defaultModel || null, status: doc.status, lastHealthCheckAt: doc.lastHealthCheckAt, updatedAt: doc.updatedAt };
}

export function listUserCredentials(userId) { return UserProviderCredential.find({ userId }).sort({ providerId: 1 }).lean(); }

export async function getUserCredential(userId, providerId, { secret = false } = {}) {
  const provider = assertProvider(providerId);
  const query = UserProviderCredential.findOne({ userId, providerId: provider });
  if (secret) query.select('+encryptedApiKey.ciphertext +encryptedApiKey.iv +encryptedApiKey.tag');
  return query.lean();
}

export async function saveUserCredential(userId, providerId, { apiKey, baseUrl, defaultModel, enabled = true }) {
  const provider = assertProvider(providerId);
  const existing = await getUserCredential(userId, provider, { secret: true });
  const cleanKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (cloudProviders.has(provider) && !cleanKey && !existing?.encryptedApiKey?.ciphertext) throw new ApiError('An API key is required for this provider.', { status: 400, code: 'AI_API_KEY_REQUIRED' });
  // The dashboard uses the API-key field as the single endpoint input for
  // Ollama; accept that local-only value while keeping cloud keys separate.
  const requestedBaseUrl = baseUrl || (provider === 'ollama' ? cleanKey : '');
  const endpoint = safeUrl(requestedBaseUrl, provider);
  if (provider === 'compatible' && !endpoint && !aiConfig.compatible.baseUrl) throw new ApiError('An HTTPS endpoint is required for a compatible provider.', { status: 400, code: 'AI_ENDPOINT_REQUIRED' });
  const update = { userId, providerId: provider, enabled: Boolean(enabled), baseUrl: endpoint, defaultModel: typeof defaultModel === 'string' ? defaultModel.trim().slice(0, 200) : '', status: 'not_tested' };
  if (cleanKey) { update.encryptedApiKey = encryptCredential(cleanKey); update.maskedApiKey = maskCredential(cleanKey); }
  else if (existing) { update.encryptedApiKey = existing.encryptedApiKey; update.maskedApiKey = existing.maskedApiKey; }
  const doc = await UserProviderCredential.findOneAndUpdate({ userId, providerId: provider }, { $set: update }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  return responseCredential(doc);
}

export async function removeUserCredential(userId, providerId) {
  const provider = assertProvider(providerId);
  await UserProviderCredential.deleteOne({ userId, providerId: provider });
}

export async function updateUserDefaultModel(userId, providerId, defaultModel) {
  const provider = assertProvider(providerId);
  const model = String(defaultModel || '').trim().slice(0, 200);
  const doc = await UserProviderCredential.findOneAndUpdate({ userId, providerId: provider }, { $set: { defaultModel: model } }, { new: true }).lean();
  if (!doc) throw new ApiError('Connect this provider before selecting a default model.', { status: 404, code: 'AI_PROVIDER_NOT_CONNECTED' });
  return responseCredential(doc);
}

export async function providerForUser(userId, providerId) {
  const provider = assertProvider(providerId);
  const doc = await getUserCredential(userId, provider, { secret: true });
  // Ollama is local and intentionally does not require a cloud credential.
  if (provider === 'ollama' && !doc) {
    return { provider: createOllamaProvider({ ...aiConfig.ollama, enabled: true }), credential: { providerId: provider, enabled: true, maskedApiKey: null, baseUrl: aiConfig.ollama.baseUrl, defaultModel: aiConfig.ollama.defaultModel, status: 'not_tested' } };
  }
  if (!doc?.enabled) throw new ApiError('This AI provider is not connected for your account.', { status: 403, code: 'AI_PROVIDER_NOT_CONNECTED', details: { provider } });
  if (cloudProviders.has(provider) && !doc.encryptedApiKey?.ciphertext) throw new ApiError('Please connect your own API key for this provider before using it.', { status: 403, code: 'AI_USER_CREDENTIAL_REQUIRED', details: { provider } });
  const apiKey = doc.encryptedApiKey?.ciphertext ? decryptCredential(doc.encryptedApiKey) : '';
  const config = { enabled: true, apiKey, baseUrl: doc.baseUrl || aiConfig[provider]?.baseUrl, defaultModel: doc.defaultModel || '' };
  const instance = provider === 'openai' ? createOpenAiProvider(config) : provider === 'gemini' ? createGeminiProvider(config) : provider === 'compatible' ? createCompatibleProvider(config) : createOllamaProvider(config);
  return { provider: instance, credential: doc };
}

export { assertProvider, responseCredential };
