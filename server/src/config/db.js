import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

let readyState = mongoose.connection.readyState;
mongoose.connection.on('connected', () => { readyState = 1; });
mongoose.connection.on('disconnected', () => { readyState = 0; });
mongoose.connection.on('reconnected', () => { readyState = 1; });

/**
 * Connect to MongoDB Atlas when a URI is configured. Failure is logged but
 * never fatal: the editor and execution workflow must keep working without the
 * database (snippet sharing degrades gracefully).
 */
export async function connectDatabase(logger = console) {
  if (!env.mongoUri) {
    logger.warn?.({ msg: 'MONGODB_URI not set — snippet persistence disabled, core editor still available.' });
    return { connected: false, reason: 'NOT_CONFIGURED' };
  }
  try {
    await mongoose.connect(env.mongoUri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 15000,
    });
    readyState = 1;
    logger.info?.({ msg: 'MongoDB connected.' });
    return { connected: true };
  } catch (err) {
    readyState = 0;
    logger.error?.({ msg: 'MongoDB connection failed — continuing without persistence.', error: err.message });
    return { connected: false, reason: 'CONNECTION_FAILED' };
  }
}

export function isDatabaseConnected() {
  // readyState 1 === connected
  return (mongoose.connection.readyState || readyState) === 1;
}

export { mongoose };
