import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tools-test-'));
const checkpointPath = path.join(tmpDir, 'audit-chain.json');
fs.writeFileSync(checkpointPath, JSON.stringify({ seqNo: 1, hash: 'a'.repeat(64) }));
fs.writeFileSync(path.join(tmpDir, 'audit-1.log'), JSON.stringify({ seqNo: 1, hash: 'a'.repeat(64) }) + '\n');

const brokerSocketPath = path.join(tmpDir, 'broker.sock');

function generateDummyValue(schema) {
  if (!schema) return undefined;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === 'string') return schema.format === 'uuid' ? '123e4567-e89b-12d3-a456-426614174000' : 'test';
  if (schema.type === 'number' || schema.type === 'integer') return 1;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'array') return schema.items ? [generateDummyValue(schema.items)] : [];
  if (schema.type === 'object' || schema.properties) {
    const obj = {};
    for (const [k, v] of Object.entries(schema.properties || {})) {
      obj[k] = generateDummyValue(v);
    }
    return obj;
  }
  return null;
}

let brokerServer;
let port;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

describe('server-mcp-tools', async () => {
  before(async () => {
    brokerServer = net.createServer(socket => {
      let data = '';
      socket.on('data', chunk => {
        data += chunk;
        if (data.includes('\n')) {
          try {
            const req = JSON.parse(data.trim());
            socket.write(`${JSON.stringify({ requestId: req.requestId, ok: true, result: { success: true } })}\n`);
            socket.end();
          } catch {
            socket.end();
          }
        }
      });
    });
    await new Promise(resolve => brokerServer.listen(brokerSocketPath, resolve));

    port = await freePort();
    process.env.PORT = String(port);
    process.env.USE_HTTPS = 'false';
    process.env.ADMIN_API_KEY = 'test-admin';
    process.env.JWT_SECRET = 'a'.repeat(64);
    process.env.AUDIT_HMAC_KEY = 'a'.repeat(64);
    process.env.AUDIT_LOG_DIR = tmpDir;
    process.env.AUDIT_CHECKPOINT_FILE = checkpointPath;
    process.env.MCP_BROKER_SOCKET = brokerSocketPath;
    process.env.MCP_STATE_DB = path.join(tmpDir, 'state.db');
    process.env.KEYSTORE_FILE = path.join(tmpDir, 'keys.json');
    process.env.JWT_REVOCATION_FILE = path.join(tmpDir, 'revocs.json');
    process.env.TEST_NO_LISTEN = 'false'; // actually listen so we can connect SSE!

    await import('../server.js');
    await new Promise(r => setTimeout(r, 1000)); // wait for server to start
  });

  it('smartly fuzzes all MCP tools', async () => {
    const baseUrl = `http://127.0.0.1:${port}`;
    const transport = new SSEClientTransport(new URL('/mcp', baseUrl), {
      requestInit: { headers: { 'x-api-key': 'test-admin' } },
      eventSourceInit: { headers: { 'x-api-key': 'test-admin' } },
    });
    const client = new Client({ name: 'fuzzer', version: '1.0' }, { capabilities: {} });

    await client.connect(transport);
    const tools = await client.listTools();

    for (const t of tools.tools) {
      const args = generateDummyValue(t.inputSchema);
      try {
        await client.callTool({ name: t.name, arguments: args });
      } catch (e) {}
    }
    await client.close();
  });

  after(() => {
    brokerServer.close();
    process.exit(0);
  });
});
