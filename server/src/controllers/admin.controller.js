import { env } from '../config/env.js';
import { verifyCredentials, signToken, authConfigured } from '../config/auth.js';
import { isDatabaseConnected } from '../config/db.js';
import { providerStatus } from '../services/execution.service.js';
import { getAdminSettings, saveAdminSettings } from '../services/settings.service.js';
import { getAdminContent, saveAdminContent } from '../services/content.service.js';
import { Snippet } from '../models/Snippet.js';
import { ExecutionLog } from '../models/ExecutionLog.js';
import { ContactMessage } from '../models/ContactMessage.js';
import { loginSchema, settingsPatchSchema, contentPatchSchema, validate } from '../validators/code.validator.js';
import { ApiError, ErrorCodes } from '../utils/ApiError.js';
import crypto from 'node:crypto';

const COOKIE = 'stackamit_admin';

function setAuthCookie(res, token) {
  const maxAge = env.adminTokenTtlHours * 3600;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Path=/;${env.isProd ? ' Secure;' : ''}`,
  );
  res.cookie('stackamit_admin_csrf', crypto.randomBytes(32).toString('base64url'), { httpOnly: false, sameSite: 'lax', secure: env.isProd, maxAge: env.adminTokenTtlHours * 3600000, path: '/' });
}

/** POST /api/admin/login — the only authentication entry point (no registration). */
export async function login(req, res, next) {
  try {
    if (!authConfigured()) {
      throw new ApiError('Admin authentication is not configured on this server.', {
        status: 503,
        code: ErrorCodes.SERVER_CONFIG,
      });
    }
    const { username, password } = validate(loginSchema, req.body);
    if (!verifyCredentials(username, password)) {
      // Uniform message: never reveal whether the username or password failed.
      throw new ApiError('Invalid username or password.', { status: 401, code: ErrorCodes.UNAUTHORIZED });
    }
    const token = signToken();
    setAuthCookie(res, token);
    res.status(200).json({
      success: true,
      status: 'success',
      data: { token, username, expiresInHours: env.adminTokenTtlHours },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/logout */
export async function logout(_req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
  res.clearCookie('stackamit_admin_csrf', { sameSite: 'lax', secure: env.isProd, path: '/' });
  res.json({ success: true, status: 'success', data: { loggedOut: true } });
}

/** GET /api/admin/me (protected) */
export async function me(req, res) {
  res.json({ success: true, status: 'success', data: { authenticated: true, username: req.admin.username } });
}

/** GET /api/admin/dashboard (protected) — usage stats + subsystem status. */
export async function dashboard(_req, res, next) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let stats = { total: 0, succeeded: 0, failed: 0, byLanguage: [], avgTimeMs: null };
    let snippetCount = 0;
    let unreadMessages = 0;

    if (isDatabaseConnected()) {
      const agg = await ExecutionLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            succeeded: { $sum: { $cond: ['$success', 1, 0] } },
            avgTime: { $avg: '$executionTimeMs' },
          },
        },
      ]).catch(() => []);
      if (agg[0]) {
        stats.total = agg[0].total;
        stats.succeeded = agg[0].succeeded;
        stats.failed = agg[0].total - agg[0].succeeded;
        stats.avgTimeMs = agg[0].avgTime != null ? Math.round(agg[0].avgTime) : null;
      }
      stats.byLanguage = await ExecutionLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).catch(() => []);

      snippetCount = await Snippet.countDocuments().catch(() => 0);
      unreadMessages = await ContactMessage.countDocuments({ read: false }).catch(() => 0);
    }

    const provider = await providerStatus();
    res.json({
      success: true,
      status: 'success',
      data: {
        rangeDays: 30,
        executions: stats,
        snippets: { count: snippetCount },
        messages: { unread: unreadMessages },
        subsystems: {
          database: { connected: isDatabaseConnected() },
          provider,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/executions (protected) — recent audit rows (no source/stdin). */
export async function recentExecutions(req, res, next) {
  try {
    if (!isDatabaseConnected()) {
      return res.json({ success: true, status: 'success', data: { items: [], persisted: false } });
    }
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const items = await ExecutionLog.find().sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ success: true, status: 'success', data: { items, persisted: true } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/settings (protected) */
export async function readSettings(_req, res, next) {
  try {
    res.json({ success: true, status: 'success', data: await getAdminSettings() });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/settings (protected) */
export async function patchSettings(req, res, next) {
  try {
    const patch = validate(settingsPatchSchema, req.body);
    res.json({ success: true, status: 'success', data: await saveAdminSettings(patch) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/snippets (protected) — list metadata (never the source). */
export async function listSnippets(req, res, next) {
  try {
    if (!isDatabaseConnected()) {
      return res.json({ success: true, status: 'success', data: { items: [], persisted: false } });
    }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const items = await Snippet.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('_id language title isPublic viewCount createdAt expiresAt')
      .lean();
    res.json({ success: true, status: 'success', data: { items, persisted: true } });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/admin/snippets/:id (protected) */
export async function deleteSnippet(req, res, next) {
  try {
    if (!isDatabaseConnected()) {
      throw new ApiError('Database is offline; cannot delete snippets.', { status: 503, code: ErrorCodes.DB_UNAVAILABLE });
    }
    const deleted = await Snippet.findByIdAndDelete(req.params.id).catch(() => null);
    if (!deleted) {
      throw new ApiError('Snippet not found.', { status: 404, code: ErrorCodes.NOT_FOUND });
    }
    res.json({ success: true, status: 'success', data: { deleted: true, id: req.params.id } });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/content (protected) — editable page copy. */
export async function readContent(_req, res, next) {
  try {
    res.json({ success: true, status: 'success', data: await getAdminContent() });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/content (protected) — overwrite public-page data. */
export async function patchContent(req, res, next) {
  try {
    const patch = validate(contentPatchSchema, req.body);
    res.json({ success: true, status: 'success', data: await saveAdminContent(patch) });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/messages (protected) — contact-form inbox. */
export async function listMessages(req, res, next) {
  try {
    if (!isDatabaseConnected()) {
      return res.json({ success: true, status: 'success', data: { items: [], unread: 0, persisted: false } });
    }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const [items, unread] = await Promise.all([
      ContactMessage.find().sort({ createdAt: -1 }).limit(limit).lean(),
      ContactMessage.countDocuments({ read: false }),
    ]);
    res.json({ success: true, status: 'success', data: { items, unread, persisted: true } });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/messages/:id (protected) — toggle read flag. */
export async function updateMessage(req, res, next) {
  try {
    if (!isDatabaseConnected()) {
      throw new ApiError('Database is offline.', { status: 503, code: ErrorCodes.DB_UNAVAILABLE });
    }
    const read = Boolean(req.body?.read);
    const doc = await ContactMessage.findByIdAndUpdate(req.params.id, { $set: { read } }, { new: true }).lean().catch(() => null);
    if (!doc) throw new ApiError('Message not found.', { status: 404, code: ErrorCodes.NOT_FOUND });
    res.json({ success: true, status: 'success', data: doc });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/admin/messages/:id (protected) */
export async function deleteMessage(req, res, next) {
  try {
    if (!isDatabaseConnected()) {
      throw new ApiError('Database is offline.', { status: 503, code: ErrorCodes.DB_UNAVAILABLE });
    }
    const deleted = await ContactMessage.findByIdAndDelete(req.params.id).catch(() => null);
    if (!deleted) throw new ApiError('Message not found.', { status: 404, code: ErrorCodes.NOT_FOUND });
    res.json({ success: true, status: 'success', data: { deleted: true, id: req.params.id } });
  } catch (err) {
    next(err);
  }
}
