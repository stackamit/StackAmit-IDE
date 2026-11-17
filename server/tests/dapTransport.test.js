import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { DapTransport } from '../src/debug/dapTransport.js';

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

describe('DAP transport framing', () => {
  it('parses partial headers, partial bodies and multiple messages', async () => {
    const server = net.createServer((socket) => {
      const payload = Buffer.concat([frame({ seq: 1, type: 'event', event: 'initialized' }), frame({ seq: 2, type: 'event', event: 'stopped', body: { threadId: 1 } })]);
      socket.write(payload.subarray(0, 12));
      setTimeout(() => socket.write(payload.subarray(12, 29)), 2);
      setTimeout(() => socket.write(payload.subarray(29)), 4);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const transport = new DapTransport();
    const events = [];
    transport.on('event', (event) => events.push(event.event));
    await transport.connect('127.0.0.1', server.address().port);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(events, ['initialized', 'stopped']);
    transport.close();
    await new Promise((resolve) => server.close(resolve));
  });

  it('correlates request responses by request sequence', async () => {
    const server = net.createServer((socket) => {
      socket.on('data', () => socket.write(frame({ seq: 5, type: 'response', request_seq: 1, success: true, command: 'threads', body: { threads: [] } })));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const transport = new DapTransport();
    await transport.connect('127.0.0.1', server.address().port);
    const response = await transport.request('threads');
    assert.equal(response.command, 'threads');
    transport.close();
    await new Promise((resolve) => server.close(resolve));
  });
});
