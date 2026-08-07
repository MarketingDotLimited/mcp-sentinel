import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import fs from 'node:fs';
import { handleGatewayInput } from '../node-gateway.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const GATEWAY_BIN = join(__dirname, '..', 'node-gateway.js');

function request(operation = 'project.file.read', parameters = { projectId: randomUUID(), path: 'README.md' }) {
  return `${JSON.stringify({ requestId: randomUUID(), operation, parameters })}\n`;
}

function runGatewayProcess(inputStr, envOverrides = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [GATEWAY_BIN], {
      env: { ...process.env, ...envOverrides },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => {
      stdout += d.toString();
    });
    child.stderr.on('data', d => {
      stderr += d.toString();
    });
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.write(inputStr);
    child.stdin.end();
  });
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
    await assert.rejects(handleGatewayInput('invalid-json\n'), /Node gateway request must be JSON/);

    // Test direct too large request
    const largeStr = 'A'.repeat(65 * 1024) + '\n';
    await assert.rejects(handleGatewayInput(largeStr), /Node gateway request is too large/);

    // Test bad UUID
    const badId = JSON.parse(request());
    badId.requestId = 'invalid-uuid';
    await assert.rejects(handleGatewayInput(`${JSON.stringify(badId)}\n`), /Invalid node gateway request ID/);
  });

  describe('CLI main()', () => {
    let brokerServer;
    const socketPath = join(__dirname, '..', `test-broker-${randomUUID()}.sock`);

    it('sets up dummy broker', () => {
      return new Promise(resolve => {
        brokerServer = net.createServer(socket => {
          let data = '';
          socket.on('data', chunk => {
            data += chunk;
            if (data.includes('\n')) {
              try {
                const req = JSON.parse(data.trim());
                const res = { requestId: req.requestId, ok: true, result: { success: true } };
                socket.write(`${JSON.stringify(res)}\n`);
                socket.end();
              } catch {
                socket.end();
              }
            }
          });
        });
        brokerServer.listen(socketPath, resolve);
      });
    });

    it('executes normally and handles input via mocked broker', async () => {
      const req = request('project.file.read', { path: 'test' });
      const reqId = JSON.parse(req).requestId;
      const res = await runGatewayProcess(req, { MCP_BROKER_SOCKET: socketPath });
      assert.equal(res.code, 0);
      const outObj = JSON.parse(res.stdout.trim());
      assert.equal(outObj.requestId, reqId);
      assert.equal(outObj.ok, true);
    });

    it('handles broker error', async () => {
      const req = request('project.file.read', { path: 'test' });
      const reqId = JSON.parse(req).requestId;
      const res = await runGatewayProcess(req, { MCP_BROKER_SOCKET: '/tmp/non-existent.sock' });
      assert.equal(res.code, 1);
      const outObj = JSON.parse(res.stdout.trim());
      assert.equal(outObj.requestId, reqId);
      assert.equal(outObj.ok, false);
    });

    it('handles invalid json', async () => {
      const invalidReq = 'invalid json';
      const res = await runGatewayProcess(invalidReq);
      assert.equal(res.code, 1);
      const outObj = JSON.parse(res.stdout.trim());
      assert.equal(outObj.ok, false);
      assert.match(outObj.error, /Node gateway request must be JSON/);
    });

    it('handles json without requestId (tests fallback in main catch block)', async () => {
      const noIdReq = JSON.stringify({ operation: 'project.file.read', parameters: {} }) + '\n';
      const res = await runGatewayProcess(noIdReq);
      assert.equal(res.code, 1);
      const outObj = JSON.parse(res.stdout.trim());
      assert.equal(outObj.requestId, null);
    });

    it('handles too large request', async () => {
      const largeStr = 'A'.repeat(65 * 1024) + '\n';
      const res = await runGatewayProcess(largeStr);
      assert.equal(res.code, 1);
      assert.match(res.stderr, /Node gateway request is too large/);
    });

    it('teardown dummy broker', () => {
      return new Promise(resolve => {
        brokerServer.close(() => {
          if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
          resolve();
        });
      });
    });
  });
});
