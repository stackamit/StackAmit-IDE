import { listProviderMetadata } from '../ai/providerRegistry.js';
import { getPluginManifest, listPluginManifests } from '../ai/plugins/catalog.js';
import { UserPluginInstallation } from '../models/UserPluginInstallation.js';
import { UserProviderCredential } from '../models/UserProviderCredential.js';
import { ApiError } from '../utils/ApiError.js';
import { getUserCredential, listUserCredentials, providerForUser, removeUserCredential, saveUserCredential, updateUserDefaultModel } from '../services/userProvider.service.js';

const publicCredential = (doc) => ({ provider: doc.providerId, maskedApiKey: doc.maskedApiKey || null, enabled: doc.enabled, baseUrl: doc.baseUrl || null, defaultModel: doc.defaultModel || null, status: doc.status, lastHealthCheckAt: doc.lastHealthCheckAt, updatedAt: doc.updatedAt });

export async function listProviders(req, res, next) {
  try { const connected = await listUserCredentials(req.user.id); res.json({ providers: listProviderMetadata(), connected: connected.map(publicCredential) }); } catch (error) { next(error); }
}

export async function saveProvider(req, res, next) {
  try { res.status(200).json({ provider: await saveUserCredential(req.user.id, req.params.provider, req.body || {}) }); } catch (error) { next(error); }
}

export async function deleteProvider(req, res, next) {
  try { await removeUserCredential(req.user.id, req.params.provider); res.json({ ok: true }); } catch (error) { next(error); }
}

export async function setDefaultModel(req, res, next) {
  try { res.json({ provider: await updateUserDefaultModel(req.user.id, req.params.provider, req.body?.defaultModel) }); } catch (error) { next(error); }
}

async function runHealth(req, res, next) {
  try {
    const { provider, credential } = await providerForUser(req.user.id, req.params.provider);
    const health = await provider.healthCheck();
    await UserProviderCredential.updateOne({ userId: req.user.id, providerId: req.params.provider }, { $set: { status: health.available ? 'connected' : health.code === 'AI_AUTH_FAILED' ? 'invalid' : 'unavailable', lastHealthCheckAt: new Date() } });
    res.json({ provider: req.params.provider, health, credential: publicCredential({ ...credential, status: health.available ? 'connected' : health.code === 'AI_AUTH_FAILED' ? 'invalid' : 'unavailable', lastHealthCheckAt: new Date() }) });
  } catch (error) { next(error); }
}

export const testProvider = runHealth;

export async function listModels(req, res, next) {
  try { const { provider } = await providerForUser(req.user.id, req.params.provider); res.json({ models: await provider.listModels() }); } catch (error) { next(error); }
}

export async function listPlugins(req, res, next) {
  try {
    const installed = await UserPluginInstallation.find({ userId: req.user.id }).lean();
    res.json({ plugins: listPluginManifests(), installed: installed.map((item) => ({ pluginId: item.pluginId, provider: item.providerId, enabled: item.enabled, installedAt: item.installedAt })) });
  } catch (error) { next(error); }
}

export async function installPlugin(req, res, next) {
  try {
    const plugin = getPluginManifest(req.params.pluginId);
    if (!plugin) throw new ApiError('AI plugin not found.', { status: 404, code: 'AI_PLUGIN_UNKNOWN' });
    const item = await UserPluginInstallation.findOneAndUpdate({ userId: req.user.id, pluginId: plugin.id }, { $set: { providerId: plugin.provider, enabled: true } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    res.status(201).json({ installation: { pluginId: item.pluginId, provider: item.providerId, enabled: item.enabled, installedAt: item.installedAt } });
  } catch (error) { next(error); }
}

export async function uninstallPlugin(req, res, next) {
  try { await UserPluginInstallation.deleteOne({ userId: req.user.id, pluginId: req.params.pluginId }); res.json({ ok: true }); } catch (error) { next(error); }
}
