import '../test-env.js';
import assert from 'node:assert/strict';
import { describe, it, after } from 'node:test';

describe('protected services', () => {
  it('covers recovery workflow error', async () => {
    process.env.MCP_BROKER_SOCKET = '/tmp/mcp-sock-1.sock';
    process.env.BROKER_MANAGED_SERVICES = 'nginx';
    const { startBroker, handleRequest } = await import(`../../broker.js?test=${Date.now()}`);
    const origSetInterval = global.setInterval;
    global.setInterval = (fn, ms) => origSetInterval(fn, ms).unref();
    const srv = startBroker();
    global.setInterval = origSetInterval;
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'service.action',
        parameters: { service: 'nginx', action: 'stop' },
      }),
      /Protected services require the recovery workflow/
    );
    srv.close();
  });
});
