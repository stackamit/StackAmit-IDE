import { Schema, model } from 'mongoose';

/**
 * Singleton site settings editable by the admin from the dashboard.
 * A single document with _id 'site' holds all mutable public configuration.
 */
const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'site' },
    announcementBanner: { type: String, default: '', maxlength: 240 },
    bannerEnabled: { type: Boolean, default: false },
    // When null, fall back to the SNIPPET_ENABLED env default.
    snippetEnabledOverride: { type: Boolean, default: null },
    maintenanceMessage: { type: String, default: '', maxlength: 240 },
    adminAi: {
      provider: { type: String, default: '' },
      model: { type: String, default: '' },
    },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export const Settings = model('Settings', settingsSchema);

/** Returns the settings doc, creating the singleton on first access. */
export async function getSettings() {
  let doc = await Settings.findById('site').lean();
  if (!doc) {
    doc = await Settings.create({ _id: 'site' }).then((d) => d.toObject());
  }
  return doc;
}

export async function updateSettings(patch) {
  const doc = await Settings.findByIdAndUpdate(
    'site',
    { $set: { ...patch, updatedAt: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return doc;
}
