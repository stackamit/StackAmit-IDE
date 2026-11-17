import { Schema, model } from 'mongoose';

const installationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  pluginId: { type: String, required: true, trim: true },
  providerId: { type: String, required: true, trim: true },
  enabled: { type: Boolean, default: true },
  installedAt: { type: Date, default: Date.now },
}, { timestamps: true, versionKey: false });

installationSchema.index({ userId: 1, pluginId: 1 }, { unique: true });

export const UserPluginInstallation = model('UserPluginInstallation', installationSchema);
