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
  it('keeps OAuth read routes usable when the privilege broker socket is missing', async () => {
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
      assert.equal(usersRes.status, 200);
      assert.equal(Array.isArray(usersBody), true);

      const clientsRes = await fetch(`${baseUrl}/admin/oauth-clients`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const clientsBody = await clientsRes.json();
      assert.equal(clientsRes.status, 200);
      assert.equal(Array.isArray(clientsBody), true);

      const manifestRes = await fetch(`${baseUrl}/admin/action-manifest`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const manifestBody = await manifestRes.json();
      assert.equal(manifestRes.status, 200);
      assert.ok(typeof manifestBody?.manifest?.version === 'string' || typeof manifestBody?.manifest?.version === 'number');
      assert.equal(Array.isArray(manifestBody?.refreshChecklist), true);
      assert.ok(Array.isArray(manifestBody?.manifest?.tools));

      const unauthRes = await fetch(`${baseUrl}/admin/oauth-users`);
      const unauthBody = await unauthRes.json();
      assert.equal(unauthRes.status, 401);
      assert.ok(unauthBody?.error === 'Authentication required' || unauthBody?.error === 'Missing API key');
    } finally {
      if (child && !child.killed) child.kill('SIGTERM');
      child = null;
    }
  });

  it('supports admin endpoint aliases and keeps unrelated endpoints usable without the broker', async () => {
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
      const authHeader = { Authorization: `Bearer ${token}` };

      const compatibilityChecks = [
        { label: 'admin capabilities', url: '/api/admin/capabilities', expectedStatus: 200 },
        { label: 'legacy admin capabilities', url: '/admin/api/capabilities', expectedStatus: 200 },
        { label: 'legacy action manifest', url: '/admin/api/action-manifest', expectedStatus: 200 },
        { label: 'slash-normalized action manifest', url: '/admin/action-manifest/', expectedStatus: 200 },
      ];

      for (const { label, url, expectedStatus } of compatibilityChecks) {
        const response = await fetch(`${baseUrl}${url}`, {
          headers: authHeader,
        });
        assert.equal(response.status, expectedStatus, `unexpected ${label} status`);
      }

      const sessionsRes = await fetch(`${baseUrl}/admin/sessions`, { headers: authHeader });
      const sessionsBody = await sessionsRes.json();
      assert.equal(sessionsRes.status, 200);
      assert.equal(sessionsBody?.count >= 0 || Array.isArray(sessionsBody?.sessions), true);

      const manifestRes = await fetch(`${baseUrl}/action-manifest`, {
        headers: authHeader,
      });
      const manifestBody = await manifestRes.json();
      assert.equal(manifestRes.status, 200);
      assert.ok(typeof manifestBody?.manifest?.version === 'string' || typeof manifestBody?.manifest?.version === 'number');
      assert.ok(Array.isArray(manifestBody?.refreshChecklist));
    } finally {
      if (child && !child.killed) child.kill('SIGTERM');
      child = null;
    }
  });

  it('returns empty OAuth collections when files are absent instead of 500', async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const missingBrokerSocket = path.join(tmp, 'broker.sock');
    const emptyDir = await fs.mkdtemp(path.join(tmp, 'mcp-missing-authelia-'));

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
        KEYS_FILE: path.join(emptyDir, 'keys.json'),
        KEYSTORE_FILE: path.join(emptyDir, 'keys.json'),
        CONTROL_PLANE_STATE_FILE: path.join(emptyDir, 'state.json'),
        MCP_CAPABILITIES_FILE: path.join(emptyDir, 'capabilities.json'),
        MCP_STATE_DB: path.join(emptyDir, 'state.sqlite3'),
        MCP_BROKER_SOCKET: missingBrokerSocket,
        AUTHELIA_USERS_FILE: path.join(emptyDir, 'users.yml'),
        AUTHELIA_CONFIG_FILE: path.join(emptyDir, 'authelia.yml'),
        AUDIT_LOG_DIR: path.join(emptyDir, 'logs'),
      },
      stdio: 'ignore',
    });

    try {
      await waitFor(`${baseUrl}/health`);
      const token = await fetchToken(baseUrl);

      const usersRes = await fetch(`${baseUrl}/admin/oauth-users`, { headers: { Authorization: `Bearer ${token}` } });
      const usersBody = await usersRes.json();
      assert.equal(usersRes.status, 200);
      assert.equal(Array.isArray(usersBody), true);
      assert.equal(usersBody.length, 0);

      const clientsRes = await fetch(`${baseUrl}/admin/oauth-clients`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const clientsBody = await clientsRes.json();
      assert.equal(clientsRes.status, 200);
      assert.equal(Array.isArray(clientsBody), true);
      assert.equal(clientsBody.length, 0);
    } finally {
      if (child && !child.killed) child.kill('SIGTERM');
      child = null;
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });
});
