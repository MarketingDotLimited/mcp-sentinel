import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SECURITY_JS = path.join(__dirname, '../security.js');

test('security.js branches - separate processes for env vars', () => {
  // Test USE_LEGACY_REVOCATIONS = true
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import fs from 'fs';
      import os from 'os';
      import path from 'path';
      const tmp = os.tmpdir();
      const revFile = path.join(tmp, 'test-revocations.json');
      fs.writeFileSync(revFile, JSON.stringify({
        revocations: [
          { jti: 'test1', expiresAt: Date.now() + 10000 },
          { jti: 'test2', expiresAt: Date.now() - 10000 },
          { jti: 123, expiresAt: Date.now() + 10000 }
        ]
      }));
      process.env.JWT_REVOCATION_FILE = revFile;
      delete process.env.MCP_STATE_DB;
      const sec = await import(${JSON.stringify('file://' + SECURITY_JS)});
      // Need a public exported function that might hit persistJwtRevocations, e.g. revokeSessionToken?
      // Wait, revokeSessionToken calls revokeJwt which calls persistJwtRevocations.
      const req = { identity: { authType: 'apiKey', jti: 'test1' } };
      sec.revokeSessionToken(req, { json: () => {} });
      // Add a token that is already expired to trigger expiresAt <= now deletion in persist
      const req2 = { identity: { authType: 'apiKey', jti: 'test2' } };
      sec.revokeSessionToken(req2, { json: () => {} });
      const orig = Date.now;
      Date.now = () => orig() + 86400000;
      sec.revokeSessionToken({ identity: { authType: 'apiKey', jti: 'test3' } }, { json: () => {} });
      Date.now = orig;
    `
  ]);

  // Test USE_LEGACY_REVOCATIONS = true with ENOENT and empty JSON
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import fs from 'fs';
      process.env.JWT_REVOCATION_FILE = '/tmp/does-not-exist-revoc.json';
      delete process.env.MCP_STATE_DB;
      await import(${JSON.stringify('file://' + SECURITY_JS)});
      
      fs.writeFileSync('/tmp/empty-revoc.json', '{}');
      process.env.JWT_REVOCATION_FILE = '/tmp/empty-revoc.json';
      await import(${JSON.stringify('file://' + SECURITY_JS + '?test=1')});
    `
  ]);

  // Test AUTHELIA_JWKS_URL empty actually calling getAutheliaJWKS
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      process.env.AUTHELIA_JWKS_URL = '';
      process.env.AUTHELIA_ISSUER = 'https://auth';
      const sec = await import(${JSON.stringify('file://' + SECURITY_JS)});
      await sec.authenticateJWT({ headers: { authorization: 'Bearer authelia-token' } }, { status: () => ({ json: () => {} }) }, () => {});
    `
  ]);
});
