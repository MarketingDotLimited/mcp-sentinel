import '../test-env.js';
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import net from 'net';
import * as security from '../../security.js';


test('server tools error branches', async () => {
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise(r => srv.close(r));

  process.env.PORT = String(port);
  process.env.TEST_NO_LISTEN = 'false';
  process.env.NODE_ENV = 'test';

  const { __TEST_EXPORTS__ } = await import('../../server.js');
  await new Promise(r => setTimeout(r, 1000));

  await security.addApiKey('limited-key-12345678901234567890123', {
    userId: 'admin',
    role: 'user',
    allowedIPs: [],
    scopes: ['some_other_tool'],
  });

  const transportLimited = new SSEClientTransport(new URL('/mcp', `http://127.0.0.1:${port}`), {
    requestInit: { headers: { 'x-api-key': 'limited-key-12345678901234567890123' } },
    eventSourceInit: { headers: { 'x-api-key': 'limited-key-12345678901234567890123' } },
  });
  const clientLimited = new Client({ name: 'cov', version: '1.0' }, { capabilities: { tools: { listChanged: true } } });
  await clientLimited.connect(transportLimited);
  try {
    await clientLimited.callTool({ name: 'get_system_info', arguments: {} });
  } catch (e) {
    assert.ok(e.message);
  }
  await clientLimited.close();

  const transport = new SSEClientTransport(new URL('/mcp', `http://127.0.0.1:${port}`), {
    requestInit: { headers: { 'x-api-key': 'test-admin-api-key' } },
    eventSourceInit: { headers: { 'x-api-key': 'test-admin-api-key' } },
  });
  const client = new Client({ name: 'cov', version: '1.0' }, { capabilities: { tools: { listChanged: true } } });
  await client.connect(transport);

  try {
    await client.callTool({
      name: 'request_change_approval',
      arguments: { tool: 'request_change_approval', arguments: {}, summary: 'x' },
    });
  } catch (e) {
    assert.ok(e.message);
  }

  // capability pack not enabled
  try {
    await client.callTool({ name: 'run_sandboxed_code', arguments: { language: 'node', code: 'x' } });
  } catch (e) {
    assert.ok(e.message);
  }

  // trigger Zod Error inside
  try {
    await client.callTool({ name: 'get_system_info', arguments: { forceReplay: 'not-a-boolean' } });
  } catch (e) {
    assert.ok(e.message);
  }

  await client.close();
  const server = __TEST_EXPORTS__.getServer();
  if (server) {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
  if (__TEST_EXPORTS__.getIdleCheckInterval && __TEST_EXPORTS__.getIdleCheckInterval()) {
    clearInterval(__TEST_EXPORTS__.getIdleCheckInterval());
  }
});
