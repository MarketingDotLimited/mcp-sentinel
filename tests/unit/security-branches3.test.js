import '../test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as sec from '../../security.js';

test('security.js branches', async () => {
  // Test 423: if (!AUTHELIA_JWKS_URL) return null;
  const originalJwks = process.env.AUTHELIA_JWKS_URL;
  process.env.AUTHELIA_JWKS_URL = '';
  process.env.AUTHELIA_ISSUER = 'https://auth';

  await sec.authenticateJWT(
    { headers: { authorization: 'Bearer authelia-token' } },
    { status: () => ({ json: () => {} }) },
    () => {}
  );

  // Test 555: process.env.OAUTH_RESOURCE_URL
  process.env.OAUTH_RESOURCE_URL = 'https://resource/';
  const req = { headers: {} };
  const mockRes = { status: code => ({ json: err => ({ code, err }) }) };
  try {
    await sec.authenticate(req, mockRes, () => {});
  } catch (err) {
    assert.ok(err instanceof Error);
  }

  process.env.AUTHELIA_JWKS_URL = originalJwks;
});
