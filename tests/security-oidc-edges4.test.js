import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('security.js OIDC edges 4', async () => {
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-security-oidc-edges4-'));
    process.env.MCP_STATE_DB = path.join(tmpDir, 'state.sqlite3');
    process.env.AUTHELIA_MAPPINGS_FILE = path.join(tmpDir, 'mappings.json');
    fs.writeFileSync(process.env.AUTHELIA_MAPPINGS_FILE, JSON.stringify({ test: { scopes: ['*'], role: 'admin', clients: { 'client-id': { linuxUser: 'myuser', scopes: ['*'], role: 'admin' } } } }));
    process.env.JWT_SECRET = 's'.repeat(64);
    process.env.AUTHELIA_ISSUER = 'https://auth.example.com';
    process.env.AUTHELIA_JWKS_URL = 'https://auth.example.com/jwks';
    
    // OAUTH_RESOURCE_URL is NOT set, PUBLIC_URL IS set
    delete process.env.OAUTH_RESOURCE_URL;
    process.env.PUBLIC_URL = 'https://public.example.com';

    mock.module('jose', {
      namedExports: {
        createRemoteJWKSet: () => ({ refreshed: false }),
        jwtVerify: async () => {
          return {
            payload: { exp: Math.floor(Date.now()/1000) + 3600, iat: Math.floor(Date.now()/1000), sub: 'sub-id', iss: 'https://auth.example.com', aud: 'https://public.example.com', azp: 'client-id', preferred_username: 'test' },
            protectedHeader: { typ: 'jwt' }
          };
        }
      }
    });
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    mock.restoreAll();
  });

  it('OIDC PUBLIC_URL fallback', async () => {
    const security = await import(`../security.js?test=${Date.now()}`);
    
    const req = { headers: { authorization: 'Bearer token' }, socket: { remoteAddress: '127.0.0.1' } };
    let nextCalled = false;
    const res = { status: () => res, json: (body) => { console.log(body); return res; }, set: () => res };
    await new Promise(resolve => {
       security.authenticateJWT(req, res, () => { nextCalled = true; resolve(); });
       setTimeout(resolve, 50);
    });
    assert.equal(nextCalled, true);
  });
});
