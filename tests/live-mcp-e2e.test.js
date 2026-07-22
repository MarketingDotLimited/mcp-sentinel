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
let broker;
const sessions = new Set();

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

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the live Sentinel instance');
}

async function waitForSocket(socketPath) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fs.stat(socketPath)).isSocket()) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the privilege broker');
}

async function issueToken(baseUrl, key) {
  const response = await fetch(`${baseUrl}/auth/token`, { method: 'POST', headers: { 'x-api-key': key } });
  if (response.status !== 200) throw new Error(`Token request failed (${response.status}): ${await response.text()}`);
  return (await response.json()).token;
}

async function setCapability(baseUrl, key, id, enabled) {
  const token = await issueToken(baseUrl, key);
  const response = await fetch(`${baseUrl}/admin/capabilities/${id}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (response.status !== 200)
    throw new Error(`Capability update failed (${response.status}): ${await response.text()}`);
}

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

class McpSession {
  constructor(baseUrl, key, useBearer = false, transportKind = 'sse') {
    this.baseUrl = baseUrl;
    this.key = key;
    this.useBearer = useBearer;
    this.transportKind = transportKind;
    this.client = null;
    this.toolListWaiters = [];
  }
  async initialize() {
    const url = new URL(`${this.baseUrl}/mcp`);
    const headers = this.useBearer ? { authorization: `Bearer ${this.key}` } : { 'x-api-key': this.key };
    const transport =
      this.transportKind === 'streamable'
        ? new StreamableHTTPClientTransport(url, { requestInit: { headers } })
        : new SSEClientTransport(url, { eventSourceInit: { headers }, requestInit: { headers } });
    this.client = new Client({ name: 'live-e2e', version: '1.0.0' }, { capabilities: {} });
    this.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      for (const resolve of this.toolListWaiters.splice(0)) resolve();
    });
    await this.client.connect(transport);
    sessions.add(this);
  }
  async request(method, params) {
    if (method === 'tools/list') {
      const res = await this.client.listTools();
      return { result: res };
    }
    throw new Error(`Unsupported request method in test: ${method}`);
  }
  async call(name, arguments_) {
    const res = await this.client.callTool({ name, arguments: arguments_ });
    return { result: res };
  }
  async close() {
    sessions.delete(this);
    await this.client?.close();
  }
  nextToolListChanged() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for tools/list_changed')), 2000);
      this.toolListWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

after(async () => {
  await Promise.allSettled([...sessions].map(session => session.close()));
  if (child && !child.killed) child.kill('SIGTERM');
  if (broker && !broker.killed) broker.kill('SIGTERM');
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('live MCP least-privilege path', { skip: !enabled }, () => {
  it('creates a constrained OS user, blocks unsafe calls, and removes the user', async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const brokerSocket = path.join(tmp, 'broker.sock');
    const sharedEnvironment = {
      ...process.env,
      NODE_ENV: 'test',
      MCP_BROKER_SOCKET: brokerSocket,
      MCP_STATE_DB: path.join(tmp, 'state.sqlite3'),
      BROKER_MANAGED_USERS: username,
    };
    broker = spawn(process.execPath, ['broker.js'], {
      cwd: process.cwd(),
      env: sharedEnvironment,
      stdio: 'ignore',
    });
    await waitForSocket(brokerSocket);
    child = spawn(process.execPath, ['server.js'], {
      cwd: process.cwd(),
      env: {
        ...sharedEnvironment,
        PORT: String(port),
        HOST: '127.0.0.1',
        USE_HTTPS: 'false',
        ALLOWED_ORIGINS: baseUrl,
        ADMIN_API_KEY: adminKey,
        JWT_SECRET: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef',
        KEYS_FILE: path.join(tmp, 'keys.json'),
        KEYSTORE_FILE: path.join(tmp, 'keys.json'),
        CONTROL_PLANE_STATE_FILE: path.join(tmp, 'control-plane.json'),
        MCP_CAPABILITIES_FILE: path.join(tmp, 'capabilities.json'),
        AUDIT_LOG_DIR: path.join(tmp, 'logs'),
      },
      stdio: 'ignore',
    });
    await waitFor(`${baseUrl}/health`);

    const defaultAdmin = new McpSession(baseUrl, adminKey);
    await defaultAdmin.initialize();
    const defaultTools = await defaultAdmin.request('tools/list', {});
    assert.equal(
      defaultTools.result.tools.some(tool => tool.name === 'create_user'),
      false
    );
    assert.equal(
      defaultTools.result.tools.some(tool => tool.name === 'execute_query'),
      false
    );
    const sseListChanged = defaultAdmin.nextToolListChanged();
    await setCapability(baseUrl, adminKey, 'advanced-system-admin', true);
    await sseListChanged;

    const admin = new McpSession(baseUrl, adminKey, false, 'streamable');
    await admin.initialize();
    const toolList = await admin.request('tools/list', {});
    const systemInfo = toolList.result.tools.find(tool => tool.name === 'get_system_info');
    assert.deepEqual(systemInfo.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const projectTest = toolList.result.tools.find(tool => tool.name === 'run_project_tests');
    assert.deepEqual(projectTest.inputSchema.required.sort(), ['confirm', 'projectId', 'runner'].sort());
    assert.equal('projectPath' in projectTest.inputSchema.properties, false);
    assert.equal(projectTest.inputSchema.properties.confirm.const, true);
    assert.deepEqual(projectTest.outputSchema.required, ['result']);
    assert.match(JSON.stringify(projectTest.outputSchema), /failureClassification/);
    for (const removed of [
      'list_automations',
      'schedule_health_check',
      'list_fleet_servers',
      'check_fleet_server',
      'list_backup_targets',
      'run_encrypted_backup',
      'list_webhooks',
      'deliver_webhook',
    ])
      assert.equal(
        toolList.result.tools.some(tool => tool.name === removed),
        false
      );
    const streamableListChanged = admin.nextToolListChanged();
    await setCapability(baseUrl, adminKey, 'advanced-data', true);
    await streamableListChanged;
    let created = false;
    try {
      const create = await admin.call('create_user', {
        username,
        shell: '/usr/sbin/nologin',
        comment: 'Temporary MCP live test',
        createHome: false,
        confirm: true,
      });
      assert.equal(create.result.isError, undefined, JSON.stringify(create));
      created = true;

      const token = await issueToken(baseUrl, adminKey);
      const addKey = await fetch(`${baseUrl}/admin/keys`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ key: limitedKey, userId: username, role: 'user', label: 'live least-privilege test' }),
      });
      if (addKey.status !== 200) throw new Error(`Key creation failed (${addKey.status}): ${await addKey.text()}`);

      // Bearer-only MCP clients (such as Codex CLI) must receive the exact
      // same least-privilege policy as clients using X-API-Key.
      const limited = new McpSession(baseUrl, limitedKey, true);
      await limited.initialize();
      const health = await limited.call('get_system_info', {});
      assert.equal(health.result.isError, undefined, JSON.stringify(health));
      const shadow = await limited.call('read_file', { filePath: '/etc/shadow' });
      assert.equal(shadow.result.isError, true, JSON.stringify(shadow));
      const createDenied = await limited.call('create_user', { username: 'shouldnotwork', confirm: true });
      assert.equal(createDenied.result.isError, true, JSON.stringify(createDenied));
    } finally {
      if (created) {
        const removed = await admin.call('delete_user', { username, removeHome: false, confirm: true });
        assert.equal(removed.result.isError, undefined, JSON.stringify(removed));
      }
    }
  });
});
