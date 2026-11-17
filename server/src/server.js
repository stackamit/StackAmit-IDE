import app from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase } from './config/db.js';
import { authConfigured } from './config/auth.js';
import { attachInteractiveServer } from './services/interactive.service.js';
import { attachDebugServer } from './debug/debug.service.js';

async function start() {
  // Fail fast on an unsafe production configuration for admin sessions.
  if (env.isProd && !env.adminJwtSecret) {
    logger.error({ msg: 'ADMIN_JWT_SECRET must be set in production. Refusing to start.' });
    process.exit(1);
  }
  if (!authConfigured()) {
    logger.warn({ msg: 'Admin credentials not configured (ADMIN_USERNAME/ADMIN_PASSWORD); /login will be disabled.' });
  }

  // Database is optional for the core workflow; never block startup on it.
  await connectDatabase(logger);

  const server = app.listen(env.port, () => {
    logger.info({ msg: `StackAmit-IDE API listening on http://localhost:${env.port}` });
    logger.info({ msg: `Execution provider: ${env.executionProvider}` });
  });

  // Local interactive execution rides on the same HTTP server via WS upgrade.
  attachInteractiveServer(server);
  attachDebugServer(server);

  // A raw 'EADDRINUSE' would otherwise throw an unhandled 'error' event and
  // dump a stack trace. Handle it with a clear, actionable message instead.
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.fatal({
        msg: `Port ${env.port} is already in use — another StackAmit-IDE API instance is likely running. Stop it, or start this one on another port (e.g. PORT=5001 npm run dev).`,
      });
    } else {
      logger.fatal({ msg: 'Server error', error: err.message });
    }
    process.exit(1);
  });

  const shutdown = (signal) => {
    logger.info({ msg: `Received ${signal}, shutting down…` });
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  logger.error({ msg: 'Unhandled rejection', reason: String(reason) });
});

start().catch((err) => {
  logger.error({ msg: 'Fatal startup error', error: err.message });
  process.exit(1);
});
