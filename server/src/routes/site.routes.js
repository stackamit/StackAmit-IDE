import { Router } from 'express';
import { publicSettings, publicContent, submitContact } from '../controllers/site.controller.js';
import { contactLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.get('/settings', publicSettings);
router.get('/content', publicContent);
router.post('/contact', contactLimiter, submitContact);

export default router;
