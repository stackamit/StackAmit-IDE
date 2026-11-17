import { Router } from 'express';
import { requireCsrf, requireUser } from '../middleware/requireUser.js';
import { deleteProvider, installPlugin, listModels, listPlugins, listProviders, saveProvider, setDefaultModel, testProvider, uninstallPlugin } from '../controllers/userAi.controller.js';

const router = Router();
router.use(requireUser);
router.get('/providers', listProviders);
router.post('/providers/:provider', requireCsrf, saveProvider);
router.put('/providers/:provider', requireCsrf, saveProvider);
router.delete('/providers/:provider', requireCsrf, deleteProvider);
router.post('/providers/:provider/test', testProvider);
router.get('/providers/:provider/test', testProvider);
router.get('/providers/:provider/models', listModels);
router.patch('/providers/:provider/default-model', requireCsrf, setDefaultModel);
router.get('/plugins', listPlugins);
router.post('/plugins/:pluginId/install', requireCsrf, installPlugin);
router.delete('/plugins/:pluginId', requireCsrf, uninstallPlugin);
export default router;
