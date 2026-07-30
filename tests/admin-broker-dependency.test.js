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

      const apiUsersRes = await fetch(`${baseUrl}/admin/api/oauth-users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const apiUsersBody = await apiUsersRes.json();
      assert.equal(apiUsersRes.status, 200);
      assert.equal(Array.isArray(apiUsersBody), true);

      const altUsersRes = await fetch(`${baseUrl}/api/admin/oauth-users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const altUsersBody = await altUsersRes.json();
      assert.equal(altUsersRes.status, 200);
      assert.equal(Array.isArray(altUsersBody), true);

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
      assert.ok(
        typeof manifestBody?.manifest?.version === 'string' || typeof manifestBody?.manifest?.version === 'number'
      );
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
        { label: 'admin action manifest', url: '/admin/action-manifest', expectedStatus: 200 },
        { label: 'admin action manifest (slash)', url: '/admin/action-manifest/', expectedStatus: 200 },
        { label: 'legacy action manifest', url: '/admin/api/action-manifest', expectedStatus: 200 },
        { label: 'legacy action manifest (slash)', url: '/admin/api/action-manifest/', expectedStatus: 200 },
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
      const disconnectRes = await fetch(`${baseUrl}/admin/sessions`, {
        method: 'DELETE',
        headers: authHeader,
      });
      const disconnectBody = await disconnectRes.json();
      assert.equal(disconnectRes.status, 200);
      assert.equal(disconnectBody?.success, true);
      assert.equal(disconnectBody?.disconnected, 0);

      const manifestRes = await fetch(`${baseUrl}/action-manifest`, {
        headers: authHeader,
      });
      const manifestBody = await manifestRes.json();
      assert.equal(manifestRes.status, 200);
      assert.ok(
        typeof manifestBody?.manifest?.version === 'string' || typeof manifestBody?.manifest?.version === 'number'
      );
      assert.ok(Array.isArray(manifestBody?.refreshChecklist));
      const toolNames = new Set((manifestBody?.manifest?.tools || []).map(item => item.name));
      const missingTool = [
        'run_project_tests',
        'get_project_test_run',
        'cancel_project_test_run',
        'get_my_ssh_access',
        'set_my_ssh_access',
      ].find(name => !toolNames.has(name));
      assert.equal(missingTool, undefined);

      const sshTool = manifestBody?.manifest?.tools?.find(tool => tool.name === 'admin_set_ssh_access');
      if (sshTool) {
        const enumValues = sshTool?.inputSchema?.properties?.targetType?.enum || [];
        assert.ok(
          Array.isArray(enumValues) && enumValues.includes('identity-key'),
          'admin_set_ssh_access enum missing identity-key'
        );
      }
    } finally {
      if (child && !child.killed) child.kill('SIGTERM');
      child = null;
    }
  });

  it('serves the SPA shell for unknown /admin browser routes', async () => {
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
      const response = await fetch(`${baseUrl}/admin/does-not-exist`, {
        headers: { Accept: 'text/html' },
      });
      const body = await response.text();
      assert.equal(response.status, 200);
      assert.ok(body.includes('<!DOCTYPE html>') || body.includes('<html'));
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

  it('returns empty OAuth collections when list readers encounter non-broker local errors', async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const missingBrokerSocket = path.join(tmp, 'broker.sock');
    const malformedDir = await fs.mkdtemp(path.join(tmp, 'mcp-oauth-malfunction-'));
    const userFileAsDir = path.join(malformedDir, 'users');

    await fs.mkdir(userFileAsDir);

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
        KEYS_FILE: path.join(malformedDir, 'keys.json'),
        KEYSTORE_FILE: path.join(malformedDir, 'keys.json'),
        CONTROL_PLANE_STATE_FILE: path.join(malformedDir, 'state.json'),
        MCP_CAPABILITIES_FILE: path.join(malformedDir, 'capabilities.json'),
        MCP_STATE_DB: path.join(malformedDir, 'state.sqlite3'),
        MCP_BROKER_SOCKET: missingBrokerSocket,
        AUTHELIA_USERS_FILE: userFileAsDir,
        AUTHELIA_CONFIG_FILE: path.join(malformedDir, 'authelia.yml'),
        AUDIT_LOG_DIR: path.join(malformedDir, 'logs'),
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
    } finally {
      if (child && !child.killed) child.kill('SIGTERM');
      child = null;
      await fs.rm(malformedDir, { recursive: true, force: true });
    }
  });

  it('returns empty OAuth collections when Authelia files are malformed instead of 500', async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const missingBrokerSocket = path.join(tmp, 'broker.sock');
    const malformedDir = await fs.mkdtemp(path.join(tmp, 'mcp-malformed-authelia-'));

    await fs.writeFile(path.join(malformedDir, 'users.yml'), 'users: [::oops', 'utf8');
    await fs.writeFile(path.join(malformedDir, 'authelia.yml'), 'identity_providers: [::oops', 'utf8');

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
        KEYS_FILE: path.join(malformedDir, 'keys.json'),
        KEYSTORE_FILE: path.join(malformedDir, 'keys.json'),
        CONTROL_PLANE_STATE_FILE: path.join(malformedDir, 'state.json'),
        MCP_CAPABILITIES_FILE: path.join(malformedDir, 'capabilities.json'),
        MCP_STATE_DB: path.join(malformedDir, 'state.sqlite3'),
        MCP_BROKER_SOCKET: missingBrokerSocket,
        AUTHELIA_USERS_FILE: path.join(malformedDir, 'users.yml'),
        AUTHELIA_CONFIG_FILE: path.join(malformedDir, 'authelia.yml'),
        AUDIT_LOG_DIR: path.join(malformedDir, 'logs'),
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
      await fs.rm(malformedDir, { recursive: true, force: true });
    }
  });

  it('returns dependency-unavailable for user update when the broker socket is missing', async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const missingBrokerSocket = path.join(tmp, 'broker.sock');
    const stateDir = await fs.mkdtemp(path.join(tmp, 'mcp-oauth-missing-user-'));

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
        KEYS_FILE: path.join(stateDir, 'keys.json'),
        KEYSTORE_FILE: path.join(stateDir, 'keys.json'),
        CONTROL_PLANE_STATE_FILE: path.join(stateDir, 'state.json'),
        MCP_CAPABILITIES_FILE: path.join(stateDir, 'capabilities.json'),
        MCP_STATE_DB: path.join(stateDir, 'state.sqlite3'),
        MCP_BROKER_SOCKET: missingBrokerSocket,
        AUTHELIA_USERS_FILE: path.join(stateDir, 'users.yml'),
        AUTHELIA_CONFIG_FILE: path.join(stateDir, 'authelia.yml'),
        AUDIT_LOG_DIR: path.join(stateDir, 'logs'),
      },
      stdio: 'ignore',
    });

    try {
      await fs.writeFile(path.join(stateDir, 'users.yml'), 'users: {}\n', { mode: 0o600 });
      await fs.writeFile(path.join(stateDir, 'authelia.yml'), 'identity_providers:\n  oidc:\n    clients: []\n', {
        mode: 0o600,
      });

      await waitFor(`${baseUrl}/health`);
      const token = await fetchToken(baseUrl);

      const response = await fetch(`${baseUrl}/admin/oauth-users/missing-user`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'missing@example.test' }),
      });
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body?.code, 'BROKER_UNAVAILABLE');
    } finally {
      if (child && !child.killed) child.kill('SIGTERM');
      child = null;
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
