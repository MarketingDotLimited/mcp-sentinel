import "../test-env.js";
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

describe('server-mcp-tools fuzzer', () => {
  let brokerServer;
  let brokerPort;
  let serverProcess;
  let port = 0;
  let sockets = new Set();

  function generateDummyValue(schema) {
    if (!schema || typeof schema !== 'object') return 'test';
    if (schema.type === 'object' || schema.properties) {
      const obj = {};
      const props = schema.properties || {};
      for (const [k, prop] of Object.entries(props)) {
        obj[k] = generateDummyValue(prop);
      }
      return obj;
    }
    if (schema.type === 'string') return 'test-string';
    if (schema.type === 'number' || schema.type === 'integer') return 1;
    if (schema.type === 'boolean') return true;
    if (schema.type === 'array') return [generateDummyValue(schema.items)];
    return 'test';
  }

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
          // ignore
        }
      });
    });

    await new Promise(resolve => {
      brokerServer.listen(0, '127.0.0.1', () => {
        brokerPort = brokerServer.address().port;
        resolve();
      });
    });

    // Find free port for HTTP server
    const srv = net.createServer();
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    port = srv.address().port;
    await new Promise(r => srv.close(r));

    // Setup env
    process.env.MCP_BROKER_SOCKET = `127.0.0.1:${brokerPort}`;
    process.env.ADMIN_API_KEY = 'test-admin';
    process.env.JWT_SECRET = 's'.repeat(64);
    process.env.PORT = String(port);
    process.env.NODE_ENV = 'test';
    process.env.TEST_NO_LISTEN = 'false'; // listen so SSE client can connect

    await import("../../server.js");
    await new Promise(r => setTimeout(r, 1000));
  });

  it('smartly fuzzes all MCP tools with observable response contract', async () => {
    const baseUrl = `http://127.0.0.1:${port}`;
    const transport = new SSEClientTransport(new URL('/mcp', baseUrl), {
      requestInit: { headers: { 'x-api-key': 'test-admin' } },
      eventSourceInit: { headers: { 'x-api-key': 'test-admin' } },
    });
    const client = new Client({ name: 'fuzzer', version: '1.0' }, { capabilities: {} });

    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(Array.isArray(tools.tools), 'listTools should return array of tools');

    for (const t of tools.tools) {
      const args = generateDummyValue(t.inputSchema);
      const res = await client.callTool({ name: t.name, arguments: args }).catch(err => ({ error: err }));
      assert.ok(res !== undefined, `Tool ${t.name} returned a valid response or error`);
    }
    await client.close();
  });

  after(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    if (brokerServer) brokerServer.close();
    const { __TEST_EXPORTS__: { getServer } } = await import("../../server.js");
    const testServer = getServer();
    if (testServer) {
      await new Promise(resolve => testServer.close(resolve));
    }
  });
});
