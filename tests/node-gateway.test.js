import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { handleGatewayInput } from '../node-gateway.js';

function request(operation = 'project.file.read', parameters = { projectId: randomUUID(), path: 'README.md' }) {
  return `${JSON.stringify({ requestId: randomUUID(), operation, parameters })}\n`;
}

describe('forced-command node gateway', () => {
  it('forwards one typed request and preserves its request identity', async () => {
    const input = request();
    const parsed = JSON.parse(input);
    const response = await handleGatewayInput(input, {
      brokerCall: async (operation, parameters) => ({ operation, parameters }),
    });
    assert.equal(response.requestId, parsed.requestId);
    assert.equal(response.ok, true);
    assert.equal(response.result.operation, 'project.file.read');
  });

  it('rejects shell commands, TTYs, arbitrary operations, extra fields, and multiple requests', async () => {
    await assert.rejects(handleGatewayInput(request(), { originalCommand: 'id' }), /commands are not accepted/);
    await assert.rejects(handleGatewayInput(request(), { hasTty: true }), /TTY/);
    await assert.rejects(handleGatewayInput(request('shell.exec')), /not permitted/);
    const extra = JSON.parse(request());
    extra.command = 'id';
    await assert.rejects(handleGatewayInput(`${JSON.stringify(extra)}\n`), /unknown or missing/);
    await assert.rejects(handleGatewayInput(`${request()}${request()}`), /exactly one/);
  });
});
