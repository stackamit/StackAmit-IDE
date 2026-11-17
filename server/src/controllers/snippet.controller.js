import { env } from '../config/env.js';
import { isDatabaseConnected } from '../config/db.js';
import { Snippet } from '../models/Snippet.js';
import { saveSnippetSchema, validate } from '../validators/code.validator.js';
import { getEffectiveSettings } from '../services/settings.service.js';
import { ApiError, ErrorCodes } from '../utils/ApiError.js';

async function ensureFeatureEnabled() {
  const settings = await getEffectiveSettings();
  if (!settings.snippetEnabled) {
    throw new ApiError('Snippet sharing is not enabled on this deployment.', {
      status: 404,
      code: ErrorCodes.NOT_FOUND,
    });
  }
  if (!isDatabaseConnected()) {
    throw new ApiError('Snippet storage is temporarily unavailable (database offline).', {
      status: 503,
      code: ErrorCodes.DB_UNAVAILABLE,
    });
  }
}

/**
 * POST /api/snippets
 * Save a snippet without an account and return a shareable id. Public snippets
 * use unpredictable ids; private snippets are never returned by the public GET.
 */
export async function saveSnippet(req, res, next) {
  try {
    await ensureFeatureEnabled();
    const { language, sourceCode, title, isPublic } = validate(saveSnippetSchema, req.body);

    const expiresAt = new Date(Date.now() + env.snippetTtlDays * 24 * 60 * 60 * 1000);
    const doc = await Snippet.create({ language, sourceCode, title, isPublic, expiresAt });

    res.status(201).json({
      success: true,
      id: doc._id,
      language: doc.language,
      title: doc.title,
      isPublic: doc.isPublic,
      expiresAt: doc.expiresAt,
      shareUrl: isPublic ? `/snippet/${doc._id}` : null,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/snippets/:id
 * Returns a snippet only when the feature is enabled and the snippet is public.
 */
export async function getSnippet(req, res, next) {
  try {
    await ensureFeatureEnabled();
    const { id } = req.params;
    // Unpredictable ids are not validated beyond presence.
    if (!id || typeof id !== 'string' || id.length > 64) {
      throw new ApiError('Snippet not found.', { status: 404, code: ErrorCodes.NOT_FOUND });
    }

    const doc = await Snippet.findById(id).lean();
    if (!doc || !doc.isPublic || (doc.expiresAt && doc.expiresAt < new Date())) {
      throw new ApiError('Snippet not found or is private.', { status: 404, code: ErrorCodes.NOT_FOUND });
    }

    res.status(200).json({
      success: true,
      id: doc._id,
      language: doc.language,
      title: doc.title,
      sourceCode: doc.sourceCode,
      createdAt: doc.createdAt,
      expiresAt: doc.expiresAt,
    });
  } catch (err) {
    next(err);
  }
}
