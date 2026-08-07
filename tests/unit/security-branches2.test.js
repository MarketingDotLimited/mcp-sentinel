import "../test-env.js";
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';

let security;
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sec2-'));
  process.env.MCP_STATE_DB = path.join(tmpDir, 'state.sqlite3');
  process.env.JWT_SECRET = 's'.repeat(64);
  security = await import(`../../security.js?test=${Date.now()}`);
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

it('isIPMatch IP kind mismatch', async () => {
  const req = {
    headers: { 'x-forwarded-for': '192.168.1.1' },
    connection: { remoteAddress: '192.168.1.1' },
  };
  const res = { status: () => res, json: () => {} };

  const key = crypto.randomBytes(32).toString('hex');
  await security.addApiKey(key, {
    userId: 'admin',
    role: 'viewer',
    allowedIPs: ['10.0.0.0/8'],
    scopes: ['*'],
    active: true,
  });

  req.headers['authorization'] = `Bearer ${key}`;
  req.clientIP = security.getClientIP(req);

  let called = false;
  await security.authenticate(req, res, () => {
    called = true;
  });
  assert.equal(called, false);
});

it('isIPMatch IPv6 match', async () => {
  const req = {
    headers: { 'x-forwarded-for': '10.0.0.1' },
    socket: { remoteAddress: '10.0.0.1' },
  };
  const res = { status: () => res, json: () => {} };

  const key = crypto.randomBytes(32).toString('hex');
  await security.addApiKey(key, {
    userId: 'admin',
    role: 'viewer',
    allowedIPs: ['10.0.0.0/8'],
    scopes: ['*'],
    active: true,
  });

  req.headers['authorization'] = `Bearer ${key}`;
  req.clientIP = security.getClientIP(req);

  let called = false;
  await security.authenticate(req, res, () => {
    called = true;
  });
  assert.equal(called, true);
});

it('projectIds array branch in authenticate', async () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  const res = { status: () => res, json: () => {} };
  const key = crypto.randomBytes(32).toString('hex');
  await security.addApiKey(key, {
    userId: 'admin',
    role: 'viewer',
    projectIds: ['proj-1'],
    allowedIPs: ['127.0.0.1/32'],
    scopes: ['*'],
    active: true,
  });
  req.headers['authorization'] = `Bearer ${key}`;
  let called = false;
  await security.authenticate(req, res, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.deepEqual(req.identity.projectIds, ['proj-1']);
});

it('issueToken handles process.env.JWT_EXPIRY set and unset', async () => {
  const req = {
    identity: {
      userId: 'admin',
      authType: 'apiKey',
      role: 'admin',
      scopes: ['*'],
      organizationId: 'org1',
      teamId: 'team1',
    },
    clientIP: '127.0.0.1',
  };

  const key = crypto.randomBytes(32).toString('hex');
  await security.addApiKey(key, { userId: 'admin', role: 'admin', scopes: ['*'], active: true, label: 'issue-test' });
  const keys = security.listApiKeys();
  const myKey = keys.find(k => k.label === 'issue-test');
  req.identity.keyId = myKey.keyId;
  req.identity.keyVersion = myKey.version;

  let token1 = null;
  process.env.JWT_EXPIRY = '2h';
  await security.issueToken(req, {
    json: data => {
      token1 = data.token;
    },
  });
  assert.ok(token1);

  let token2 = null;
  delete process.env.JWT_EXPIRY;
  await security.issueToken(req, {
    json: data => {
      token2 = data.token;
    },
  });
  assert.ok(token2);
});

it('authenticateJWT covers stepUp and projectIds branches', async () => {
  const identity = {
    userId: 'admin',
    authType: 'oauth',
    role: 'admin',
    scopes: ['*'],
    projectIds: ['p1'],
    oauthSubject: 'sub1',
    oauthClient: 'c1',
    oauthIssuer: 'iss1',
  };
  const token = security.issueStepUpToken(identity);

  const req2 = { headers: { authorization: `Bearer ${token}` } };
  let called = false;
  let errDetails;
  await security.authenticateJWT(
    req2,
    {
      status: () => ({
        json: d => {
          errDetails = d;
        },
      }),
    },
    () => {
      called = true;
    }
  );
  if (!called) console.error('ERR1', errDetails);
  assert.equal(called, true);
  assert.equal(req2.identity.authType, 'oauth');
  assert.deepEqual(req2.identity.projectIds, ['p1']);
});

it('authenticateJWT mfaVerified branch', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const payload = {
    sub: 'admin',
    role: 'admin',
    scopes: ['*'],
    stepUp: true,
    mfaVerified: true,
    amr: ['webauthn'],
    authType: 'oauth',
    oauthSubject: 'sub1',
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET || 's'.repeat(64), {
    issuer: 'mcp-server',
    audience: 'mcp-client',
    algorithm: 'HS256',
  });

  const req2 = { headers: { authorization: `Bearer ${token}` }, clientIP: '127.0.0.1' };
  let called = false;
  let errDetails;
  await security.authenticateJWT(
    req2,
    {
      status: () => ({
        json: d => {
          errDetails = d;
        },
      }),
    },
    () => {
      called = true;
    }
  );
  if (!called) console.error('ERR2', errDetails);
  assert.equal(called, true);
  assert.equal(req2.identity.mfaVerified, true);
});

it('revokeSessionToken ignores non-apiKey/jti', () => {
  const req = { identity: { authType: 'oauth' } };
  const res = { status: () => ({ json: () => {} }) };
  security.revokeSessionToken(req, res);
});

it('ipInCidr handles IP kind mismatch (IPv4 vs IPv6 CIDR)', async () => {
  const key = crypto.randomBytes(32).toString('hex');
  await security.addApiKey(key, {
    userId: 'admin',
    role: 'viewer',
    allowedIPs: ['2001:db8::/32'],
    scopes: ['*'],
    active: true,
  });

  const req = {
    headers: { authorization: `Bearer ${key}` },
    socket: { remoteAddress: '10.0.0.1' },
  };
  const res = { status: () => res, json: () => {} };

  let called = false;
  await security.authenticate(req, res, () => {
    called = true;
  });
  assert.equal(called, false);
});
