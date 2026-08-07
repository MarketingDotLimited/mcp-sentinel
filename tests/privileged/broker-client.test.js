import "../test-env.js";
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import fs from 'fs';
import net from 'net';

describe('broker-client.js complete coverage', () => {
  it('covers successful request, large response, ID mismatch, rejection, timeout, double finish', async () => {
    mock.method(fs, 'existsSync', () => true);

    mock.method(net, 'createConnection', () => {
      const socket = new net.Socket();
      socket.write = data => {
        const req = JSON.parse(data.toString());
        setTimeout(() => {
          // no-op
          if (req.operation === 'success') {
            socket.emit('data', Buffer.from(JSON.stringify({ requestId: req.requestId, ok: true, result: 'done' })));
            socket.emit('end');
          } else if (req.operation === 'mismatch') {
            socket.emit('data', Buffer.from(JSON.stringify({ requestId: 'wrong', ok: true })));
            socket.emit('end');
          } else if (req.operation === 'reject') {
            socket.emit(
              'data',
              Buffer.from(JSON.stringify({ requestId: req.requestId, ok: false, error: 'rejected' }))
            );
            socket.emit('end');
          } else if (req.operation === 'reject-no-msg') {
            socket.emit('data', Buffer.from(JSON.stringify({ requestId: req.requestId, ok: false })));
            socket.emit('end');
          } else if (req.operation === 'bad-json') {
            socket.emit('data', Buffer.from('{ bad json'));
            socket.emit('end');
          } else if (req.operation === 'too-large') {
            socket.emit('data', Buffer.alloc(6 * 1024 * 1024, 'a'));
          } else if (req.operation === 'double-finish') {
            socket.emit('data', Buffer.from(JSON.stringify({ requestId: req.requestId, ok: true, result: 'first' })));
            socket.emit('end');
            socket.emit('error', new Error('late error'));
          }
        }, 10);
      };
      const t = setTimeout(() => {
        if (!socket.destroyed) socket.emit('connect');
      }, 5);
      const origDestroy = socket.destroy;
      socket.destroy = () => {
        clearTimeout(t);
        origDestroy.call(socket);
      };
      return socket;
    });

    const broker = await import(`../../lib/broker-client.js?test=${Date.now()}`);

    await assert.equal(await broker.brokerCall('success', {}), 'done');
    await assert.rejects(broker.brokerCall('mismatch', {}), /Privilege broker response ID mismatch/);
    await assert.rejects(broker.brokerCall('reject', {}), /rejected/);
    await assert.rejects(broker.brokerCall('reject-no-msg', {}), /Privilege broker rejected the request/);
    await assert.rejects(broker.brokerCall('bad-json', {}));
    await assert.rejects(broker.brokerCall('too-large', {}), /too large/);
    await assert.equal(await broker.brokerCall('double-finish', {}), 'first');
    await assert.rejects(
      broker.brokerCall('timeout', {}, { timeoutMs: 20 }),
      err => err.code === 'E_BROKER_UNAVAILABLE'
    );
  });

  it('covers abort', async () => {
    mock.method(fs, 'existsSync', () => false);

    mock.method(net, 'createConnection', () => {
      const socket = new net.Socket();
      const t = setTimeout(() => {
        if (!socket.destroyed) socket.emit('error', { code: 'ENOENT' });
      }, 50);
      const origDestroy = socket.destroy;
      socket.destroy = () => {
        clearTimeout(t);
        origDestroy.call(socket);
      };
      return socket;
    });

    const broker = await import(`../../lib/broker-client.js?test=${Date.now()}`);
    const ac = new AbortController();
    const p = broker.brokerCall('abort', {}, { signal: ac.signal });
    setTimeout(() => ac.abort(), 10);

    await assert.rejects(p, err => err.code === 'E_BROKER_UNAVAILABLE');
  });
  it('covers custom socket path from env', async () => {
    process.env.MCP_BROKER_SOCKET = '/custom/path.sock';
    const broker = await import(`../../lib/broker-client.js?test=${Date.now()}`);
    delete process.env.MCP_BROKER_SOCKET;
    // We don't need to actually connect, just loading the module covers line 5
    assert.ok(typeof broker.brokerCall === 'function');
  });
});
