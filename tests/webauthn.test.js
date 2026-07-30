import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-webauthn-'));
process.env.MCP_STATE_DB = path.join(directory, 'state.sqlite3');
process.env.PUBLIC_URL = 'https://sentinel.example.test';
process.env.WEBAUTHN_RP_ID = 'sentinel.example.test';
process.env.WEBAUTHN_ORIGIN = 'https://sentinel.example.test';
const webauthn = await import(`../lib/webauthn.js?test=${Date.now()}`);
after(() => fs.rm(directory, { recursive: true, force: true }));

describe('WebAuthn step-up contract', () => {
  it('creates an HTTPS-bound registration ceremony and expires challenge reuse', async () => {
    const ceremony = await webauthn.registrationOptions({ userId: 'admin', userName: 'Admin' });
    assert.match(ceremony.challengeId, /^[0-9a-f-]{36}$/);
    assert.equal(typeof ceremony.options.challenge, 'string');
    assert.equal(ceremony.options.rp.id, 'sentinel.example.test');
    await assert.rejects(
      webauthn.finishRegistration({ userId: 'admin', challengeId: ceremony.challengeId, response: {} }),
      /verified|response|invalid|credential/i
    );
    await assert.rejects(
      webauthn.finishRegistration({ userId: 'admin', challengeId: ceremony.challengeId, response: {} }),
      /missing|expired|another identity/i
    );
  });

  it('does not expose credential public keys in credential listings', () => {
    assert.deepEqual(webauthn.listCredentials('admin'), []);
  });
});
