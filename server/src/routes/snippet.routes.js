import { Router } from 'express';
import { saveSnippet, getSnippet } from '../controllers/snippet.controller.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post('/', apiLimiter, saveSnippet);
router.get('/:id', apiLimiter, getSnippet);

export default router;
