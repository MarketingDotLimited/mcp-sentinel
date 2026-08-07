import '../test-env.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import http from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

describe('server integration tests', () => {
  let brokerServer;
  let brokerPort;
  let port;
  let sockets = new Set();

  before(async () => {
    // 1. Start dummy broker
    brokerServer = net.createServer(socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('data', data => {
        try {
          const str = data.toString();
          const req = JSON.parse(str.split('\n')[0]);
          const res = { requestId: req.requestId, status: 'success', result: { ok: true } };
          socket.write(JSON.stringify(res) + '\n');
        } catch (e) {
          // ignore parsing error
        }
      });
    });

    await new Promise(resolve => {
      brokerServer.listen(0, '127.0.0.1', () => {
        brokerPort = brokerServer.address().port;
        resolve();
      });
    });

    // 2. Setup env
    process.env.MCP_BROKER_SOCKET = `127.0.0.1:${brokerPort}`;
    process.env.JWT_SECRET = 's'.repeat(64);
    process.env.PORT = '0';
    process.env.NODE_ENV = 'test';
    process.env.TEST_NO_LISTEN = 'false';

    await import('../../server.js');
    await new Promise(r => setTimeout(r, 1000));

    // Get assigned server port by scanning or creating client connection
    const { getAdminState } = await import('../../lib/admin-state.js');
    assert.ok(getAdminState);
  });

  it('fuzzes express handlers with contract assertions', async () => {
    const {
      __TEST_EXPORTS__: { app: expressApp },
    } = await import('../../server.js');
    const routes = expressApp._router?.stack || [];
    const handlers = [];

    for (const layer of routes) {
      if (layer.route) {
        const path = layer.route.path;
        for (const method of Object.keys(layer.route.methods)) {
          const handler = layer.route.stack[layer.route.stack.length - 1].handle;
          handlers.push({ method, path, handler });
        }
      }
    }

    assert.ok(handlers.length > 0, 'express routes should be registered');

    for (const r of handlers) {
      let statusCode = 200;
      let responseData = null;

      const res = {
        status: function (code) {
          statusCode = code;
          return this;
        },
        json: function (data) {
          responseData = data;
          return this;
        },
        send: function (data) {
          responseData = data;
          return this;
        },
        set: function () {
          return this;
        },
        type: function () {
          return this;
        },
      };

      const reqAdmin = {
        method: r.method.toUpperCase(),
        path: r.path,
        headers: { 'x-api-key': 'test-admin' },
        identity: { role: 'admin', userId: 'admin-user' },
        body: {},
        query: {},
        params: {},
        clientIP: '127.0.0.1',
        protocol: 'https',
        get: () => 'mcp.example.test',
        on: (evt, cb) => {
          if (evt === 'close') setTimeout(cb, 10);
        },
      };

      try {
        const result = r.handler(reqAdmin, res, () => {});
        if (result && typeof result.catch === 'function') {
          await result.catch(err => {
            assert.ok(err instanceof Error, 'Route handler thrown error must be Error instance');
          });
        }
      } catch (err) {
        assert.ok(err instanceof Error, 'Route handler thrown error must be Error instance');
      }

      assert.ok(statusCode >= 100 && statusCode <= 599, `Handler for ${r.path} returned valid status code`);

      const reqNonAdmin = { ...reqAdmin, identity: { role: 'user', userId: 'test-user' } };
      try {
        const result2 = r.handler(reqNonAdmin, res, () => {});
        if (result2 && typeof result2.catch === 'function') {
          await result2.catch(err => {
            assert.ok(err instanceof Error, 'Non-admin route handler thrown error must be Error instance');
          });
        }
      } catch (err) {
        assert.ok(err instanceof Error, 'Non-admin route handler thrown error must be Error instance');
      }
    }
  });

  after(async () => {
    try { const { __TEST_EXPORTS__ } = await import('../../server.js'); if (__TEST_EXPORTS__.getIdleCheckInterval()) clearInterval(__TEST_EXPORTS__.getIdleCheckInterval()); } catch(e) {}
    process.removeAllListeners();
    for (const socket of sockets) {
      socket.destroy();
    }
    if (brokerServer) brokerServer.close();
    
    const {
      __TEST_EXPORTS__: { getServer },
    } = await import('../../server.js');
    const testServer = getServer();
    if (testServer) {
      await new Promise(resolve => testServer.close(resolve));
    }
  });
});
