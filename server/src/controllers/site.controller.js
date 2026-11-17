import { isDatabaseConnected } from '../config/db.js';
import { getEffectiveSettings } from '../services/settings.service.js';
import { getPublicContent } from '../services/content.service.js';
import { ContactMessage } from '../models/ContactMessage.js';
import { contactSchema, validate } from '../validators/code.validator.js';
import { ApiError, ErrorCodes } from '../utils/ApiError.js';

/**
 * GET /api/site/settings — public, non-sensitive settings the frontend renders
 * (announcement banner + whether snippet sharing is active).
 */
export async function publicSettings(_req, res, next) {
  try {
    const s = await getEffectiveSettings();
    res.json({
      success: true,
      status: 'success',
      data: {
        announcementBanner: s.bannerEnabled ? s.announcementBanner : '',
        snippetEnabled: s.snippetEnabled,
        maintenanceMessage: s.maintenanceMessage || '',
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/site/content — admin-managed copy for the Home/About/Contact pages. */
export async function publicContent(_req, res, next) {
  try {
    const content = await getPublicContent();
    res.json({ success: true, status: 'success', data: content });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/site/contact — store a contact-form submission for the admin inbox.
 * Requires MongoDB; the frontend falls back to a mailto link when it isn't
 * available, so this never silently drops a message.
 */
export async function submitContact(req, res, next) {
  try {
    if (!isDatabaseConnected()) {
      throw new ApiError('Contact storage is temporarily unavailable (database offline).', {
        status: 503,
        code: ErrorCodes.DB_UNAVAILABLE,
      });
    }
    const data = validate(contactSchema, req.body);
    const doc = await ContactMessage.create(data);
    res.status(201).json({
      success: true,
      status: 'success',
      data: { id: doc._id, receivedAt: doc.createdAt },
    });
  } catch (err) {
    next(err);
  }
}
