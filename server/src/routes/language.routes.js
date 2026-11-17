import { Router } from 'express';
import { listLanguages } from '../controllers/language.controller.js';

const router = Router();

router.get('/languages', listLanguages);

export default router;
