import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-security-auth-'));
process.env.KEYSTORE_FILE = path.join(directory, 'keys.json');
process.env.CONTROL_PLANE_STATE_FILE = path.join(directory, 'state.json');
process.env.JWT_REVOCATION_FILE = path.join(directory, 'revocations.json');
process.env.AUDIT_LOG_DIR = path.join(directory, 'logs');
process.env.JWT_SECRET = 'j'.repeat(64);
process.env.OAUTH_RESOURCE_URL = 'https://mcp.example.test';
delete process.env.MCP_STATE_DB;
delete process.env.ADMIN_API_KEY;
const security = await import(`../security.js?test=${Date.now()}`);
const apiKey = `mcp_${'a'.repeat(64)}`;
await security.addApiKey(apiKey, {
  userId: 'admin',
  role: 'developer',
  scopes: ['files.*', 'get_system_info'],
  allowedIPs: ['127.0.0.1/32'],
  requireApproval: true,
});

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
}

function request(headers = {}) {
  return {
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    path: '/api',
    protocol: 'https',
    get: () => 'mcp.example.test',
  };
}

after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('API key and session-token security', () => {
  it('authenticates a scoped API key and issues a bounded JWT', () => {
    const req = request({ 'x-api-key': apiKey });
    const res = response();
    let next = false;
    security.authenticate(req, res, () => (next = true));
    assert.equal(next, true);
    assert.equal(req.identity.role, 'developer');
    req.clientIP = '127.0.0.1';
    process.env.JWT_EXPIRY = '999d';
    security.issueToken(req, res);
    assert.equal(res.body.expires_in, '24h');
    assert.equal(res.body.token_type, 'Bearer');
  });

  it('validates and persistently revokes an internal session token', () => {
    const source = request({ 'x-api-key': apiKey });
    security.authenticate(source, response(), () => {});
    source.clientIP = '127.0.0.1';
    process.env.JWT_EXPIRY = '8h';
    const issued = response();
    security.issueToken(source, issued);
    const req = request({ authorization: `Bearer ${issued.body.token}` });
    req.clientIP = '127.0.0.1';
    let next = false;
    security.authenticateJWT(req, response(), () => (next = true));
    assert.equal(next, true);
    assert.ok(req.identity.jti);
    const logout = response();
    security.revokeSessionToken(req, logout);
    assert.equal(logout.body.success, true);
    const denied = response();
    security.authenticateJWT(request({ authorization: `Bearer ${issued.body.token}` }), denied, () => {});
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.body.error, 'Token revoked');
  });

  it('rejects missing, invalid, and IP-disallowed API keys', async () => {
    const missing = response();
    security.authenticate(request(), missing, () => {});
    assert.equal(missing.statusCode, 401);
    const invalid = response();
    security.authenticate(request({ 'x-api-key': 'invalid' }), invalid, () => {});
    assert.equal(invalid.statusCode, 403);
    const blocked = request({ 'x-api-key': apiKey });
    blocked.socket.remoteAddress = '203.0.113.9';
    const blockedResponse = response();
    security.authenticate(blocked, blockedResponse, () => {});
    assert.equal(blockedResponse.body.error, 'IP address not permitted');
    await assert.rejects(security.addApiKey('short', { userId: 'admin', role: 'viewer' }), /at least 32/);
    await assert.rejects(
      security.addApiKey(`mcp_${'b'.repeat(64)}`, { userId: 'admin', role: 'invalid' }),
      /Invalid role/
    );
  });

  it('emits OAuth discovery challenges and enforces scope middleware', () => {
    const req = request({ authorization: 'Bearer invalid.jwt.value' });
    req.path = '/mcp';
    const res = response();
    security.authenticateJWT(req, res, () => {});
    assert.equal(res.statusCode, 401);
    assert.match(res.headers['WWW-Authenticate'], /oauth-protected-resource/);
    let next = false;
    security.requireScope('read_file')({ identity: { scopes: ['files.*'] } }, response(), () => (next = true));
    assert.equal(next, true);
    const denied = response();
    security.requireScope('delete_user')(
      { identity: { scopes: ['files.*'] }, clientIP: '127.0.0.1' },
      denied,
      () => {}
    );
    assert.equal(denied.statusCode, 403);
    assert.equal(security.scopeAllows(['*'], 'anything'), true);
    assert.equal(security.scopeAllows(['get_system_info'], 'get_system_info'), true);
    assert.equal(security.scopeAllows([], 'get_system_info'), false);
  });

  it('trusts forwarded IP only from an explicit proxy and handles health middleware', () => {
    process.env.TRUST_PROXY = 'true';
    process.env.TRUSTED_PROXIES = '127.0.0.1/32';
    const req = request({ 'x-forwarded-for': '198.51.100.10, 127.0.0.1' });
    assert.equal(security.getClientIP(req), '198.51.100.10');
    req.socket.remoteAddress = '203.0.113.10';
    assert.equal(security.getClientIP(req), '203.0.113.10');
    const health = request();
    health.path = '/health';
    let next = false;
    security.ipWhitelist(health, response(), () => (next = true));
    assert.equal(next, true);
    assert.equal(health.clientIP, '127.0.0.1');
    assert.ok(security.getRoleTemplates().some(role => role.id === 'developer'));
  });
});
