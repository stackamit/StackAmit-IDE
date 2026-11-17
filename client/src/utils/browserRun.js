/**
 * Browser-local execution of plain JavaScript.
 *
 * A browser *can* run JavaScript — that is the one native execution genuinely
 * available without a server or a desktop bridge, and Web Mode must say so
 * rather than sending every Run to the API. It cannot run Node.js: there is no
 * process, no stdin, no file system and no npm resolution in a page.
 *
 * So the program is evaluated in a sandboxed iframe (`sandbox="allow-scripts"`,
 * which makes it an opaque origin with no access to this page's DOM, storage or
 * credentials), as an ES module so real `import`/export of relative and https
 * specifiers behave the way a browser would run them. Console output, thrown
 * errors and unhandled rejections are posted back to this page over
 * `postMessage`, which is the only channel the sandbox allows.
 *
 * The user's source never enters the iframe's markup: it travels as a message
 * and becomes a Blob module URL. Nothing is interpolated into HTML, so a
 * `</script>` inside program text cannot break out of the runner.
 */

/** Languages this module can genuinely execute without any server. */
export const BROWSER_RUNNABLE = ['javascript'];

export function isBrowserRunnable(language) {
  return BROWSER_RUNNABLE.includes(language);
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Node-only API usage detected statically, before anything runs. Reporting it
 * up front is honest ("this is a browser, not Node") instead of letting the
 * program die on an undefined `require` with a message that looks like a bug in
 * the IDE.
 */
const NODE_SIGNATURES = [
  { re: /\brequire\s*\(/, label: 'require() (CommonJS)' },
  { re: /^\s*import\s+[^\n]*\s+from\s+['"]node:/m, label: 'a node: built-in module' },
  { re: /\b(?:__dirname|__filename)\b/, label: '__dirname / __filename' },
  { re: /\bprocess\.(?:env|argv|stdin|stdout|exit|platform)\b/, label: 'the process object' },
  { re: /\bBuffer\s*\(/, label: 'Buffer' },
];

/** Which Node-only APIs the source reaches for (empty array = pure browser JS). */
export function nodeApiUsage(source) {
  const text = String(source ?? '');
  return NODE_SIGNATURES.filter((s) => s.re.test(text)).map((s) => s.label);
}

/**
 * A bare (npm-style) import specifier. The browser resolves relative and
 * absolute URLs only, so this cannot work without an import map — say exactly
 * that rather than reporting an opaque "failed to resolve module specifier".
 */
export function bareImportSpecifiers(source) {
  const text = String(source ?? '');
  const out = new Set();
  const re = /(?:^|[\s;])(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|(?:^|[\s;])import\s+['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const spec = m[1] || m[2];
    if (!spec) continue;
    if (/^[./]/.test(spec) || /^[a-zA-Z][a-zA-Z\d+.-]*?:/.test(spec)) continue; // relative / url-like
    out.add(spec);
  }
  return [...out];
}

/**
 * Calls to prompt()/confirm()/alert() that are NOT awaited. A page cannot block
 * its single JS thread for input delivered over postMessage, so the bridge hands
 * back a Promise: `const n = prompt(...)` then prints `[object Promise]` unless
 * the value is awaited. This is detected statically so the runner can honestly
 * hint "write `await prompt(...)`" WITHOUT rewriting the user's source.
 * (A crude scan — a string or comment containing `prompt(` can trigger it; a
 *  hint is harmless, unlike an execution change.)
 */
export function unawaitedDialogUsage(source) {
  const text = String(source ?? '');
  const found = new Set();
  const re = /\b(prompt|confirm|alert)\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    // `await prompt(` / `await window.prompt(` count as awaited; anything else
    // consumes the Promise synchronously and sees a pending object, not a value.
    if (!/await\s+(?:(?:window|globalThis|self)\s*\.\s*)?$/.test(before)) found.add(m[1]);
  }
  return [...found];
}

/**
 * The runner document. Constant by design: it holds no user content, only the
 * harness that installs the console/error capture and waits for the program.
 */
export const RUNNER_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>StackAmit browser run</title></head>
<body>
<script>
(function () {
  var done = false;
  function send(type, text, extra) {
    parent.postMessage({ __stackamitRun: 1, type: type, text: text == null ? '' : String(text), extra: extra || null }, '*');
  }
  function fmt(v) {
    if (typeof v === 'string') return v;
    if (v instanceof Error) return (v.stack || (v.name + ': ' + v.message));
    if (typeof v === 'number' || typeof v === 'boolean' || v === null || v === undefined) return String(v);
    try {
      var seen = [];
      return JSON.stringify(v, function (k, val) {
        if (typeof val === 'object' && val !== null) {
          if (seen.indexOf(val) >= 0) return '[Circular]';
          seen.push(val);
        }
        if (typeof val === 'function') return '[Function ' + (val.name || 'anonymous') + ']';
        if (typeof val === 'bigint') return String(val) + 'n';
        return val;
      }, 2);
    } catch (e) { return String(v); }
  }
  function errText(err) {
    if (!err) return 'Unknown error';
    if (err.stack) return String(err.stack);
    if (err.message) return (err.name ? err.name + ': ' : '') + String(err.message);
    return String(err);
  }
  // A module rejection is either a build/link problem (report it where the
  // Output view prints compiler diagnostics) or a genuine runtime throw.
  function classifyModuleError(err) {
    var name = (err && err.name) || '';
    var msg = (err && err.message) || String(err || '');
    if (name === 'SyntaxError' || (typeof SyntaxError !== 'undefined' && err instanceof SyntaxError)) return 'syntax';
    if (/resolve module specifier|could not be resolved|module not found|failed to fetch|networkerror|importing a module/i.test(msg)) return 'resolve';
    return 'runtime';
  }
  ['log', 'info', 'debug', 'dir', 'trace'].forEach(function (m) {
    console[m] = function () { send('stdout', Array.prototype.slice.call(arguments).map(fmt).join(' ')); };
  });
  ['warn', 'error'].forEach(function (m) {
    console[m] = function () { send('stderr', Array.prototype.slice.call(arguments).map(fmt).join(' ')); };
  });
  function finish(ok, kind, message) {
    if (done) return;
    done = true;
    if (message) send('stderr', message);
    send('done', '', { ok: ok, kind: kind || null });
  }
  // "The module finished evaluating" is NOT "the program finished." A main()
  // that is called but not awaited lets the module settle while its async body is
  // still suspended on an awaited prompt; sending done there reported the run
  // complete and tore the frame down before the awaited continuation ever printed
  // (the exact main(); await prompt case). Defer completion until the module
  // has settled AND no input request is outstanding; a zero-delay tick then lets
  // the just-resolved continuation flush its output and raise any next prompt
  // before we decide it is genuinely over. Unrelated timers/background work is
  // never awaited - completion is gated only on the input bridge we own.
  var moduleSettled = false;
  var moduleResult = null;
  var finishTimer = 0;
  function hasPendingInput() {
    for (var k in pendingInputs) {
      if (Object.prototype.hasOwnProperty.call(pendingInputs, k)) return true;
    }
    return false;
  }
  function maybeSendDone() {
    if (done || !moduleSettled || hasPendingInput() || finishTimer) return;
    finishTimer = setTimeout(function () {
      finishTimer = 0;
      if (done || !moduleSettled || hasPendingInput()) return;
      var r = moduleResult || { ok: true };
      finish(r.ok, r.kind, r.message);
    }, 0);
  }
  function completeModule(ok, kind, message) {
    moduleSettled = true;
    moduleResult = { ok: ok, kind: kind, message: message };
    maybeSendDone();
  }
  window.addEventListener('error', function (e) {
    var where = e.filename ? ' (' + e.filename.slice(0, 120) + ':' + e.lineno + ')' : '';
    finish(false, 'runtime', (e.message || 'Uncaught error') + where);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    finish(false, 'runtime', 'Uncaught (in promise) ' + (r && r.stack ? r.stack : fmt(r)));
  });
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d) return;
    // An input reply carries this run's token; match it and the pending request.
    if (d.__stackamitInput === TOKEN && d.promptId && pendingInputs[d.promptId]) {
      var pending = pendingInputs[d.promptId];
      delete pendingInputs[d.promptId];
      pending.resolve(coerce(pending.kind, d.value));
      // This may have been the program's last outstanding input: give the
      // continuation a tick to run (and possibly request more) before finishing.
      maybeSendDone();
      return;
    }
    if (d.__stackamitStart !== 1) return;
    TOKEN = d.token || null;
    INTERACTIVE = Boolean(d.interactive);
    var blob;
    try {
      blob = new Blob([d.source], { type: 'text/javascript' });
    } catch (err) {
      finish(false, 'syntax', 'Could not read the program: ' + err.message);
      return;
    }
    var url = URL.createObjectURL(blob);
    // Completion is the *module evaluation promise*, not the script load
    // event. Chromium fires the load event as soon as a module's synchronous
    // part finishes, which is before a top-level await (our prompt bridge
    // always suspends on one) has resolved - so keying done on load reported the
    // run finished and tore the frame down before the awaited continuation ever
    // printed. A dynamic import()'s promise settles only after the imported
    // module — top-level awaits included — has fully evaluated, so trailing
    // output is captured, and a throw during evaluation rejects this promise
    // for honest compile/runtime attribution.
    import(url).then(
      function () {
        completeModule(true, null, null);
        URL.revokeObjectURL(url);
      },
      function (err) {
        completeModule(false, classifyModuleError(err), errText(err));
        URL.revokeObjectURL(url);
      }
    );
  });
  // prompt()/confirm()/alert() are bridged to the Output panel. A page cannot
  // block the single JS thread on user input delivered over postMessage, so the
  // bridge is asynchronous: program code awaits it and receives the typed value
  // (or null at EOF/cancel). Without the bridge it resolves like an immediate
  // EOF rather than hanging the sandbox.
  var TOKEN = null;
  var INTERACTIVE = false;
  var promptSeq = 0;
  var inputNoticeShown = false;
  var pendingInputs = {};
  function coerce(kind, value) {
    if (kind === 'confirm') return value === true || value === 'true';
    if (kind === 'alert') return undefined;
    return value == null ? null : String(value);
  }
  function inputRequest(kind, message) {
    return new Promise(function (resolve) {
      if (!INTERACTIVE) {
        if (!inputNoticeShown) {
          inputNoticeShown = true;
          send('stderr', 'prompt()/confirm()/alert() hit an immediate EOF: this run has no interactive input attached.');
        }
        resolve(coerce(kind, null));
        return;
      }
      var id = 'p' + (++promptSeq);
      pendingInputs[id] = { resolve: resolve, kind: kind };
      parent.postMessage({ __stackamitRun: 1, type: 'input-request', kind: kind, text: message == null ? '' : String(message), promptId: id, token: TOKEN }, '*');
    });
  }
  window.prompt = function (message) { return inputRequest('prompt', message); };
  window.confirm = function (message) { return inputRequest('confirm', message); };
  window.alert = function (message) { return inputRequest('alert', message); };
  send('ready');
})();
</script>
</body>
</html>`;

/**
 * Run `source` as a browser ES module. Resolves with the same envelope shape the
 * remote execution API answers with, so one Output view renders both honestly.
 *
 * Never call this for a language other than JavaScript: nothing else a browser
 * can execute on its own (no wasm toolchain for C++/Java/…).
 */
/** A per-run correlation id so an input answer can never be routed to a stale
 *  execution: the sandbox echoes it on every request and only replies tagged
 *  with the same token are accepted. */
export function newRunToken() {
  return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function runBrowserJavaScript({
  source,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal = null,
  name = 'main.js',
  token = null,
  requestInput = null,
} = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ ok: false, code: 'NO_DOCUMENT', message: 'Browser execution needs a document.' });
      return;
    }
    const runToken = token || newRunToken();
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let frame = null;
    let timer = 0;
    // Wall-clock timeouts must not run while the program is suspended on the
    // user: a prompt is legitimate think-time, not a hang. Count outstanding
    // prompts and pause the timer until all are answered.
    let pendingInput = 0;
    // A module can finish evaluating before an awaited prompt resolves (a floating
    // `main()`). If that early `done` arrives while the user still owes an answer,
    // hold it and settle only once the input drains and the continuation has had a
    // tick to emit its trailing output — never report success over a live prompt.
    let pendingDone = null;
    let doneExtra = null; // the `done` payload held while an input is outstanding
    let finishTimer = 0;

    const append = (bucket, text) => (bucket === 'stdout' ? (stdout += (stdout && !stdout.endsWith('\n') ? '\n' : '') + text) : (stderr += (stderr && !stderr.endsWith('\n') ? '\n' : '') + text));

    // Send an answer back into the sandbox for a pending prompt. Once the run is
    // settled the frame is gone, so a late answer is dropped rather than posted
    // into a detached window.
    const reply = (promptId, value) => {
      if (settled || !frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage({ __stackamitInput: runToken, promptId, value }, '*');
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(finishTimer);
      window.removeEventListener('message', onMessage);
      if (signal) signal.removeEventListener('abort', onAbort);
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
      resolve({ ...result, executionTimeMs: Date.now() - started });
    };

    // Build the completion envelope from the CURRENT stdout/stderr and settle.
    // Deferred completions must read output at settle time, not at the instant an
    // early `done` arrived, or the continuation's trailing output would be lost.
    const finishFromDone = (extra) => {
      const e = extra || {};
      if (e.ok) {
        return finish({ success: true, status: 'completed', stdout, stderr, compileMessage: null, exitCode: 0, provider: 'browser' });
      }
      const kind = e.kind === 'resolve' || e.kind === 'syntax' ? 'compile_error' : 'runtime_error';
      return finish({
        success: false,
        status: kind,
        stdout,
        stderr,
        // A module that failed to link has no separate compiler channel, so its
        // reason goes where the Output view prints compiler diagnostics.
        compileMessage:
          kind === 'compile_error'
            ? (stderr || `Could not run "${name}" in the browser. A module import may be unresolvable, or the file is not valid JavaScript.`)
            : null,
        exitCode: kind === 'compile_error' ? 1 : null,
        failed: e.kind || 'runtime',
        provider: 'browser',
      });
    };

    const onMessage = (event) => {
      const d = event.data;
      if (!d || d.__stackamitRun !== 1) return;
      // Only accept the frame we created, not any other page that posts here.
      if (frame && event.source !== frame.contentWindow) return;
      if (d.type === 'ready') {
        frame.contentWindow.postMessage({ __stackamitStart: 1, source: String(source ?? ''), name, token: runToken, interactive: typeof requestInput === 'function' }, '*');
        return;
      }
      if (d.type === 'input-request') {
        // Correlate on the run token before doing anything: a request tagged with
        // another run's token is ignored outright.
        if (!d.token || d.token !== runToken) return;
        if (typeof requestInput !== 'function') {
          reply(d.promptId, null);
          return;
        }
        pendingInput += 1;
        clearTimeout(timer); // pause the run clock while the user decides
        Promise.resolve(
          requestInput({ token: runToken, promptId: d.promptId, kind: d.kind, message: d.text }),
        )
          .then((value) => reply(d.promptId, value))
          .catch(() => reply(d.promptId, null))
          .finally(() => {
            pendingInput = Math.max(0, pendingInput - 1);
            if (pendingInput === 0 && !settled) {
              armTimeout();
              // The run had already been reported done while this input was open;
              // after a tick (so the continuation's output lands, or a fresh prompt
              // re-enters and cancels us) settle it now that nothing is outstanding.
              if (pendingDone) {
                clearTimeout(finishTimer);
                finishTimer = setTimeout(() => {
                  if (pendingInput === 0 && !settled) {
                    pendingDone = false;
                    finishFromDone(doneExtra);
                  }
                }, 0);
              }
            }
          });
        return;
      }
      if (d.type === 'stdout' || d.type === 'stderr') {
        append(d.type, d.text);
        return;
      }
      if (d.type === 'done') {
        doneExtra = d.extra || {};
        // Never settle over a live prompt: hold the completion and let the input's
        // finally path settle once the continuation drains (reading then-current
        // stdout/stderr, so trailing output is preserved).
        if (pendingInput > 0) {
          pendingDone = true;
          return;
        }
        finishFromDone(doneExtra);
      }
    };

    const onAbort = () =>
      finish({
        success: false,
        status: 'canceled',
        stdout,
        stderr,
        compileMessage: null,
        exitCode: null,
        canceled: true,
        provider: 'browser',
      });

    const armTimeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        finish({
          success: false,
          status: 'timeout',
          stdout,
          stderr,
          compileMessage: null,
          exitCode: null,
          timedOut: true,
          message: `The program did not finish within ${Math.round(timeoutMs / 1000)}s.`,
          provider: 'browser',
        });
      }, timeoutMs);
    };
    armTimeout();

    window.addEventListener('message', onMessage);
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', `StackAmit browser run ${name}`);
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
    frame.srcdoc = RUNNER_HTML;
    document.body.appendChild(frame);
  });
}
