import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.BROKER_MANAGED_SERVICES = 'example-app,nginx';
process.env.BROKER_PROTECTED_SERVICES = 'nginx,mcp-sentinel,mcp-sentinel-broker,ssh,sshd,authelia';
process.env.BROKER_FIREWALL_PORTS = '22,443,8443';
process.env.BROKER_MANAGEMENT_PORTS = '22,443';

const { handleRequest } = await import(`../broker.js?test=${Date.now()}`);
const requestId = '00000000-0000-4000-8000-000000000001';

describe('typed privilege broker', () => {
  it('rejects arbitrary commands and unknown fields', async () => {
    await assert.rejects(
      handleRequest({ requestId, operation: 'exec', parameters: { command: '/bin/sh' } }),
      /Unknown operation/
    );
    await assert.rejects(
      handleRequest({ requestId, operation: 'service.status', parameters: { service: 'example-app', argv: ['id'] } }),
      /unknown field/
    );
  });

  it('rejects unregistered and protected service mutations', async () => {
    await assert.rejects(
      handleRequest({ requestId, operation: 'service.status', parameters: { service: 'not-registered' } }),
      /not registered/
    );
    await assert.rejects(
      handleRequest({ requestId, operation: 'service.action', parameters: { service: 'nginx', action: 'restart' } }),
      /Protected services/
    );
  });

  it('preserves management firewall ports', async () => {
    await assert.rejects(
      handleRequest({
        requestId,
        operation: 'firewall.rule',
        parameters: { action: 'deny', port: 22, protocol: 'tcp' },
      }),
      /Management connectivity/
    );
    await assert.rejects(
      handleRequest({
        requestId,
        operation: 'firewall.rule',
        parameters: { action: 'allow', port: 12345, protocol: 'tcp' },
      }),
      /not registered/
    );
  });
});
