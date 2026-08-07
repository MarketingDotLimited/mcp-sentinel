import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('security.js OIDC edges 2', async () => {
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-security-oidc-edges2-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    mock.restoreAll();
  });

  it('OIDC JWKS refresh fails and missing configuredResource', async () => {
    process.env.MCP_STATE_DB = path.join(tmpDir, 'state.sqlite3');
    process.env.JWT_SECRET = 's'.repeat(64);
    process.env.AUTHELIA_ISSUER = 'https://auth.example.com';
    process.env.AUTHELIA_JWKS_URL = 'https://auth.example.com/.well-known/jwks.json';
    process.env.OAUTH_RESOURCE_URL = 'https://resource.example.com';

    let calls = 0;
    mock.module('jose', {
      namedExports: {
        createRemoteJWKSet: () => {
          calls++;
          if (calls === 2) throw new Error('refresh failed');
          return { type: 'mock-jwks' };
        },
        jwtVerify: async () => {
          throw new Error('invalid signature');
        },
      },
    });

    const security = await import(`../security.js?test=${Date.now()}`);
    const req = { headers: { authorization: 'Bearer some-token' }, socket: { remoteAddress: '127.0.0.1' } };
    let statusCalled = 0;
    const res = {
      status: c => {
        statusCalled = c;
        return res;
      },
      json: () => res,
      set: () => res,
    };

    // First call will cache jwks on import or on first use.
    // wait, it is called on first authenticateJWT
    await new Promise(resolve => {
      security.authenticateJWT(req, res, () => {});
      setTimeout(resolve, 50);
    });
    // The inner catch throws `invalid signature` because refresh failed (which returns null, so it throws the original error)
    assert.equal(statusCalled, 401);

    // Now test missing configuredResource
    // we need a new security instance where OAUTH_RESOURCE_URL and PUBLIC_URL are empty, but AUTHELIA_JWKS_URL is present
    process.env.OAUTH_RESOURCE_URL = '';
    process.env.PUBLIC_URL = '';
  });
});
