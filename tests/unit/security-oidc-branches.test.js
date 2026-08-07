import "../test-env.js";
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('security.js OIDC remaining branches', async () => {
  let tmpDir;
  let originalFetch;

  before(async () => {
    originalFetch = global.fetch;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-security-oidc-branches-'));
    process.env.MCP_STATE_DB = path.join(tmpDir, 'state.sqlite3');

    process.env.JWT_SECRET = 's'.repeat(64);
    process.env.AUTHELIA_ISSUER = 'https://auth.example.com';
    process.env.AUTHELIA_JWKS_URL = 'https://auth.example.com/jwks';
    process.env.OAUTH_RESOURCE_URL = 'https://resource.example.com';

    let fetchCall = 0;
    global.fetch = async url => {
      fetchCall++;
      if (fetchCall === 1) return { ok: false, status: 500 };
      if (fetchCall === 2) return { ok: true, json: async () => ({ sub: 'sub-id' }) };
      if (fetchCall === 3) return { ok: true, json: async () => ({ sub: 'sub-id', email: 'test@example.com' }) };
      if (fetchCall === 4) return { ok: true, json: async () => ({ sub: 'sub-id', email: 'user2@example.com' }) };
    };

    let verifyCall = 0;
    mock.module('jose', {
      namedExports: {
        createRemoteJWKSet: () => ({ refreshed: false }),
        jwtVerify: async () => {
          verifyCall++;
          if (verifyCall === 1) throw new Error('First verify failed');
          return {
            payload: {
              exp: Math.floor(Date.now() / 1000) + 3600,
              iat: Math.floor(Date.now() / 1000),
              sub: 'sub-id',
              iss: 'https://auth.example.com',
              aud: 'https://resource.example.com',
              azp: 'client-id',
            },
            protectedHeader: { typ: 'JWT' },
          };
        },
      },
    });

    mock.module("../../lib/oauth-mappings-store.js", {
      namedExports: {
        readOAuthMappings: async () => ({
          'test@example.com': {
            role: 'admin',
            scopes: ['*'],
            clients: { 'client-id': { linuxUser: 'root', role: 'admin', scopes: ['*'] } },
          },
          'user2@example.com': {
            linuxUser: 'user2',
            role: 'viewer',
            scopes: ['*'],
            clients: { 'client-id': {} },
          },
        }),
      },
    });
  });

  after(() => {
    global.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    mock.restoreAll();
  });

  it('OIDC missing username and root mapping', async () => {
    const security = await import(`../../security.js?test=${Date.now()}`);

    const req = {
      headers: { authorization: 'Bearer authelia-token' },
      socket: { remoteAddress: '127.0.0.1' },
      protocol: 'http',
      get: () => 'localhost',
    };

    let capturedErr = null;
    let resolveTest;
    const res = {
      status: () => res,
      json: body => {
        capturedErr = body?.error;
        if (resolveTest) resolveTest();
        return res;
      },
      set: () => res,
      type: () => res,
    };

    const runTest = () =>
      new Promise(resolve => {
        capturedErr = null;
        resolveTest = resolve;
        security.authenticateJWT(req, res, () => {
          resolve();
        });
      });

    // 1. fetch ok is false
    await runTest();
    assert.equal(capturedErr, 'Invalid or expired token');

    // 2. preferred_username missing, email missing
    await runTest();
    assert.equal(capturedErr, 'Invalid or expired token');

    // 3. User mapping root
    await runTest();
    assert.equal(capturedErr, 'Invalid or expired token');

    // 4. clientMapping.linuxUser vs userMapping.linuxUser (line 598)
    await runTest();
    assert.equal(capturedErr, null);
    assert.equal(req.identity.userId, 'user2');
  });
});
