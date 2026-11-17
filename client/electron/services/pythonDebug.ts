import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { DapTransport } from './dapTransport.js';
import { detectLocalRuntimes, type DetectedRuntime } from './runtimeProbe.js';
import { mergedPathEnv } from './runtimeProbe.js';

export type DebugEvent = Record<string, unknown>;
type Session = { id: string; owner: number; tempDir: string; sourcePath: string; child: ChildProcessWithoutNullStreams; dap: DapTransport; disposed: boolean; emit: (event: DebugEvent) => void; outputBytes: number };
const sessions = new Map<string, Session>();
const MAX_SESSIONS = 4;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function port(): Promise<number> {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const value = (server.address() as net.AddressInfo).port; server.close((error) => error ? reject(error) : resolve(value)); }); });
}

export async function pythonDebugCapability(): Promise<{ available: boolean; debuggerAvailable: boolean; runtimeAvailable: boolean; debugpyAvailable: boolean; reason?: string; setupInstructions?: string; runtime?: string; version?: string }> {
  const runtimes = await detectLocalRuntimes();
  const runtime: DetectedRuntime | undefined = runtimes.python;
  if (!runtime?.available || !runtime.path) return { available: false, debuggerAvailable: false, runtimeAvailable: false, debugpyAvailable: false, reason: runtime?.installHint || 'Python is not installed.', setupInstructions: runtime?.installHint || 'Install Python, then refresh capability status.' };
  return new Promise((resolve) => {
    const child = spawn(runtime.path!, ['-c', 'import debugpy; print(debugpy.__version__)'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = ''; child.stdout.on('data', (data) => { output += String(data); });
    const setupInstructions = `Install debugpy for the selected runtime with: ${runtime.path} -m pip install debugpy, then refresh capability status.`;
    child.on('error', () => resolve({ available: false, debuggerAvailable: false, runtimeAvailable: true, debugpyAvailable: false, reason: 'debugpy is not installed for the detected Python runtime.', setupInstructions }));
    child.on('close', (code) => resolve(code === 0
      ? { available: true, debuggerAvailable: true, runtimeAvailable: true, debugpyAvailable: true, runtime: runtime.path!, version: output.trim() }
      : { available: false, debuggerAvailable: false, runtimeAvailable: true, debugpyAvailable: false, reason: 'debugpy is not installed for the detected Python runtime.', setupInstructions }));
  });
}

export async function startPythonDebug(owner: number, args: { sourceCode: string; sourceFile?: string; executionId: string }, emit: (event: DebugEvent) => void): Promise<{ ok: true; debugSessionId: string; executionId: string } | { ok: false; message: string }> {
  if (typeof args.sourceCode !== 'string' || !args.sourceCode.trim() || args.sourceCode.length > 1_000_000) return { ok: false, message: 'Python source is empty or too large.' };
  if (sessions.size >= MAX_SESSIONS) return { ok: false, message: 'The desktop debug-session limit has been reached.' };
  const cap = await pythonDebugCapability();
  if (!cap.available || !cap.runtime) return { ok: false, message: cap.reason || 'Python debugpy is unavailable.' };
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'stackamit-debug-'));
  const sourcePath = path.join(tempDir, 'main.py');
  await fsp.writeFile(sourcePath, args.sourceCode, 'utf8');
  const debugSessionId = `debug-${randomUUID()}`;
  const dapPort = await port();
  const safeEnv: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) if (process.env[key]) safeEnv[key] = process.env[key];
  safeEnv.PATH = mergedPathEnv();
  safeEnv.PYTHONUNBUFFERED = '1'; safeEnv.PYTHONIOENCODING = 'utf-8'; safeEnv.PYTHONUTF8 = '1';
  const child = spawn(cap.runtime, ['-m', 'debugpy', '--listen', `127.0.0.1:${dapPort}`, '--wait-for-client', sourcePath], { cwd: tempDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: safeEnv });
  const dap = new DapTransport();
  const session: Session = { id: debugSessionId, owner, tempDir, sourcePath, child, dap, disposed: false, emit, outputBytes: 0 };
  sessions.set(debugSessionId, session);
  const cleanup = async () => { if (session.disposed) return; session.disposed = true; dap.close(); if (child.exitCode === null) child.kill(); sessions.delete(debugSessionId); await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {}); };
  const emitOutput = (category: string, data: unknown) => {
    if (session.disposed) return;
    const state = session;
    const text = String(data ?? '');
    const remaining = MAX_OUTPUT_BYTES - state.outputBytes;
    if (remaining <= 0) return;
    const chunk = Buffer.byteLength(text, 'utf8') <= remaining ? text : Buffer.from(text, 'utf8').subarray(0, remaining).toString('utf8');
    state.outputBytes += Buffer.byteLength(chunk, 'utf8');
    emit({ type: 'debugOutput', debugSessionId, executionId: args.executionId, category, data: chunk });
    if (state.outputBytes >= MAX_OUTPUT_BYTES) { emit({ type: 'debugError', debugSessionId, executionId: args.executionId, error: 'Debug output limit reached.' }); void cleanup(); }
  };
  child.stdout.on('data', (data) => emitOutput('stdout', data));
  child.stderr.on('data', (data) => emitOutput('stderr', data));
  child.on('close', () => { emit({ type: 'debugTerminated', debugSessionId, executionId: args.executionId }); void cleanup(); });
  dap.on('event', (event: any) => emit({ type: event.event === 'stopped' ? 'debugPaused' : event.event === 'continued' ? 'debugContinued' : event.event === 'output' ? 'debugOutput' : event.event === 'terminated' ? 'debugTerminated' : 'dapEvent', debugSessionId, executionId: args.executionId, data: event.body?.output, message: event }));
  dap.on('message', (message: any) => { if (message.type === 'response') emit({ type: 'dapResponse', debugSessionId, executionId: args.executionId, message }); });
  try { await dap.connect(dapPort); emit({ type: 'debugStarted', debugSessionId, executionId: args.executionId, sourceFile: args.sourceFile || null }); await dap.request('initialize', { clientID: 'stackamit-ide', adapterID: 'debugpy', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' }); } catch (error: any) { await cleanup(); return { ok: false, message: error.message || 'Could not connect to debugpy.' }; }
  return { ok: true, debugSessionId, executionId: args.executionId };
}

export async function requestPythonDebug(owner: number, debugSessionId: string, command: string, args: Record<string, unknown> = {}) {
  const session = sessions.get(debugSessionId);
  if (!session || session.owner !== owner) return { ok: false, message: 'Debug session not found.' };
  const allowed = new Set(['setBreakpoints', 'setExceptionBreakpoints', 'configurationDone', 'continue', 'pause', 'next', 'stepIn', 'stepOut', 'stackTrace', 'scopes', 'variables', 'evaluate', 'threads', 'disconnect', 'terminate']);
  if (!allowed.has(command)) return { ok: false, message: 'Debug operation is not allowed.' };
  if (command === 'setBreakpoints' && args.source && typeof args.source === 'object') args = { ...args, source: { ...(args.source as object), path: session.sourcePath } };
  try { await session.dap.request(command, args); if (command === 'disconnect' || command === 'terminate') { session.dap.close(); } return { ok: true }; } catch (error: any) { return { ok: false, message: error.message || 'Debug request failed.' }; }
}

export async function stopPythonDebug(owner: number, debugSessionId: string) { const session = sessions.get(debugSessionId); if (!session || session.owner !== owner) return { ok: false, message: 'Debug session not found.' }; session.child.kill(); session.dap.close(); return { ok: true }; }
