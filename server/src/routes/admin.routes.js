import { Router } from 'express';
import {
  login,
  logout,
  me,
  dashboard,
  recentExecutions,
  readSettings,
  patchSettings,
  listSnippets,
  deleteSnippet,
  readContent,
  patchContent,
  listMessages,
  updateMessage,
  deleteMessage,
} from '../controllers/admin.controller.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requireAdminCsrf } from '../middleware/requireAdminCsrf.js';
import { loginLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Public (but brute-force limited): the single admin authentication entry point.
router.post('/login', loginLimiter, login);
router.post('/logout', logout);

// Everything below requires a valid admin session.
router.get('/me', requireAdmin, me);
router.get('/dashboard', requireAdmin, dashboard);
router.get('/executions', requireAdmin, recentExecutions);
router.get('/settings', requireAdmin, readSettings);
router.get('/content', requireAdmin, readContent);
router.patch('/content', requireAdmin, requireAdminCsrf, patchContent);
router.get('/messages', requireAdmin, listMessages);
router.patch('/messages/:id', requireAdmin, requireAdminCsrf, updateMessage);
router.delete('/messages/:id', requireAdmin, requireAdminCsrf, deleteMessage);
router.patch('/settings', requireAdmin, requireAdminCsrf, patchSettings);
router.get('/snippets', requireAdmin, listSnippets);
router.delete('/snippets/:id', requireAdmin, requireAdminCsrf, deleteSnippet);

export default router;
