import { Router } from 'express';
import { csrf, desktopLogin, desktopRegister, login, logout, me, register, resendVerification, requestPasswordReset, resetPassword, updateProfile, verifyEmail } from '../controllers/userAuth.controller.js';
import { requireCsrf, requireUser } from '../middleware/requireUser.js';
import { loginLimiter, passwordResetLimiter, verificationLimiter } from '../middleware/rateLimiter.js';

const router = Router();
router.get('/csrf', csrf);
router.post('/register', loginLimiter, register);
router.post('/desktop/register', loginLimiter, desktopRegister);
router.post('/login', loginLimiter, login);
router.post('/desktop/login', loginLimiter, desktopLogin);
router.post('/verify-email', verificationLimiter, verifyEmail);
router.post('/resend-verification', verificationLimiter, resendVerification);
router.post('/password-reset/request', passwordResetLimiter, requestPasswordReset);
router.post('/password-reset/confirm', passwordResetLimiter, resetPassword);
router.get('/me', requireUser, me);
router.patch('/profile', requireUser, requireCsrf, updateProfile);
router.post('/logout', requireUser, requireCsrf, logout);
export default router;
