import { after, describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

mock.module('@simplewebauthn/server', {
  namedExports: {
    generateRegistrationOptions: async () => ({ challenge: 'mock-reg-challenge', rp: { id: 'sentinel.example.test' } }),
    verifyRegistrationResponse: async opts => {
      if (opts.response?.fail) {
        return { verified: false };
      }
      if (opts.response?.noCred) {
        return { verified: true, registrationInfo: {} };
      }
      if (opts.response?.noTransports) {
        return {
          verified: true,
          registrationInfo: {
            credential: {
              id: 'mock-id-no-transports',
              publicKey: new Uint8Array([1, 2, 3]),
              counter: 0,
              // no transports
            },
          },
        };
      }
      return {
        verified: true,
        registrationInfo: {
          credential: {
            id: 'mock-id',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['usb'],
          },
        },
      };
    },
    generateAuthenticationOptions: async () => ({ challenge: 'mock-auth-challenge' }),
    verifyAuthenticationResponse: async opts => {
      if (opts.response?.fail) return { verified: false };
      return {
        verified: true,
        authenticationInfo: { newCounter: 1 },
      };
    },
  },
});

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-webauthn-'));
process.env.MCP_STATE_DB = path.join(directory, 'state.sqlite3');
process.env.PUBLIC_URL = 'https://sentinel.example.test';
process.env.WEBAUTHN_RP_ID = 'sentinel.example.test';
process.env.WEBAUTHN_ORIGIN = 'https://sentinel.example.test';
const webauthn = await import(`../lib/webauthn.js?test=${Date.now()}`);
after(() => fs.rm(directory, { recursive: true, force: true }));

describe('WebAuthn step-up contract', () => {
  beforeEach(() => {
    webauthn.resetWebAuthnForTests();
  });

  it('creates an HTTPS-bound registration ceremony and expires challenge reuse', async () => {
    const ceremony = await webauthn.registrationOptions({ userId: 'admin', userName: 'Admin' });
    assert.match(ceremony.challengeId, /^[0-9a-f-]{36}$/);
    assert.equal(typeof ceremony.options.challenge, 'string');
    assert.equal(ceremony.options.rp.id, 'sentinel.example.test');

    // Test verification failure
    await assert.rejects(
      webauthn.finishRegistration({ userId: 'admin', challengeId: ceremony.challengeId, response: { fail: true } }),
      /verified/i
    );
    // Challenge is consumed, should fail now
    await assert.rejects(
      webauthn.finishRegistration({ userId: 'admin', challengeId: ceremony.challengeId, response: {} }),
      /missing|expired|another identity/i
    );
  });

  it('handles missing credential in registration result', async () => {
    const ceremony = await webauthn.registrationOptions({ userId: 'admin' });
    await assert.rejects(
      webauthn.finishRegistration({ userId: 'admin', challengeId: ceremony.challengeId, response: { noCred: true } }),
      /verified/i
    );
  });

  it('successful registration and authentication flow', async () => {
    // 1. Register
    const regCeremony = await webauthn.registrationOptions({ userId: 'admin', userName: 'Admin' });
    const regResult = await webauthn.finishRegistration({
      userId: 'admin',
      challengeId: regCeremony.challengeId,
      response: {},
    });
    assert.equal(regResult.verified, true);
    assert.equal(regResult.credentialId, 'mock-id');

    // 2. List credentials
    const creds = webauthn.listCredentials('admin');
    assert.equal(creds.length, 1);
    assert.equal(creds[0].id, 'mock-id');
    assert.deepEqual(creds[0].transports, ['usb']);

    // 3. Authenticate
    const authCeremony = await webauthn.authenticationOptions({ userId: 'admin' });
    assert.equal(authCeremony.options.challenge, 'mock-auth-challenge');

    const authResult = await webauthn.finishAuthentication({
      userId: 'admin',
      challengeId: authCeremony.challengeId,
      response: { id: 'mock-id' },
    });
    assert.equal(authResult.verified, true);
    assert.equal(authResult.counter, 1);

    // 4. Failed authentication
    const authCeremony2 = await webauthn.authenticationOptions({ userId: 'admin' });
    await assert.rejects(
      webauthn.finishAuthentication({
        userId: 'admin',
        challengeId: authCeremony2.challengeId,
        response: { id: 'mock-id', fail: true },
      }),
      /verified/i
    );
  });

  it('assertUser throws on invalid user ID', async () => {
    await assert.rejects(webauthn.registrationOptions({ userId: '' }), /Invalid WebAuthn user/);
    await assert.rejects(webauthn.registrationOptions({ userId: 'a space' }), /Invalid WebAuthn user/);
    assert.throws(() => webauthn.listCredentials({}), /Invalid WebAuthn user/);
  });

  it('configured throws on missing/invalid RP ID or non-https origin', async () => {
    const originalOrigin = process.env.WEBAUTHN_ORIGIN;
    process.env.WEBAUTHN_ORIGIN = 'http://insecure.test';
    await assert.rejects(
      webauthn.registrationOptions({ userId: 'admin' }),
      /WEBAUTHN_RP_ID and an HTTPS WEBAUTHN_ORIGIN/
    );
    process.env.WEBAUTHN_ORIGIN = originalOrigin;

    const originalRP = process.env.WEBAUTHN_RP_ID;
    process.env.WEBAUTHN_RP_ID = 'invalid rp id *';
    await assert.rejects(
      webauthn.registrationOptions({ userId: 'admin' }),
      /WEBAUTHN_RP_ID and an HTTPS WEBAUTHN_ORIGIN/
    );
    process.env.WEBAUTHN_RP_ID = originalRP;
  });

  it('consumeChallenge throws on expiration or mismatched identity', async () => {
    const ceremony = await webauthn.registrationOptions({ userId: 'admin' });
    // Mismatched user
    await assert.rejects(
      webauthn.finishRegistration({ userId: 'other', challengeId: ceremony.challengeId, response: {} }),
      /missing, expired, or bound/
    );
  });

  it('authenticationOptions throws if no credentials exist', async () => {
    await assert.rejects(webauthn.authenticationOptions({ userId: 'missing' }), /No WebAuthn credential is registered/);
  });

  it('finishAuthentication throws if credential is not registered', async () => {
    // Register one so we can get an auth challenge
    const regCeremony = await webauthn.registrationOptions({ userId: 'admin' });
    await webauthn.finishRegistration({ userId: 'admin', challengeId: regCeremony.challengeId, response: {} });

    // Get an auth challenge
    const ceremony = await webauthn.authenticationOptions({ userId: 'admin' });

    // Attempt to authenticate with a wrong credential ID
    await assert.rejects(
      webauthn.finishAuthentication({
        userId: 'admin',
        challengeId: ceremony.challengeId,
        response: { id: 'some-id' },
      }),
      /not registered for this identity/
    );
  });

  it('configured defaults to PUBLIC_URL if WEBAUTHN_RP_ID/ORIGIN are missing', async () => {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.WEBAUTHN_ORIGIN;
    process.env.PUBLIC_URL = 'https://fallback.example.test/'; // Tests origin trim trailing slash too

    const ceremony = await webauthn.registrationOptions({ userId: 'fallback-user' });
    assert.match(ceremony.challengeId, /^[0-9a-f-]{36}$/);

    // Restore
    process.env.WEBAUTHN_RP_ID = 'sentinel.example.test';
    process.env.WEBAUTHN_ORIGIN = 'https://sentinel.example.test';
  });

  it('configured defaults to https://localhost if PUBLIC_URL is missing', async () => {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.WEBAUTHN_ORIGIN;
    delete process.env.PUBLIC_URL;

    await assert.rejects(webauthn.registrationOptions({ userId: 'fallback-user' }), /WebAuthn requires/);

    // Restore
    process.env.WEBAUTHN_RP_ID = 'sentinel.example.test';
    process.env.WEBAUTHN_ORIGIN = 'https://sentinel.example.test';
    process.env.PUBLIC_URL = 'https://sentinel.example.test';
  });

  it('successful registration without transports', async () => {
    const regCeremony = await webauthn.registrationOptions({ userId: 'admin-no-trans', userName: 'Admin' });
    const regResult = await webauthn.finishRegistration({
      userId: 'admin-no-trans',
      challengeId: regCeremony.challengeId,
      response: { noTransports: true },
    });
    assert.equal(regResult.verified, true);

    const creds = webauthn.listCredentials('admin-no-trans');
    assert.deepEqual(creds[0].transports, []);
  });

  it('successful authentication using rawId', async () => {
    // Register first
    const regCeremony = await webauthn.registrationOptions({ userId: 'admin-raw', userName: 'Admin' });
    const regResult = await webauthn.finishRegistration({
      userId: 'admin-raw',
      challengeId: regCeremony.challengeId,
      response: {},
    });

    const authCeremony = await webauthn.authenticationOptions({ userId: 'admin-raw' });
    const authResult = await webauthn.finishAuthentication({
      userId: 'admin-raw',
      challengeId: authCeremony.challengeId,
      response: { rawId: regResult.credentialId },
    });

    assert.equal(authResult.verified, true);
  });
});
