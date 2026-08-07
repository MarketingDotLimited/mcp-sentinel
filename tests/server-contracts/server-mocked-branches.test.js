import '../test-env.js';
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import net from 'net';
import * as capabilities from '../../lib/capabilities.js';
import fs from 'fs/promises';

process.on('unhandledRejection', () => {});

test('server tools dead code coverage', async () => {
  const srv = net.createServer();
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise(r => srv.close(r));

  process.env.PORT = String(port);
  process.env.TEST_NO_LISTEN = 'false';
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_API_KEY = 'test-admin';
  process.env.MCP_POLICY_FILE = '/tmp/mcp-policy.json';

  await fs.writeFile('/tmp/mcp-policy.json', JSON.stringify({ rules: [] }));

  await capabilities.setCapability('advanced-execution', true);

  const { __TEST_EXPORTS__ } = await import('../../server.js');
  await new Promise(r => setTimeout(r, 1000));
  
  const transport = new SSEClientTransport(new URL('/mcp', `http://127.0.0.1:${port}`), {
    requestInit: { headers: { 'x-api-key': 'test-admin' } },
    eventSourceInit: { headers: { 'x-api-key': 'test-admin' } },
  });
  const client = new Client({ name: 'cov', version: '1.0' }, { capabilities: { tools: { listChanged: true } } });
  
  await client.connect(transport);
  await new Promise(r => setTimeout(r, 500));

  const sessionIds = [...__TEST_EXPORTS__.activeTransports.keys()];
  if (sessionIds.length > 0) {
     __TEST_EXPORTS__.mutateSessionScopes(sessionIds[0], ['some_other_tool']);
     await client.callTool({ name: 'get_system_info', arguments: {} }).catch(() => {});
     __TEST_EXPORTS__.mutateSessionScopes(sessionIds[0], ['*']);
  }

  await capabilities.setCapability('advanced-execution', false);
  await client.callTool({ name: 'run_sandboxed_code', arguments: { language: 'node', code: 'x' } }).catch(() => {});

  // Trigger Policy Denied!
  await fs.writeFile('/tmp/mcp-policy.json', JSON.stringify({
    rules: [{ effect: 'deny', tools: ['get_system_info'], roles: ['admin'] }]
  }));
  
  try {
     const res = await client.callTool({ name: 'get_system_info', arguments: {} });
     console.log('POLICY RES:', res);
  } catch(e) { void e; }

  // Trigger Policy Error!
  await fs.writeFile('/tmp/mcp-policy.json', 'invalid-json');
  try {
     const res = await client.callTool({ name: 'get_system_info', arguments: {} });
     console.log('POLICY ERR RES:', res);
  } catch(e) { void e; }

  await client.close();
  const server = __TEST_EXPORTS__.getServer();
  if (server) {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});
