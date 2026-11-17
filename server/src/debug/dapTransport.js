import net from 'node:net';
import { EventEmitter } from 'node:events';

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const HEADER = /^Content-Length:\s*(\d+)\r?\n(?:[\w-]+:\s*[^\r\n]*\r?\n)*\r?\n/i;

/** Minimal, bounded DAP framing and request/response transport. */
export class DapTransport extends EventEmitter {
  constructor({ maxMessageBytes = MAX_MESSAGE_BYTES } = {}) {
    super();
    this.maxMessageBytes = maxMessageBytes;
    this.buffer = Buffer.alloc(0);
    this.nextSeq = 1;
    this.pending = new Map();
    this.socket = null;
    this.closed = false;
  }

  connect(host, port, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      this.socket = socket;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(this);
      };
      const timer = setTimeout(() => {
        socket.destroy();
        finish(new Error('DAP connection timed out.'));
      }, timeoutMs);
      socket.on('connect', () => finish());
      socket.on('data', (chunk) => this.#consume(chunk));
      socket.on('error', (error) => {
        this.emit('error', error);
        finish(error);
      });
      socket.on('close', () => this.close(new Error('DAP connection closed.')));
    });
  }

  request(command, args = {}, timeoutMs = 10000) {
    if (this.closed || !this.socket || this.socket.destroyed) return Promise.reject(new Error('DAP connection is closed.'));
    const seq = this.nextSeq++;
    const message = { seq, type: 'request', command, arguments: args };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP request timed out: ${command}`));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer, command });
      this.#write(message);
    });
  }

  close(error = null) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error || new Error('DAP connection closed.'));
    }
    this.pending.clear();
    try { this.socket?.destroy(); } catch { /* already closed */ }
    this.emit('close', error);
  }

  #write(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (body.length > this.maxMessageBytes) throw new Error('DAP message exceeds the configured size limit.');
    this.socket.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  }

  #consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxMessageBytes + 8192) return this.close(new Error('DAP input exceeds the configured size limit.'));
    while (this.buffer.length) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      const headerLength = headerEnd >= 0 ? 4 : this.buffer.indexOf('\n\n') >= 0 ? 2 : -1;
      if (headerLength < 0) return;
      const headerText = this.buffer.subarray(0, headerEnd >= 0 ? headerEnd + 4 : this.buffer.indexOf('\n\n') + 2).toString('ascii');
      const match = headerText.match(HEADER);
      if (!match) return this.close(new Error('Invalid DAP message header.'));
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > this.maxMessageBytes) return this.close(new Error('Invalid DAP message length.'));
      const bodyStart = headerText.length;
      if (this.buffer.length < bodyStart + length) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      let message;
      try { message = JSON.parse(body); } catch { return this.close(new Error('Invalid DAP JSON message.')); }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return this.close(new Error('Invalid DAP message.'));
      if (message.type === 'response' && Number.isInteger(message.request_seq)) {
        const pending = this.pending.get(message.request_seq);
        if (pending) {
          this.pending.delete(message.request_seq);
          clearTimeout(pending.timer);
          if (message.success === false) pending.reject(new Error(message.message || `DAP request failed: ${pending.command}`));
          else pending.resolve(message);
        }
      }
      this.emit('message', message);
      if (message.type === 'event') this.emit('event', message);
    }
  }
}

export { MAX_MESSAGE_BYTES };
