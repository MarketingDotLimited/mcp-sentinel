import "../test-env.js";
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('security.js OIDC edges', async () => {
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-security-oidc-edges-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    mock.restoreAll();
  });

  it('OIDC JWKS unavailable (createRemoteJWKSet throws)', async () => {
    process.env.MCP_STATE_DB = path.join(tmpDir, 'state.sqlite3');
    process.env.JWT_SECRET = 's'.repeat(64);
    process.env.AUTHELIA_ISSUER = 'https://auth.example.com';
    process.env.AUTHELIA_JWKS_URL = 'https://auth.example.com/.well-known/jwks.json';
    process.env.OAUTH_RESOURCE_URL = 'https://resource.example.com';

    mock.module('jose', {
      namedExports: {
        createRemoteJWKSet: () => {
          throw new Error('jwks unreachable');
        },
        jwtVerify: async () => {},
      },
    });

    const security = await import(`../../security.js?test=${Date.now()}`);
    const req = {
      headers: { authorization: 'Bearer some-token' },
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

    await new Promise(resolve => {
      security.authenticateJWT(req, res, () => {});
      setTimeout(resolve, 50);
    });

    assert.equal(statusCalled, 401);
  });
});
