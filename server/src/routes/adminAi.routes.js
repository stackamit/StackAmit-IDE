import { Router } from 'express';
import { adminProviderHealth, adminProviderModels, adminProviders, adminStreamChat } from '../controllers/adminAi.controller.js';
import { aiLimiter, apiLimiter } from '../middleware/rateLimiter.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requireAdminCsrf } from '../middleware/requireAdminCsrf.js';

const router = Router();
router.use(requireAdmin);
router.get('/providers', apiLimiter, adminProviders);
router.get('/providers/:provider/health', apiLimiter, adminProviderHealth);
router.get('/providers/:provider/models', apiLimiter, adminProviderModels);
router.post('/chat/stream', aiLimiter, requireAdminCsrf, adminStreamChat);
export default router;
