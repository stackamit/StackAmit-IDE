import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pinoHttp } from 'pino-http';

import { env, isAllowedOrigin } from './config/env.js';
import { logger } from './config/logger.js';
import healthRoutes from './routes/health.routes.js';
import languageRoutes from './routes/language.routes.js';
import codeRoutes from './routes/code.routes.js';
import interactiveRoutes from './routes/interactive.routes.js';
import snippetRoutes from './routes/snippet.routes.js';
import siteRoutes from './routes/site.routes.js';
import adminRoutes from './routes/admin.routes.js';
import aiRoutes from './routes/ai.routes.js';
import adminAiRoutes from './routes/adminAi.routes.js';
import authRoutes from './routes/auth.routes.js';
import userAiRoutes from './routes/userAi.routes.js';
import debugRoutes from './routes/debug.routes.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

// Behind a reverse proxy (Render/Fly/etc.) so rate limiting keys on real IPs.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers. The API only returns JSON; CSP is relaxed to avoid
// interfering but XSS protections (frame/embedding) stay on.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: env.isProd ? undefined : false,
  }),
);

// Restrict CORS to the configured frontend origin (shared with the
// interactive WebSocket handshake — see config/env.js).
app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / curl / no-Origin requests.
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    credentials: true,
  }),
);

// Body parsing with an explicit byte cap derived from configured limits.
const bodyLimit = env.maxSourceBytes + env.maxStdinBytes + 8192;
app.use(express.json({ limit: bodyLimit }));

// Structured request logging (redaction configured in logger.js).
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

// API routes.
app.use('/api/health', healthRoutes);
app.use('/api', languageRoutes);
app.use('/api', codeRoutes);
app.use('/api/interactive', interactiveRoutes);
app.use('/api/snippets', snippetRoutes);
app.use('/api/site', siteRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin/ai', adminAiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user/ai', userAiRoutes);
app.use('/api/debug', debugRoutes);

// Root probe for quick manual checks.
app.get('/', (_req, res) => res.json({ name: 'StackAmit-IDE API', docs: '/api/health' }));

// 404 + centralized error handling (registered last).
app.use(notFound);
app.use(errorHandler);

export default app;
