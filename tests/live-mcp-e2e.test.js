// Opt-in live integration test. It starts an isolated Sentinel instance, creates
// and removes one temporary OS account, and verifies least-privilege MCP access.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const enabled = process.env.RUN_LIVE_E2E === 'true';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sentinel-live-'));
const adminKey = 'mcp_abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz1234';
const limitedKey = 'mcp_zyxwvutsrqponmlkjihgfedcba1234567890zyxwvutsrqponmlkjihgfedcba12';
const username = `mcpqa${process.pid}`.slice(0, 31);
let child;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the live Sentinel instance');
}

async function issueToken(baseUrl, key) {
  const response = await fetch(`${baseUrl}/auth/token`, { method: 'POST', headers: { 'x-api-key': key } });
  if (response.status !== 200) throw new Error(`Token request failed (${response.status}): ${await response.text()}`);
  return (await response.json()).token;
}

class McpSession {
  constructor(baseUrl, key) { this.baseUrl = baseUrl; this.key = key; this.id = 0; this.sessionId = null; }
  async request(method, params) {
    const response = await fetch(`${this.baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': this.key, ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
    });
    if (response.status !== 200) throw new Error(`MCP request failed (${response.status}): ${await response.text()}`);
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.sessionId = sessionId;
    const text = await response.text();
    if (!text) return {};
    const data = text.split('\n').find(line => line.startsWith('data: '));
    return JSON.parse(data ? data.slice(6) : text);
  }
  async initialize() {
    const response = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'live-e2e', version: '1.0.0' } });
    assert.ok(response.result?.serverInfo?.name);
    assert.ok(this.sessionId);
    await this.request('notifications/initialized', {});
  }
  async call(name, arguments_) { return this.request('tools/call', { name, arguments: arguments_ }); }
}

after(async () => {
  if (child && !child.killed) child.kill('SIGTERM');
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('live MCP least-privilege path', { skip: !enabled }, () => {
  it('creates a constrained OS user, blocks unsafe calls, and removes the user', async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env, PORT: String(port), HOST: '127.0.0.1', USE_HTTPS: 'false', ADMIN_API_KEY: adminKey,
        JWT_SECRET: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef',
        KEYS_FILE: path.join(tmp, 'keys.json'), KEYSTORE_FILE: path.join(tmp, 'keys.json'),
        CONTROL_PLANE_STATE_FILE: path.join(tmp, 'control-plane.json'), AUDIT_LOG_DIR: path.join(tmp, 'logs'),
      }, stdio: 'ignore',
    });
    await waitFor(`${baseUrl}/health`);

    const admin = new McpSession(baseUrl, adminKey);
    await admin.initialize();
    const toolList = await admin.request('tools/list', {});
    const systemInfo = toolList.result.tools.find(tool => tool.name === 'get_system_info');
    assert.deepEqual(systemInfo.annotations, { readOnlyHint: true, idempotentHint: true });
    let created = false;
    try {
      const create = await admin.call('create_user', { username, shell: '/usr/sbin/nologin', comment: 'Temporary MCP live test', createHome: true, confirm: true });
      assert.equal(create.result.isError, undefined, JSON.stringify(create));
      created = true;

      const token = await issueToken(baseUrl, adminKey);
      const addKey = await fetch(`${baseUrl}/admin/keys`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ key: limitedKey, userId: username, role: 'user', label: 'live least-privilege test' }),
      });
      if (addKey.status !== 200) throw new Error(`Key creation failed (${addKey.status}): ${await addKey.text()}`);

      const limited = new McpSession(baseUrl, limitedKey);
      await limited.initialize();
      const health = await limited.call('get_system_info', {});
      assert.equal(health.result.isError, undefined, JSON.stringify(health));
      const shadow = await limited.call('read_file', { filePath: '/etc/shadow' });
      assert.equal(shadow.result.isError, true, JSON.stringify(shadow));
      const createDenied = await limited.call('create_user', { username: 'shouldnotwork', confirm: true });
      assert.equal(createDenied.result.isError, true, JSON.stringify(createDenied));
    } finally {
      if (created) {
        const removed = await admin.call('delete_user', { username, removeHome: true, confirm: true });
        assert.equal(removed.result.isError, undefined, JSON.stringify(removed));
      }
    }
  });
});
