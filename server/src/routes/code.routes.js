import { Router } from 'express';
import { runCode, executionStatus, lintCode } from '../controllers/code.controller.js';
import { executionLimiter, lintLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Execution status is a cheap readiness check, no strict limiter.
router.get('/execution/status', executionStatus);

// Live syntax checking for as-you-type error highlighting (local, cheap).
router.post('/code/lint', lintLimiter, lintCode);

// All execution traffic is strictly rate limited.
router.post('/code/run', executionLimiter, runCode);

export default router;
