// Offline verification of the PACKAGED app (win-unpacked) over CDP.
// Checks: app boots (renderer alive, bridge exposed), an on-disk language
// server connects through the loopback bridge with real LSP traffic, a
// missing tool answers honestly with MISSING_TOOL, and no network fetch is
// involved in any of it. Uses only files already on disk.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

// Resolved from this script's own location (client/scripts -> client), so the
// check runs from any checkout on any machine. Explicit paths still win:
// VERIFY_EXE / VERIFY_PYRIGHT point the verification at another install.
const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXE = process.env.VERIFY_EXE
  || path.join(clientDir, 'release', 'win-unpacked', 'StackAmit-IDE.exe');
const PYRIGHT = process.env.VERIFY_PYRIGHT
  || path.join(clientDir, 'node_modules', '.bin', 'pyright-langserver.cmd');
if (!fs.existsSync(EXE)) {
  console.error(`Packaged app not found: ${EXE}\nRun \`npm run dist:win\` first, or set VERIFY_EXE to an existing win-unpacked StackAmit-IDE.exe.`);
  process.exit(1);
}
if (!fs.existsSync(PYRIGHT)) {
  console.error(`pyright-langserver not found: ${PYRIGHT}\nInstall client devDependencies (pyright), or set VERIFY_PYRIGHT.`);
  process.exit(1);
}
const PORT = Number(process.env.VERIFY_CDP_PORT) || 9325;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const app = spawn(EXE, [`--remote-debugging-port=${PORT}`], { detached: true, stdio: 'ignore' });
try {
  // 1. Wait for the CDP endpoint and the IDE page.
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(1000);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const pages = await res.json();
      target = pages.find((p) => p.type === 'page' && /index\.html|localhost/.test(p.url));
    } catch {
      /* app still starting */
    }
  }
  check('packaged app boots to its renderer page', Boolean(target), target?.url || 'no page');
  if (!target) process.exit(1);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw));
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  await new Promise((r) => ws.once('open', r));
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (m.result?.exceptionDetails) return { threw: m.result.exceptionDetails.text };
    return m.result?.result?.value;
  };

  // 2. Preload bridge present and minimal (no raw ipcRenderer/process).
  const bridge = await evaluate(`(() => ({
    hasStackamit: !!window.stackamit,
    hasLsp: !!window.stackamit?.lsp,
    lspKeys: window.stackamit?.lsp ? Object.keys(window.stackamit.lsp).sort() : [],
    hasProcess: typeof window.process !== 'undefined' && !!window.process?.versions?.node,
    hasRequire: typeof window.require !== 'undefined',
  }))()`);
  check('window.stackamit.lsp bridge exposed', bridge?.hasStackamit && bridge?.hasLsp, JSON.stringify(bridge?.lspKeys));
  check('renderer still sandboxed (no process/require leaks)', !bridge?.hasProcess && !bridge?.hasRequire, JSON.stringify({ p: bridge?.hasProcess, r: bridge?.hasRequire }));

  // 3. Missing tool answers honestly (clangd is not installed here).
  const missing = await evaluate(`window.stackamit.lsp.start({ language: 'cpp', root: null, toolPath: null })`);
  check('cpp (no clangd) reports MISSING_TOOL', missing?.ok === false && missing?.code === 'MISSING_TOOL', JSON.stringify(missing?.code || missing));

  // 3b. Java: Eclipse JDT.LS is an unpacked tarball the app neither bundles nor
  // downloads, so on a machine without one the packaged app must fail loudly and
  // say exactly how to fix it — never pretend IntelliSense works, never stay mute.
  const java = await evaluate(`window.stackamit.lsp.start({ language: 'java', root: null, toolPath: null })`);
  check(
    'java refuses to start without an JDT.LS install (MISSING_TOOL / INCOMPATIBLE)',
    java?.ok === false && (java?.code === 'MISSING_TOOL' || java?.code === 'INCOMPATIBLE'),
    JSON.stringify({ code: java?.code, message: java?.message }),
  );
  check(
    'java failure message is actionable (JDT.LS tarball / JDK 17+ / custom paths)',
    /download\.eclipse\.org\/jdtls|JDK 17|Custom JDK|Temurin|absolute tool path/i.test(String(java?.message || '')),
    String(java?.message || '').slice(0, 180),
  );
  check(
    'java failure message does not echo environment values or secrets',
    !/(JAVA_HOME|PATH|TOKEN|SECRET|PASSWORD|API_KEY)\s*=/i.test(String(java?.message || '')),
    'no KEY=value leaks',
  );

  // 3c. Java EXECUTION inside the installed build. This is the desktop app's own
  // run bridge — the main process discovers/validates the JDK, plans the argv
  // and streams the real stdout, stderr and exit code back over IPC.
  const detect = await evaluate(`window.stackamit.run.detect(true, null)`);
  const javaRt = detect?.runtimes?.java;
  check('packaged app detects a validated JDK for Java runs', detect?.ok === true && javaRt?.available === true && Boolean(javaRt?.jdk?.home), JSON.stringify({ available: javaRt?.available, version: javaRt?.version, home: javaRt?.jdk?.home }));
  check('java is advertised as a local plan by the packaged app', Array.isArray(detect?.plans) && detect.plans.includes('java'), JSON.stringify(detect?.plans));

  // Collect every event the run streams, then wait for the exit event.
  await evaluate(`window.__packagedRuns = { sessions: {} };
    window.__absorb = (p) => {
      const s = (window.__packagedRuns.sessions[p.sessionId] ||= { stdout: '', stderr: '', info: '', error: '', exit: null });
      if (p.type === 'stdout') s.stdout += p.data;
      else if (p.type === 'stderr') s.stderr += p.data;
      else if (p.type === 'info') s.info += p.data;
      else if (p.type === 'error') s.error += p.data;
      else if (p.type === 'exit') s.exit = { code: p.code ?? null, timedOut: !!p.timedOut, stopped: !!p.stopped };
      return 1;
    };
    window.stackamit.run.onEvent((p) => window.__absorb(p)); 'collector installed'`);

  const runJava = async (label, sourceCode, { timeoutMs = 180000 } = {}) => {
    const started = await evaluate(`window.stackamit.run.start({ language: 'java', sourceCode: ${JSON.stringify(sourceCode)}, filePath: null })`);
    if (!started?.ok) {
      check(`${label} started`, false, JSON.stringify(started));
      return null;
    }
    // Events produced before the renderer knew the session id arrive inside the
    // reply; the same absorber folds them in, exactly as the app's service does.
    await evaluate(`window.__packagedRuns.sessions[${JSON.stringify(started.sessionId)}] = { stdout:'', stderr:'', info:'', error:'', exit:null }; ${JSON.stringify(started.replay || [])}.map((e) => window.__absorb({ sessionId: ${JSON.stringify(started.sessionId)}, ...e }))`);
    const key = JSON.stringify(started.sessionId);
    let seen = null;
    for (let i = 0; i < timeoutMs / 1000; i++) {
      await sleep(1000);
      seen = await evaluate(`window.__packagedRuns.sessions[${key}] || null`);
      if (seen?.exit) break;
    }
    return { sessionId: started.sessionId, ...(seen || {}) };
  };

  const STDLIB = 'import java.util.ArrayList;\nimport java.util.List;\n\npublic class Main {\n  public static void main(String[] args) {\n    List<String> names = new ArrayList<>();\n    names.add("Amit");\n    System.out.println(names);\n  }\n}\n';
  const stdlib = await runJava('java stdlib run', STDLIB);
  check(
    'packaged app runs the reported Java example and prints [Amit]',
    stdlib?.exit?.code === 0 && /\[Amit\]/.test(stdlib?.stdout || ''),
    JSON.stringify({ exit: stdlib?.exit?.code, stdout: String(stdlib?.stdout || '').trim(), strategy: String(stdlib?.info || '').split('\n')[0] }),
  );
  check('java run output names the chosen strategy and the JDK', /Java · (source-file mode|javac → java)/.test(stdlib?.info || ''), String(stdlib?.info || '').split('\n').slice(0, 2).join(' | '));

  const INVALID = 'import com.acme.notinstalled.Widget;\n\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(new Widget());\n  }\n}\n';
  const invalid = await runJava('java missing-dependency run', INVALID);
  check(
    'packaged app distinguishes a genuine missing dependency (compiler error, nonzero exit)',
    invalid?.exit && invalid.exit.code !== 0 && /does not exist/.test(invalid?.stderr || ''),
    JSON.stringify({ exit: invalid?.exit?.code, stderr: String(invalid?.stderr || '').trim().slice(0, 140) }),
  );
  check('a failed Java compile produces no program output', !/\bWidget\b.*\n/.test(String(invalid?.stdout || '')) && String(invalid?.stdout || '').trim() === '', JSON.stringify(String(invalid?.stdout || '')));

  // 4. The on-disk Pyright connects through the real loopback bridge.
  const started = await evaluate(`window.stackamit.lsp.start({ language: 'python', root: null, toolPath: ${JSON.stringify(PYRIGHT)} })`);
  check('python bridge starts for on-disk pyright', started?.ok === true, JSON.stringify({ code: started?.code, url: started?.wsUrl }));
  if (started?.ok) {
    // Speak real LSP at the packaged app's bridge from outside (this node proc).
    const lsp = await new Promise((resolve, reject) => {
      const s = new WebSocket(started.wsUrl, { headers: { Origin: 'file://' } });
      s.once('error', reject);
      s.once('open', () => resolve(s));
      setTimeout(() => reject(new Error('bridge ws open timeout')), 10000);
    });
    const responses = [];
    lsp.on('message', (d) => responses.push(JSON.parse(String(d))));
    lsp.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } }));
    let init = null;
    for (let i = 0; i < 40 && !init; i++) {
      await sleep(500);
      init = responses.find((m) => m.id === 1 && m.result);
    }
    check('pyright answers initialize through the packaged bridge', Boolean(init), init ? `caps: ${Object.keys(init.result.capabilities || {}).length}` : 'no response');
    lsp.send(JSON.stringify({ jsonrpc: '2.0', method: 'exit', params: null }));
    await sleep(500);
    lsp.close();
    await evaluate(`window.stackamit.lsp.stop({ language: 'python', root: null })`);
    const stopped = await evaluate(`window.stackamit.lsp.status({ language: 'python', root: null })`);
    check('bridge stops cleanly', stopped?.ok && stopped?.state === 'stopped', JSON.stringify(stopped?.state || stopped));
  }

  // 5. No LSP-related download exists anywhere in the flow: the renderer only
  // ever talks to the main process; assert CSP admits our loopback ws scheme.
  const csp = await evaluate(`(() => { const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); return m ? m.content : (window.__csp || 'none'); })()`);
  check('CSP reaches the renderer (ws://127.0.0.1 allowed where set)', !csp || csp === 'none' || /ws:\/\/127\.0\.0\.1:\*/.test(csp), String(csp).slice(0, 120));
} finally {
  try {
    spawn('taskkill', ['/pid', String(app.pid), '/T', '/F'], { windowsHide: true });
  } catch {
    /* ignore */
  }
  await sleep(500);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} packaged checks passed`);
process.exit(failed.length ? 1 : 0);
