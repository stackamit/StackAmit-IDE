/** Incrementally frames arbitrary child-process chunks into display lines. */
export function createInteractiveOutputBuffer(onLine) {
  const streams = new Map();
  let order = 0;
  const stateFor = (kind) => {
    if (!streams.has(kind)) streams.set(kind, { pending: '', pendingCR: false, touched: 0, previewed: false, line: 0, stream: null });
    return streams.get(kind);
  };
  const emit = (kind, text, replace = false, stream = kind) => onLine({ kind, text, replace, stream });
  const feed = (kind, value) => {
    const state = stateFor(kind);
    state.touched = ++order;
    let text = String(value ?? '');
    if (!text) return;
    if (state.pendingCR) {
      state.pendingCR = false;
      if (text[0] === '\n') text = text.slice(1);
    }
    if (!state.stream) state.stream = `${kind}:${++state.line}`;
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch !== '\n' && ch !== '\r') continue;
      state.pending += text.slice(start, i);
      const crlf = ch === '\r' && text[i + 1] === '\n';
      emit(kind, state.pending, state.previewed || (ch === '\r' && !crlf), state.stream);
      state.pending = '';
      state.previewed = false;
      if (crlf) i += 1;
      if (ch === '\r' && i === text.length - 1) state.pendingCR = true;
      if (ch === '\n' || crlf) state.stream = null;
      start = i + 1;
    }
    state.pending += text.slice(start);
    // Python input() writes a prompt without a newline. Publish the current
    // tail immediately, while retaining it for the next chunk/line boundary.
    if (state.pending.length > 0) {
      emit(kind, state.pending, true, state.stream);
      state.previewed = true;
    }
  };
  const flush = () => {
    [...streams.entries()]
      .filter(([, state]) => state.pending.length > 0)
      .sort((a, b) => a[1].touched - b[1].touched)
      .forEach(([kind, state]) => {
        if (!state.previewed) emit(kind, state.pending, false, state.stream || kind);
        state.pending = '';
        state.pendingCR = false;
        state.previewed = false;
        state.stream = null;
      });
  };
  return { feed, flush };
}
export default createInteractiveOutputBuffer;
