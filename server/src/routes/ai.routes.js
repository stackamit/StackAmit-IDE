import { Router } from 'express';
import { pluginCatalog, pluginDetails, providerCatalog, providerHealth, providerModels, streamChat } from '../controllers/ai.controller.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { requireCsrf, requireUser } from '../middleware/requireUser.js';

const router = Router();
router.get('/providers', providerCatalog);
router.get('/plugins', pluginCatalog);
router.get('/plugins/:pluginId', pluginDetails);
router.get('/providers/:provider/health', requireUser, providerHealth);
router.get('/providers/:provider/models', requireUser, providerModels);
router.post('/chat/stream', aiLimiter, requireUser, requireCsrf, streamChat);
export default router;
