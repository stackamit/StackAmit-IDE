import { spawn } from 'node:child_process';
import { executionEnv } from '../services/executionEnv.js';
import { resolveCommand } from '../services/runtimes.js';

export function probeDebugpy(pythonCommand, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = (result) => { if (!done) { done = true; clearTimeout(timer); resolve(result); } };
    let child;
    try {
      child = spawn(resolveCommand(pythonCommand), ['-c', 'import debugpy; print(debugpy.__version__)'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: executionEnv(process.env),
      });
    } catch (error) {
      finish({ available: false, reason: error.message || 'Python could not be started.' });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += String(data).slice(0, 200); });
    child.stderr.on('data', (data) => { stderr += String(data).slice(0, 500); });
    child.on('error', (error) => finish({ available: false, reason: error.message || 'Python could not be started.' }));
    child.on('close', (code) => finish(code === 0
      ? { available: true, version: stdout.trim() || 'installed' }
      : { available: false, reason: 'debugpy is not installed for the selected Python runtime.', detail: stderr.trim().slice(0, 300) }));
    timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } finish({ available: false, reason: 'Python debugpy detection timed out.' }); }, timeoutMs);
  });
}
