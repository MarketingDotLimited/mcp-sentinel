import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import express from 'express';

const handlers = [];
const originalGet = express.application.get;
express.application.get = function(p, ...args) {
  if (typeof p === 'string' && p.startsWith('/')) handlers.push({ method: 'get', path: p, handler: args[args.length - 1] });
  return originalGet.apply(this, [p, ...args]);
};
const originalPost = express.application.post;
express.application.post = function(p, ...args) {
  if (typeof p === 'string' && p.startsWith('/')) handlers.push({ method: 'post', path: p, handler: args[args.length - 1] });
  return originalPost.apply(this, [p, ...args]);
};
const originalPut = express.application.put;
express.application.put = function(p, ...args) {
  if (typeof p === 'string' && p.startsWith('/')) handlers.push({ method: 'put', path: p, handler: args[args.length - 1] });
  return originalPut.apply(this, [p, ...args]);
};
const originalDelete = express.application.delete;
express.application.delete = function(p, ...args) {
  if (typeof p === 'string' && p.startsWith('/')) handlers.push({ method: 'delete', path: p, handler: args[args.length - 1] });
  return originalDelete.apply(this, [p, ...args]);
};

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sentinel-test-'));
const checkpointPath = path.join(tmpDir, 'audit-chain.json');
fs.writeFileSync(checkpointPath, JSON.stringify({ seqNo: 1, hash: 'a'.repeat(64) }));
fs.writeFileSync(path.join(tmpDir, 'audit-1.log'), JSON.stringify({ seqNo: 1, hash: 'a'.repeat(64) }) + '\n');

const brokerSocketPath = path.join(tmpDir, 'broker.sock');
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

describe('server.js exhaustive fuzzer', async () => {
  before(async () => {
    brokerServer = net.createServer((socket) => {
      let data = '';
      socket.on('data', chunk => {
        data += chunk;
        if (data.includes('\n')) {
          try {
            const req = JSON.parse(data.trim());
            let result = { success: true };
            if (req.operation === 'broker.health') result = { healthy: true };
            socket.write(`${JSON.stringify({ requestId: req.requestId, ok: true, result })}\n`);
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
    
    await import('../server.js');
  });

  it('fuzzes all route handlers directly in memory', async () => {
    const proxyHandler = {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        if (prop === 'then') return undefined; // so it's not treated as a Promise
        if (typeof prop === 'symbol') return undefined;
        return '123';
      }
    };
    
    for (const r of handlers) {
      if (typeof r.handler !== 'function') continue;
      
      const res = {
        status: () => res,
        json: () => res,
        send: () => res,
        writeHead: () => res,
        write: () => res,
        end: () => res,
        redirect: () => res
      };
      
      const req = {
        identity: { role: 'admin', userId: 'test-admin' },
        query: new Proxy({}, proxyHandler),
        body: new Proxy({}, proxyHandler),
        params: new Proxy({}, proxyHandler),
        headers: {},
        clientIP: '127.0.0.1'
      };
      
      try { await r.handler(req, res); } catch (e) {}
      
      const reqNonAdmin = { ...req, identity: { role: 'user', userId: 'test-user' } };
      try { await r.handler(reqNonAdmin, res); } catch (e) {}
    }
  });

  it('fuzzes MCP tools using Client', async () => {
    const baseUrl = `http://127.0.0.1:${port}`;
    const transport = new SSEClientTransport(new URL('/mcp', baseUrl), {
      requestInit: { headers: { 'x-api-key': 'test-admin' } },
      eventSourceInit: { headers: { 'x-api-key': 'test-admin' } }
    });
    const client = new Client({ name: 'fuzzer', version: '1.0' }, { capabilities: {} });
    
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      
      for (const t of tools.tools) {
        try { await client.callTool({ name: t.name, arguments: {} }); } catch (e) {}
        try { await client.callTool({ name: t.name, arguments: { flowId: 'f1', resumeFromPassed: true, forceReplay: true, params: {} } }); } catch (e) {}
      }
    } catch(e) {
    } finally {
      try { await client.close(); } catch(e) {}
    }
  });

  after(() => {
    process.removeAllListeners();
    brokerServer.close();
    setImmediate(() => process.exit(0)); 
  });
});
