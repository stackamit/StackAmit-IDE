import net from 'node:net';
import { EventEmitter } from 'node:events';

export class DapTransport extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private nextSeq = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private socket: net.Socket | null = null;
  private closed = false;

  connect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port });
      this.socket = socket;
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('DAP connection timed out.')); }, 8000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.on('data', (chunk) => this.consume(chunk));
      socket.on('error', (error) => this.emit('error', error));
      socket.on('close', () => this.close(new Error('DAP connection closed.')));
    });
  }

  request(command: string, args: Record<string, unknown> = {}): Promise<any> {
    if (this.closed || !this.socket || this.socket.destroyed) return Promise.reject(new Error('DAP connection is closed.'));
    const seq = this.nextSeq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(seq); reject(new Error(`DAP request timed out: ${command}`)); }, 10000);
      this.pending.set(seq, { resolve, reject, timer });
      this.write({ seq, type: 'request', command, arguments: args });
    });
  }

  close(error?: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error || new Error('DAP connection closed.')); }
    this.pending.clear();
    this.socket?.destroy();
    this.emit('close', error);
  }

  private write(message: Record<string, unknown>): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (body.length > 4 * 1024 * 1024) throw new Error('DAP message is too large.');
    this.socket?.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const marker = this.buffer.indexOf(Buffer.from('\r\n\r\n'));
      if (marker < 0) return;
      const header = this.buffer.subarray(0, marker).toString('ascii');
      const match = /^Content-Length:\s*(\d+)$/im.exec(header);
      if (!match) return this.close(new Error('Invalid DAP header.'));
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length > 4 * 1024 * 1024) return this.close(new Error('Invalid DAP length.'));
      const start = marker + 4;
      if (this.buffer.length < start + length) return;
      const raw = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      let message: any;
      try { message = JSON.parse(raw); } catch { return this.close(new Error('Invalid DAP JSON.')); }
      if (message.type === 'response' && Number.isInteger(message.request_seq)) {
        const pending = this.pending.get(message.request_seq);
        if (pending) { this.pending.delete(message.request_seq); clearTimeout(pending.timer); message.success === false ? pending.reject(new Error(message.message || 'DAP request failed.')) : pending.resolve(message); }
      }
      this.emit('message', message);
      if (message.type === 'event') this.emit('event', message);
    }
  }
}
