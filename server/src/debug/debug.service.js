import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { env, isAllowedOrigin } from '../config/env.js';
import { requireUser } from '../middleware/requireUser.js';
import { detectRuntimes, resolveCommand } from '../services/runtimes.js';
import { executionEnv } from '../services/executionEnv.js';
import { DapTransport } from './dapTransport.js';
import { probeDebugpy } from './pythonRuntime.js';

const WS_PATH = '/api/debug';
const MAX_SOURCE_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_SESSIONS = 4;
const MAX_GUEST_SESSIONS_PER_IP = 1;
const GUEST_START_WINDOW_MS = 60_000;
const MAX_GUEST_STARTS_PER_WINDOW = 5;
const ALLOWED_COMMANDS = new Set(['setBreakpoints', 'setExceptionBreakpoints', 'configurationDone', 'continue', 'pause', 'next', 'stepIn', 'stepOut', 'stackTrace', 'scopes', 'variables', 'evaluate', 'threads', 'disconnect', 'terminate']);
const sessions = new Map();
const guestStarts = new Map();

const send = (ws, payload) => {
  if (ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(payload)); } catch { /* socket is closing */ }
  }
};

function authenticatedUser(req) {
  return new Promise((resolve) => {
    requireUser(req, null, (error) => resolve(error ? null : req.user));
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function capability({ authenticated = false, environment = 'web' } = {}) {
  const base = { authenticationRequired: false, authenticated, environment, runtimeAvailable: false, debugpyAvailable: false, debuggerAvailable: false, available: false, setupInstructions: null };
  if (!env.localRunEnabled) return { ...base, reason: 'Server-side debugging is disabled.' };
  const runtimes = await detectRuntimes();
  const python = runtimes.python;
  if (!python?.available) return { ...base, reason: 'No usable Python runtime was detected on the server.', setupInstructions: 'Install Python on the API host, ensure it is on PATH, then refresh capability status.' };
  const debugpy = await probeDebugpy(python.cmd);
  return {
    ...base,
    runtimeAvailable: true,
    debugpyAvailable: debugpy.available,
    debuggerAvailable: debugpy.available,
    available: debugpy.available,
    runtime: python.cmd,
    setupInstructions: debugpy.available ? null : `Install debugpy for the server runtime with: ${python.cmd} -m pip install debugpy, then refresh capability status.`,
    ...debugpy,
  };
}

function guestAddress(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 128);
}

function allowGuestStart(address) {
  const now = Date.now();
  const current = guestStarts.get(address) || { startedAt: now, count: 0 };
  if (now - current.startedAt >= GUEST_START_WINDOW_MS) { current.startedAt = now; current.count = 0; }
  if (current.count >= MAX_GUEST_STARTS_PER_WINDOW) return false;
  current.count += 1;
  guestStarts.set(address, current);
  return true;
}

function mapRequestArguments(session, command, args) {
  if (!args || typeof args !== 'object') return {};
  const safe = JSON.parse(JSON.stringify(args));
  if (command === 'setBreakpoints' && safe.source && typeof safe.source === 'object') safe.source.path = session.sourcePath;
  return safe;
}

async function startSession(ws, user, address, message) {
  if (message.language !== 'python') throw new Error('Only Python debugging is currently supported.');
  if (typeof message.sourceCode !== 'string' || !message.sourceCode.trim() || Buffer.byteLength(message.sourceCode, 'utf8') > MAX_SOURCE_BYTES) throw new Error('Python source is empty or exceeds the debug size limit.');
  const cap = await capability({ authenticated: Boolean(user) });
  if (!cap.available) throw new Error(cap.reason);
  if (!user && !allowGuestStart(address)) throw new Error('Guest debug start rate limit reached. Please wait before starting another session.');
  const debugSessionId = `debug-${crypto.randomUUID()}`;
  const executionId = `debug-exec-${crypto.randomUUID()}`;
  const tempDir = await mkdtemp(path.join(tmpdir(), 'stackamit-debug-'));
  const sourcePath = path.join(tempDir, 'main.py');
  await writeFile(sourcePath, message.sourceCode, 'utf8');
  const port = await reservePort();
  const child = spawn(resolveCommand(cap.runtime), ['-m', 'debugpy', '--listen', `127.0.0.1:${port}`, '--wait-for-client', sourcePath], {
    cwd: tempDir,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: executionEnv(process.env, { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
  });
  const session = { debugSessionId, executionId, userId: user?.id || null, ownerAddress: address, ws, child, tempDir, sourcePath, dap: null, disposed: false, timer: null, outputBytes: 0 };
  const cleanup = async () => {
    if (session.disposed) return;
    session.disposed = true;
    if (session.timer) clearTimeout(session.timer);
    try { session.dap?.close(); } catch { /* ignore */ }
    try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* ignore */ }
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    sessions.delete(ws);
  };
  session.cleanup = cleanup;
  const emitOutput = (category, data) => {
    if (session.disposed) return;
    const text = String(data ?? '');
    const remaining = MAX_OUTPUT_BYTES - session.outputBytes;
    if (remaining <= 0) return;
    const chunk = Buffer.byteLength(text, 'utf8') <= remaining ? text : Buffer.from(text, 'utf8').subarray(0, remaining).toString('utf8');
    session.outputBytes += Buffer.byteLength(chunk, 'utf8');
    send(ws, { type: 'debugOutput', debugSessionId, executionId, category, data: chunk });
    if (session.outputBytes >= MAX_OUTPUT_BYTES) {
      send(ws, { type: 'debugError', debugSessionId, executionId, error: 'Debug output limit reached.' });
      void cleanup();
    }
  };
  session.timer = setTimeout(() => { send(ws, { type: 'debugError', debugSessionId, executionId, error: 'Debug session timed out.' }); void cleanup(); }, env.executionTimeoutMs);
  child.stdout.on('data', (data) => emitOutput('stdout', data));
  child.stderr.on('data', (data) => emitOutput('stderr', data));
  child.on('error', (error) => send(ws, { type: 'debugError', debugSessionId, executionId, error: error.message || 'Debugger process failed.' }));
  child.on('close', async () => { send(ws, { type: 'debugTerminated', debugSessionId, executionId }); await cleanup(); });

  const dap = new DapTransport();
  session.dap = dap;
  dap.on('error', (error) => send(ws, { type: 'debugError', debugSessionId, executionId, error: error.message || 'DAP connection failed.' }));
  dap.on('message', (dapMessage) => {
    if (session.disposed) return;
    if (dapMessage.type === 'response') send(ws, { type: 'dapResponse', debugSessionId, executionId, message: dapMessage });
  });
  dap.on('event', (event) => {
    if (session.disposed) return;
    const body = event.body || {};
    if (event.event === 'initialized') send(ws, { type: 'debugInitialized', debugSessionId, executionId });
    else if (event.event === 'output') emitOutput(body.category || 'console', body.output || '');
    else if (event.event === 'stopped') send(ws, { type: 'debugPaused', debugSessionId, executionId, reason: body.reason || 'paused', threadId: body.threadId });
    else if (event.event === 'continued') send(ws, { type: 'debugContinued', debugSessionId, executionId });
    else if (event.event === 'breakpoint') send(ws, { type: 'breakpoint', debugSessionId, executionId, breakpoint: body.breakpoint || null });
    else if (event.event === 'terminated' || event.event === 'exited') send(ws, { type: 'debugTerminated', debugSessionId, executionId });
    else send(ws, { type: 'dapEvent', debugSessionId, executionId, message: event });
  });
  try {
    await dap.connect('127.0.0.1', port);
    send(ws, { type: 'debugStarted', debugSessionId, executionId, language: 'python', sourceFile: message.sourceFile || null, capabilities: { supportsConfigurationDoneRequest: true } });
    await dap.request('initialize', { clientID: 'stackamit-ide', adapterID: 'debugpy', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
    return session;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function attachSessionHandlers(ws, sessions, user, address) {
  let starting = false;
  const start = async (message) => {
    if (starting || sessions.has(ws)) throw new Error('A debug session is already active on this connection.');
    if (sessions.size >= MAX_SESSIONS) throw new Error('The server debug-session limit has been reached.');
    starting = true;
    try {
      if (!user && [...sessions.values()].filter((item) => item.ownerAddress === address && !item.userId).length >= MAX_GUEST_SESSIONS_PER_IP) throw new Error('A guest debug session is already active from this network address.');
      const session = await startSession(ws, user, address, message);
      sessions.set(ws, session);
    } finally {
      starting = false;
    }
  };
  ws.on('message', async (raw) => {
    if (raw.length > MAX_REQUEST_BYTES) return send(ws, { type: 'debugError', error: 'Debug request is too large.' });
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'debugError', error: 'Invalid debug request.' }); }
    try {
      if (message.type === 'start') await start(message);
      else {
        const session = sessions.get(ws);
        if (!session || typeof message.command !== 'string' || !ALLOWED_COMMANDS.has(message.command)) throw new Error('Invalid or unavailable debug operation.');
        if (message.arguments && JSON.stringify(message.arguments).length > MAX_REQUEST_BYTES) throw new Error('Debug arguments are too large.');
        const args = mapRequestArguments(session, message.command, message.arguments);
        await session.dap.request(message.command, args);
        if (message.command === 'disconnect' || message.command === 'terminate') await session.cleanup();
      }
    } catch (error) {
      send(ws, { type: 'debugError', debugSessionId: sessions.get(ws)?.debugSessionId, executionId: sessions.get(ws)?.executionId, error: error.message || 'Debug operation failed.' });
    }
  });
  ws.on('close', () => { void sessions.get(ws)?.cleanup(); sessions.delete(ws); });
}

export function attachDebugServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  const onUpgrade = async (req, socket, head) => {
    const [pathname] = String(req.url || '').split('?');
    if (pathname !== WS_PATH) return;
    if (!isAllowedOrigin(req.headers.origin)) { socket.destroy(); return; }
    const user = await authenticatedUser(req);
    const address = guestAddress(req);
    wss.handleUpgrade(req, socket, head, (ws) => { wss.emit('connection', ws, req); attachSessionHandlers(ws, sessions, user, address); });
  };
  httpServer.on('upgrade', onUpgrade);
  wss.on('connection', () => {});
  return () => { httpServer.off('upgrade', onUpgrade); wss.close(); for (const session of sessions.values()) void session.cleanup(); };
}

export { capability as debugCapability, ALLOWED_COMMANDS };
