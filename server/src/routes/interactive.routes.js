import { Router } from 'express';
import { env } from '../config/env.js';
import { detectRuntimes } from '../services/runtimes.js';
import { getInstallPlan } from '../services/runtimeInstaller.js';

const router = Router();

// Reports whether local interactive execution is enabled and which toolchains
// are usable on the server, so the UI can offer the mode only where it works.
router.get('/status', async (_req, res, next) => {
  try {
    const runtimes = env.localRunEnabled ? await detectRuntimes() : {};
    res.json({ enabled: env.localRunEnabled, runtimes });
  } catch (err) {
    next(err);
  }
});

// Describes the command that installing a language's runtime would run, so the
// consent popup can show exactly what will happen before the user agrees.
router.get('/install/plan/:language', async (req, res, next) => {
  try {
    if (!env.localRunEnabled) return res.json({ supported: false, enabled: false });
    const plan = await getInstallPlan(String(req.params.language || ''));
    res.json({ ...plan, enabled: true });
  } catch (err) {
    next(err);
  }
});

export default router;
