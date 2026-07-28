import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sentinel-admin-broker-'));
const adminKey = 'admin-dependency-test-key-placeholder-32chars!!';
const jwtSecret = 'z'.repeat(64);
let child;

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

async function waitFor(baseUrl) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the Sentinel admin server');
}

async function fetchToken(baseUrl) {
  const response = await fetch(`${baseUrl}/auth/token`, {
    method: 'POST',
    headers: { 'x-api-key': adminKey },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Auth token request failed (${response.status}): ${body?.error || 'unknown'}`);
  }
  return body.token;
}

after(() => fs.rm(tmp, { recursive: true, force: true }));

after(() => {
  if (child && !child.killed) child.kill('SIGTERM');
});

describe('admin OAuth endpoints report broker dependency status', { signal: new AbortController().signal }, () => {
  it('returns BROKER_UNAVAILABLE for OAuth user/client admin endpoints without a socket', async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const missingBrokerSocket = path.join(tmp, 'broker.sock');

    child = spawn(process.execPath, ['server.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        HOST: '127.0.0.1',
        USE_HTTPS: 'false',
        ALLOWED_ORIGINS: baseUrl,
        ADMIN_API_KEY: adminKey,
        JWT_SECRET: jwtSecret,
        KEYS_FILE: path.join(tmp, 'keys.json'),
        KEYSTORE_FILE: path.join(tmp, 'keys.json'),
        CONTROL_PLANE_STATE_FILE: path.join(tmp, 'state.json'),
        MCP_CAPABILITIES_FILE: path.join(tmp, 'capabilities.json'),
        MCP_STATE_DB: path.join(tmp, 'state.sqlite3'),
        MCP_BROKER_SOCKET: missingBrokerSocket,
        AUDIT_LOG_DIR: path.join(tmp, 'logs'),
      },
      stdio: 'ignore',
    });

    try {
      await waitFor(`${baseUrl}/health`);
      const token = await fetchToken(baseUrl);

      const usersRes = await fetch(`${baseUrl}/admin/oauth-users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const usersBody = await usersRes.json();
      assert.equal(usersRes.status, 503);
      assert.equal(usersBody?.code, 'BROKER_UNAVAILABLE');
      assert.match(usersBody?.error || '', /broker unavailable|connect ENOENT|Privilege broker unavailable/);

      const clientsRes = await fetch(`${baseUrl}/admin/oauth-clients`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const clientsBody = await clientsRes.json();
      assert.equal(clientsRes.status, 503);
      assert.equal(clientsBody?.code, 'BROKER_UNAVAILABLE');
      assert.match(clientsBody?.error || '', /broker unavailable|connect ENOENT|Privilege broker unavailable/);
    } finally {
      if (child && !child.killed) child.kill('SIGTERM');
      child = null;
    }
  });
});
