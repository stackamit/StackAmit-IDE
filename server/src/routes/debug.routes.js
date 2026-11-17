import { Router } from 'express';
import { requireUser } from '../middleware/requireUser.js';
import { debugCapability } from '../debug/debug.service.js';

const router = Router();
router.get('/capabilities', async (req, res, next) => {
  requireUser(req, res, async (error) => {
    if (error && ![401, 403].includes(error.status)) return next(error);
    try { res.json({ python: await debugCapability({ authenticated: !error && Boolean(req.user) }) }); } catch (capabilityError) { next(capabilityError); }
  });
});
export default router;
