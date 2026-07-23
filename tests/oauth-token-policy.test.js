import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateOAuthTokenPolicy } from '../lib/oauth-token-policy.js';

const issuer = 'https://auth.example.test';
const resource = 'https://mcp.example.test';
const now = Math.floor(Date.now() / 1000);

function token(overrides = {}) {
  return {
    payload: {
      iss: issuer,
      sub: 'subject-1',
      aud: resource,
      exp: now + 300,
      iat: now,
      client_id: 'chatgpt',
      ...overrides,
    },
    protectedHeader: { alg: 'RS256', typ: 'at+jwt' },
    issuer,
    resource,
  };
}

describe('OAuth access-token policy', () => {
  it('binds a valid access token to the exact resource and authorized client', () => {
    assert.deepEqual(validateOAuthTokenPolicy(token()), {
      clientId: 'chatgpt',
      tokenType: 'at+jwt',
      audiences: [resource],
    });
    assert.equal(validateOAuthTokenPolicy(token({ client_id: undefined, azp: 'chatgpt' })).clientId, 'chatgpt');
  });

  it('rejects missing claims, ID tokens, wrong types, and non-canonical audiences', () => {
    for (const [overrides, header, pattern] of [
      [{ iss: 'https://wrong.example.test' }, undefined, /issuer/],
      [{ sub: '' }, undefined, /subject/],
      [{ exp: undefined }, undefined, /expiry/],
      [{ iat: undefined }, undefined, /issue time/],
      [{ aud: [resource, 'another-audience'] }, undefined, /exact canonical/],
      [{ nonce: 'id-token-nonce' }, undefined, /ID tokens/],
      [{ token_use: 'id' }, undefined, /token_use/],
      [{ client_id: undefined }, undefined, /client ID/],
      [{}, { alg: 'RS256', typ: 'id+jwt' }, /token type/],
      [{}, { alg: 'RS256' }, /token type/],
    ]) {
      const candidate = token(overrides);
      if (header) candidate.protectedHeader = header;
      assert.throws(() => validateOAuthTokenPolicy(candidate), pattern);
    }
  });
});
