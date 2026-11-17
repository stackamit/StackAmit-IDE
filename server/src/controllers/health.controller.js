import mongoose from 'mongoose';
import { providerStatus } from '../services/execution.service.js';

/**
 * GET /api/health
 * Lightweight liveness + dependency summary. Exposes only booleans/short
 * labels — never connection strings, secrets, or provider internals.
 */
export async function health(_req, res) {
  const dbState = mongoose.connection.readyState; // 0 disconnected,1 connected,2 connecting,3 disconnecting
  const execution = await providerStatus();
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    database: { connected: dbState === 1, state: stateLabel(dbState) },
    execution: {
      configured: execution.configured,
      provider: execution.name,
      available: Boolean(execution.available),
    },
  });
}

function stateLabel(state) {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][state] || 'unknown';
}
