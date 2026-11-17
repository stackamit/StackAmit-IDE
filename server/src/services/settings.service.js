import { env } from '../config/env.js';
import { isDatabaseConnected } from '../config/db.js';
import { getSettings, updateSettings } from '../models/Settings.js';

const CACHE_TTL_MS = 15000;
let cache = { at: 0, value: null };

const DEFAULTS = () => ({
  announcementBanner: '',
  bannerEnabled: false,
  maintenanceMessage: '',
  snippetEnabled: env.snippetEnabled,
  adminAi: { provider: '', model: '' },
});

/** Effective public settings; falls back to env defaults if the DB is offline. */
export async function getEffectiveSettings() {
  if (!isDatabaseConnected()) return DEFAULTS();
  const now = Date.now();
  if (cache.value && now - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const doc = await getSettings();
    const value = {
      announcementBanner: doc.announcementBanner || '',
      bannerEnabled: Boolean(doc.bannerEnabled),
      maintenanceMessage: doc.maintenanceMessage || '',
      snippetEnabled: doc.snippetEnabledOverride ?? env.snippetEnabled,
    };
    cache = { at: now, value };
    return value;
  } catch {
    return DEFAULTS();
  }
}

/** Raw settings for the admin dashboard (env defaults merged with stored doc). */
export async function getAdminSettings() {
  if (!isDatabaseConnected()) {
    return { ...DEFAULTS(), snippetEnabledOverride: null, updatedAt: null, persisted: false };
  }
  const doc = await getSettings();
  return {
    announcementBanner: doc.announcementBanner || '',
    bannerEnabled: Boolean(doc.bannerEnabled),
    maintenanceMessage: doc.maintenanceMessage || '',
    snippetEnabledOverride: doc.snippetEnabledOverride ?? null,
    snippetEnabled: doc.snippetEnabledOverride ?? env.snippetEnabled,
    adminAi: { provider: doc.adminAi?.provider || '', model: doc.adminAi?.model || '' },
    updatedAt: doc.updatedAt || null,
    persisted: true,
  };
}

export async function saveAdminSettings(patch) {
  if (!isDatabaseConnected()) {
    const err = new Error('Settings persistence needs MongoDB (database offline).');
    err.status = 503;
    err.code = 'DATABASE_UNAVAILABLE';
    throw err;
  }
  const allowed = {};
  if (typeof patch.announcementBanner === 'string') allowed.announcementBanner = patch.announcementBanner.slice(0, 240);
  if (typeof patch.bannerEnabled === 'boolean') allowed.bannerEnabled = patch.bannerEnabled;
  if (typeof patch.maintenanceMessage === 'string') allowed.maintenanceMessage = patch.maintenanceMessage.slice(0, 240);
  if (patch.snippetEnabledOverride === null || typeof patch.snippetEnabledOverride === 'boolean') {
    allowed.snippetEnabledOverride = patch.snippetEnabledOverride;
  }
  if (patch.adminAi && typeof patch.adminAi === 'object') {
    allowed.adminAi = {
      provider: typeof patch.adminAi.provider === 'string' ? patch.adminAi.provider.slice(0, 40) : '',
      model: typeof patch.adminAi.model === 'string' ? patch.adminAi.model.slice(0, 200) : '',
    };
  }
  await updateSettings(allowed);
  cache = { at: 0, value: null }; // invalidate
  return getAdminSettings();
}
