import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

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

describe('broker startup', () => {
  it('replaces stale socket artifacts before listening', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-broker-startup-'));
    const stale = path.join(tmp, 'stale.sock');
    const requestId = '33333333-3333-4333-8333-333333333333';
    await fs.writeFile(stale, 'stale-socket-artifact');

    process.env.MCP_BROKER_SOCKET = stale;
    const brokerModule = await import(`../broker.js?startup-${Date.now()}`);
    const server = brokerModule.startBroker();

    try {
      const response = await new Promise((resolve, reject) => {
        const socket = net.createConnection({ path: stale });
        const parts = [];
        const deadline = setTimeout(() => {
          socket.destroy();
          reject(new Error('Broker startup request timed out'));
        }, 1000);

        socket.on('data', chunk => {
          parts.push(chunk);
          if (chunk.includes(0x0a)) {
            clearTimeout(deadline);
            socket.destroy();
            resolve(parts.join(''));
          }
        });
        socket.on('error', error => {
          clearTimeout(deadline);
          reject(error);
        });

        socket.on('connect', () => {
          socket.write(`${JSON.stringify({ requestId, operation: 'not-real', parameters: {} })}\n`);
        });
      });

      const parsed = JSON.parse(response.trim());
      assert.equal(parsed.requestId, requestId);
      assert.equal(parsed.ok, false);
      assert.match(parsed.error, /Unknown operation/);

      const socketStat = fsSync.lstatSync(stale);
      assert.equal(socketStat.isSocket(), true);
      assert.equal(stale.startsWith(tmp), true);
    } finally {
      server.close();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
