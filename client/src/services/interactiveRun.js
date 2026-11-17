/**
 * Shared interactive-execution transport.
 *
 * This is the *proven* behavior extracted from the Editor's Terminal: it opens a
 * live server process over the `/api/interactive` WebSocket and speaks the exact
 * protocol the backend expects (`start` / `stdin` / `stop` out; `started` /
 * `stdout` / `stderr` / `compile` / `info` / `error` / `exit` in). It owns only
 * the socket lifecycle and message framing — every byte of program output is
 * handed to the caller's `onMessage` so each UI renders it its own way. That is
 * why one implementation can back both the Editor console and the IDE Output
 * panel without either reimplementing (or drifting from) the run protocol.
 *
 * It is deliberately presentation-agnostic and framework-agnostic: no React, no
 * store, no DOM. Callers translate messages into their own log lines.
 */

/** WebSocket endpoint for local interactive runs (dev goes through the proxy). */
export function interactiveWsUrl() {
  const base = import.meta.env.VITE_API_URL;
  if (base) {
    try {
      const u = new URL(base, window.location.origin);
      const proto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${u.host}/api/interactive`;
    } catch {
      /* fall through to the document origin */
    }
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/api/interactive`;
}

/**
 * Open one interactive session for `sourceCode` in `language`.
 *
 * Returns a control handle:
 *   - `sendStdin(text)` — pipe raw bytes to the running process (append "\n" to
 *     answer a line-oriented read; the caller decides framing).
 *   - `stop()`          — ask the server to SIGKILL the child, then tear down.
 *   - `close()`         — close the socket without a stop request (unmount).
 *   - `closed`          — a promise that resolves once the run has settled with
 *     `{ code, stopped, stage }` from an `exit` message, or `{ closed: true }`
 *     when the socket drops without one. Consumers use it to reset their
 *     running/session state exactly once.
 *
 * `onOpen` fires when the socket is up (the start request has been sent);
 * `onMessage` receives every parsed server message, including the terminal
 * `exit`. A connection that cannot even be created resolves `closed` with
 * `{ error: true }` so the caller reports it rather than hanging.
 */
export function startInteractiveSession({ language, sourceCode, onMessage, onOpen } = {}) {
  let settle;
  const closed = new Promise((resolve) => {
    settle = resolve;
  });

  let settled = false;
  let stopRequested = false;
  const finish = (info) => {
    if (settled) return;
    settled = true;
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    } catch {
      /* socket already gone */
    }
    settle(info);
  };

  let ws;
  try {
    ws = new WebSocket(interactiveWsUrl());
  } catch {
    finish({ error: true, closed: true });
    return { sendStdin: () => {}, stop: () => {}, close: () => finish({ closed: true }), closed };
  }

  ws.onopen = () => {
    try {
      ws.send(JSON.stringify({ type: 'start', language, sourceCode }));
    } catch {
      /* ignore — onclose settles */
    }
    if (onOpen) onOpen();
  };
  ws.onmessage = (ev) => {
    if (settled) return;
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return; // ignore malformed frames
    }
    if (onMessage) onMessage(msg);
    if (msg && msg.type === 'exit') finish({ code: msg.code, stopped: msg.stopped, stage: msg.stage });
  };
  ws.onerror = () => {
    /* onclose settles the run; the caller surfaces the failure from messages */
  };
  ws.onclose = () => finish({ closed: true });

  return {
    sendStdin(data) {
      if (!settled && ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'stdin', data: String(data ?? '') }));
        } catch {
          /* ignore */
        }
      }
    },
    stop() {
      if (stopRequested) return;
      stopRequested = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'stop' }));
        } catch {
          /* ignore */
        }
      }
      finish({ stopped: true, closed: true });
    },
    close() {
      finish({ closed: true });
    },
    closed,
  };
}

export default startInteractiveSession;
