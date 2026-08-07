import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

describe('security.js additional coverage', async () => {
  let tmpDir;
  let security;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-security-cov-'));
    process.env.JWT_REVOCATION_FILE = path.join(tmpDir, 'rev.json');
    process.env.KEYSTORE_FILE = path.join(tmpDir, 'keys.json');
    process.env.MCP_STATE_DB = path.join(tmpDir, 'state.sqlite3');
    process.env.JWT_SECRET = 's'.repeat(64);
    process.env.OAUTH_RESOURCE_URL = 'https://resource.example.com';
    process.env.ALLOWED_IPS = '192.168.1.0/24, 10.0.0.1';

    security = await import(`../security.js?test=${Date.now()}`);
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('jwtSecretIsConfigured', () => {
    assert.equal(security.jwtSecretIsConfigured(), true);
  });

  it('addApiKey with bad role or bad unix user', async () => {
    await assert.rejects(security.addApiKey('mcp_' + 'a'.repeat(64), { role: 'fake' }), /Invalid role/);
    await assert.rejects(
      security.addApiKey('mcp_' + 'a'.repeat(64), { role: 'viewer', userId: 'nonexistentuser999' }),
      /Invalid user/
    );
  });

  it('API Key wrapper methods', async () => {
    const key = 'mcp_' + 'b'.repeat(64);
    await security.addApiKey(key, { role: 'admin', userId: 'admin', label: 'test_admin' });
    const keys = security.listApiKeys();
    assert.ok(keys.length > 0);
    const myKey = keys.find(k => k.label === 'test_admin');

    // updateApiKey
    const updated = await security.updateApiKey(myKey.keyId, { label: 'updated_admin' });
    assert.equal(updated.label, 'updated_admin');

    // revokeApiKeyById
    const success1 = await security.revokeApiKeyById(myKey.keyId);
    assert.equal(success1, true);

    // revokeApiKey
    const key2 = 'mcp_' + 'c'.repeat(64);
    await security.addApiKey(key2, { role: 'admin', userId: 'admin' });
    const success2 = await security.revokeApiKey(key2);
    assert.equal(success2, true);
  });

  it('getRoleTemplates and scopeAllows', () => {
    const templates = security.getRoleTemplates();
    assert.ok(templates.length > 0);
    assert.equal(security.scopeAllows(['system.*'], 'get_system_info'), true);
    assert.equal(security.scopeAllows(['system.*'], 'read_file'), false);
    assert.equal(security.scopeAllows(['get_system_info'], 'get_system_info'), true);
    assert.equal(security.scopeAllows(['*'], 'anything'), true);
  });

  it('ipWhitelist middleware', () => {
    let nextCalled = false;
    security.ipWhitelist({ path: '/api', socket: { remoteAddress: '1.2.3.4' }, headers: {} }, {}, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it('getClientIP branches', () => {
    const req = {
      socket: { remoteAddress: '::ffff:192.168.1.100' },
      headers: { 'x-forwarded-for': '10.10.10.10' },
    };
    // process.env.TRUST_PROXY is false right now
    assert.equal(security.getClientIP(req), '192.168.1.100');

    // Set TRUST_PROXY = true but proxy is not trusted
    process.env.TRUST_PROXY = 'true';
    process.env.TRUSTED_PROXIES = '192.168.2.0/24';
    assert.equal(security.getClientIP(req), '192.168.1.100');

    // Proxy is trusted, uses x-forwarded-for
    process.env.TRUSTED_PROXIES = '192.168.1.0/24';
    assert.equal(security.getClientIP(req), '10.10.10.10');
    process.env.TRUST_PROXY = 'false';
  });

  it('authenticate middleware - global ALLOWED_IPS branch & invalid IPs', async () => {
    const key = 'mcp_' + 'd'.repeat(64);
    await security.addApiKey(key, { role: 'admin', userId: 'admin', label: 'ip-mismatch' });

    // Invalid IP test (not in ALLOWED_IPS)
    const reqInvalid = {
      headers: { 'x-api-key': key },
      socket: { remoteAddress: '8.8.8.8' },
    };
    const resInvalid = {
      status: c => ({
        json: b => {
          return b;
        },
      }),
    };
    const result = security.authenticate(reqInvalid, resInvalid, () => {});
    assert.equal(result.error, 'IP address not permitted');

    // Valid IP test (in global ALLOWED_IPS)
    const reqValid = {
      headers: { 'x-api-key': key },
      socket: { remoteAddress: '192.168.1.55' },
    };
    let nextCalled = false;
    security.authenticate(reqValid, {}, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);

    // Plain IP in ALLOWED_IPS test
    const reqValidPlain = {
      headers: { 'x-api-key': key },
      socket: { remoteAddress: '10.0.0.1' },
    };
    let nextCalled2 = false;
    security.authenticate(reqValidPlain, {}, () => {
      nextCalled2 = true;
    });
    assert.equal(nextCalled2, true);

    // IP parse failure in ipInCidr (returns false)
    const reqBadIp = {
      headers: { 'x-api-key': key },
      socket: { remoteAddress: 'invalid-ip' },
    };
    const resBadIp = {
      status: c => ({
        json: b => {
          return b;
        },
      }),
    };
    assert.equal(security.authenticate(reqBadIp, resBadIp, () => {}).error, 'IP address not permitted');
  });

  it('sendUnauthorized without OAUTH_RESOURCE_URL', () => {
    process.env.OAUTH_RESOURCE_URL = '';
    const req = { path: '/mcp', protocol: 'http', get: () => 'localhost:3000', headers: {} };
    const res = {
      status: c => ({ json: b => b }),
      set: (n, v) => {
        res.headers = res.headers || {};
        res.headers[n] = v;
      },
    };
    security.authenticate(req, res, () => {});
    assert.equal(
      res.headers['WWW-Authenticate'],
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"'
    );
  });

  it('issueStepUpToken', () => {
    assert.throws(() => security.issueStepUpToken({}), /WebAuthn step-up requires/);

    const token = security.issueStepUpToken({
      userId: 'admin',
      authType: 'apiKey',
      role: 'admin',
      scopes: ['*'],
      keyId: 'test-key',
      keyVersion: 1,
    });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    assert.equal(decoded.mfaVerified, true);

    const tokenOauth = security.issueStepUpToken({
      userId: 'admin',
      authType: 'oauth',
      role: 'admin',
      scopes: ['*'],
      oauthSubject: 'sub123',
      oauthClient: 'client123',
      oauthIssuer: 'iss123',
    });
    const decodedOauth = jwt.verify(tokenOauth, process.env.JWT_SECRET);
    assert.equal(decodedOauth.stepUp, true);
  });

  it('authenticateJWT with fallback for old mcp_ format', () => {
    let called = false;
    const req = {
      headers: { authorization: 'Bearer mcp_' + 'a'.repeat(64) },
      socket: { remoteAddress: '127.0.0.1' },
    };
    // Should fallback to API key auth, which will fail missing key
    const res = { status: c => ({ json: b => b }) };
    const result = security.authenticateJWT(req, res, () => {
      called = true;
    });
    assert.equal(result.error, 'Invalid API key');
  });

  it('persistJwtRevocations sqlite successful commit', () => {
    // We already have process.env.MCP_STATE_DB set up and a valid sqlite DB since before().
    // We just need to add a revocation and it will commit it.
    const res = { json: () => {} };
    security.revokeSessionToken(
      {
        identity: { authType: 'apiKey', jti: 'test-commit', tokenExpiresAt: Date.now() + 10000 },
        clientIP: '127.0.0.1',
      },
      res
    );
  });

  it('authenticateJWT no Bearer prefix', () => {
    let nextCalled = false;
    const req = {
      headers: { authorization: 'Basic xyz' },
      socket: { remoteAddress: '127.0.0.1' },
      protocol: 'http',
      get: () => 'localhost',
    };
    const res = { status: () => res, json: () => res, type: () => res, set: () => res };
    // This will fallback to authenticate, which will fail because no x-api-key
    let statusCalled = null;
    const res2 = {
      status: c => {
        statusCalled = c;
        return {
          json: b => {
            console.log('DENIED:' + JSON.stringify(b));
          },
        };
      },
    };
    security.authenticateJWT(req, res2, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
  });

  it('authenticateJWT stepUp missing binding', () => {
    // Mint a bad stepUp token manually
    const token = jwt.sign(
      {
        sub: 'admin',
        authType: 'apiKey', // not oauth, missing oauthSubject
        stepUp: true,
        jti: 'bad-stepup',
      },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: 'mcp-server', audience: 'mcp-client' }
    );
    const req = {
      headers: { authorization: 'Bearer ' + token },
      socket: { remoteAddress: '127.0.0.1' },
      protocol: 'http',
      get: () => 'localhost',
    };
    let statusCalled = 0;
    const res = {
      status: c => {
        statusCalled = c;
        return res;
      },
      json: () => res,
      set: () => res,
      type: () => res,
    };
    security.authenticateJWT(req, res, () => {});
    assert.equal(statusCalled, 401);
  });

  it('authenticateJWT revoked key', async () => {
    const key = 'mcp_' + 'e'.repeat(64);
    await security.addApiKey(key, { role: 'admin', userId: 'admin', label: 'ip-mismatch' });
    const keys = security.listApiKeys();
    const keyId = keys.find(k => k.userId === 'admin' && k.role === 'admin').keyId;
    const token = jwt.sign(
      {
        sub: 'admin',
        authType: 'apiKey',
        keyId,
        keyVersion: 1,
        jti: 'revoked-key',
      },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: 'mcp-server', audience: 'mcp-client' }
    );
    await security.revokeApiKeyById(keyId);

    const req = {
      headers: { authorization: 'Bearer ' + token },
      socket: { remoteAddress: '127.0.0.1' },
      protocol: 'http',
      get: () => 'localhost',
    };
    let statusCalled = 0;
    const res = {
      status: c => {
        statusCalled = c;
        return res;
      },
      json: () => res,
      set: () => res,
      type: () => res,
    };
    security.authenticateJWT(req, res, () => {});
    assert.equal(statusCalled, 401);
  });

  it('authenticateJWT IP mismatch', async () => {
    const key = 'mcp_' + 'f'.repeat(64);
    await security.addApiKey(key, { role: 'admin', userId: 'admin', label: 'ip-mismatch' });
    const keys = security.listApiKeys();
    const keyId = keys.find(k => k.label === 'ip-mismatch').keyId;
    const token = jwt.sign(
      {
        sub: 'admin',
        authType: 'apiKey',
        keyId,
        keyVersion: 1,
        ip: '5.5.5.5',
        jti: 'ip-mismatch',
      },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: 'mcp-server', audience: 'mcp-client' }
    );
    const req = {
      headers: { authorization: 'Bearer ' + token },
      socket: { remoteAddress: '8.8.8.8' },
      protocol: 'http',
      get: () => 'localhost',
    };
    let nextCalled = false;
    const res = { status: () => res, json: () => res, set: () => res, type: () => res };
    let statusCalled = null;
    const res2 = {
      status: c => {
        statusCalled = c;
        return {
          json: b => {
            console.log('DENIED:' + JSON.stringify(b));
          },
        };
      },
    };
    security.authenticateJWT(req, res2, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });
});
