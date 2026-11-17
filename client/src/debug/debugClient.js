function debugWsUrl() {
  const configured = import.meta.env.VITE_API_URL;
  if (configured) {
    const url = new URL(configured, window.location.origin);
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/api/debug`;
  }
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/debug`;
}

/** Browser-side command bridge. The renderer speaks the allow-listed debug API, never raw DAP TCP. */
export function startWebDebug({ language = 'python', sourceCode, sourceFile, executionId, onMessage, onOpen, onClose } = {}) {
  const desktop = typeof window !== 'undefined' && window.stackamit?.isDesktop && window.stackamit.debug;
  if (desktop) {
    let closed = false;
    let sessionId = null;
    const unsubscribe = desktop.onEvent((message) => { if (!closed) { if (message.debugSessionId) sessionId = message.debugSessionId; onMessage?.(message); } });
    void desktop.start({ sourceCode, sourceFile, executionId }).then((result) => { if (!result?.ok) onMessage?.({ type: 'debugError', error: result?.message || 'Could not start desktop debugger.' }); else { sessionId = result.debugSessionId; onOpen?.(); } }).catch((error) => onMessage?.({ type: 'debugError', error: error.message || 'Could not start desktop debugger.' }));
    return {
      request(command, args = {}) { if (!sessionId || closed) return false; void desktop.request({ debugSessionId: sessionId, command, arguments: args }); return true; },
      stop() { if (!sessionId) return false; void desktop.stop(sessionId); return true; },
      close() { closed = true; unsubscribe?.(); if (sessionId) void desktop.stop(sessionId); onClose?.(); },
    };
  }
  let socket;
  let closed = false;
  try { socket = new WebSocket(debugWsUrl()); } catch (error) {
    onMessage?.({ type: 'debugError', error: error.message || 'Could not open debug transport.' });
    return null;
  }
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'start', language, sourceCode, sourceFile, executionId }));
    onOpen?.();
  };
  socket.onmessage = (event) => {
    if (closed) return;
    try { onMessage?.(JSON.parse(event.data)); } catch { onMessage?.({ type: 'debugError', error: 'Invalid debugger message.' }); }
  };
  socket.onerror = () => onMessage?.({ type: 'debugError', error: 'Debugger transport disconnected.' });
  socket.onclose = () => { if (!closed) onClose?.(); };
  return {
    request(command, args = {}) {
      if (closed || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ type: 'request', command, arguments: args }));
      return true;
    },
    stop() { return this.request('terminate'); },
    close() { closed = true; try { socket.close(); } catch { /* ignore */ } },
  };
}

export default startWebDebug;
