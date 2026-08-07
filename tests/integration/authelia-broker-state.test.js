import "../test-env.js";
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import * as yaml from 'js-yaml';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-authelia-state-'));
const bin = path.join(directory, 'bin');
const usersFile = path.join(directory, 'users.yml');
const configFile = path.join(directory, 'authelia.yml');
const mappingsFile = path.join(directory, 'mappings.json');
const databaseFile = path.join(directory, 'state.sqlite3');
await fs.mkdir(bin);
await fs.writeFile(usersFile, 'users: {}\n', { mode: 0o600 });
await fs.writeFile(configFile, 'identity_providers:\n  oidc:\n    clients: []\n', { mode: 0o600 });
await fs.writeFile(mappingsFile, '{}\n', { mode: 0o600 });
const fake = path.join(bin, 'fake');
await fs.writeFile(
  fake,
  `#!/usr/bin/env node
const name = process.argv[1].split('/').pop();
const args = process.argv.slice(2);
if (process.env.FAKE_AUTHELIA_COMMAND_FAIL === 'true') process.exit(1);
if (name === 'authelia') process.stdout.write(process.env.FAKE_AUTHELIA_BAD_DIGEST === 'true' ? 'invalid\\n' : 'Digest: $argon2id$v=19$m=65536,t=3,p=4$ZmFrZXNhbHQ$ZmFrZWRpZ2VzdA\\n');
else if (name === 'systemctl' && process.env.FAKE_SYSTEMCTL_FAIL === 'true') process.exit(1);
else if (name === 'systemctl' && args[0] === 'is-active') process.stdout.write(process.env.FAKE_SYSTEMCTL_INACTIVE === 'true' ? 'inactive\\n' : 'active\\n');
else if (name === 'systemctl' && args[0] === 'show') process.stdout.write('ActiveEnterTimestamp=Wed 2026-01-01 00:00:00 UTC\\n');
`,
  { mode: 0o755 }
);
for (const name of ['authelia', 'systemctl']) await fs.symlink(fake, path.join(bin, name));
process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.MCP_STATE_DB = databaseFile;
process.env.AUTHELIA_USERS_FILE = usersFile;
process.env.AUTHELIA_CONFIG_FILE = configFile;
process.env.AUTHELIA_MAPPINGS_FILE = mappingsFile;
process.env.AUTHELIA_BACKUP_DIR = path.join(directory, 'backups');
process.env.AUTHELIA_ISSUER = 'https://auth.example.test';
process.env.AUTHELIA_JWKS_URL = 'https://auth.example.test/jwks.json';
process.env.OAUTH_RESOURCE_URL = 'https://mcp.example.test';
process.env.AUTHELIA_RESTART_SETTLE_MS = '0';
const authelia = await import(`../../lib/authelia.js?test=${Date.now()}`);

after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('typed Authelia administration state', () => {
  it('creates, updates, lists, and deletes least-privileged mapped users', async () => {
    const created = await authelia.addOAuthUser({
      username: 'developer',
      password: 'correct horse battery staple',
      email: 'developer@example.test',
      groups: ['developers'],
      role: 'developer',
      scopes: ['files.*', 'projects.*'],
      requireApproval: true,
      projectIds: ['11111111-1111-4111-8111-111111111111'],
      clients: {
        chatgpt: {
          role: 'developer',
          scopes: ['files.*', 'projects.*'],
          requireApproval: true,
          projectIds: ['11111111-1111-4111-8111-111111111111'],
        },
      },
    });
    assert.equal(created.role, 'developer');
    assert.equal(created.requireApproval, true);
    assert.equal(created.clients.chatgpt.role, 'developer');
    assert.deepEqual(created.clients.chatgpt.scopes, ['files.*', 'projects.*']);
    assert.equal(
      (await authelia.getOAuthUsers()).find(user => user.username === 'developer').clients.chatgpt.requireApproval,
      true
    );
    assert.equal((await authelia.getOAuthUsers())[0].projectIds.length, 1);
    await authelia.updateOAuthUser('developer', { email: 'new@example.test', scopes: ['files.*'] });
    const updated = (await authelia.getOAuthUsers())[0];
    assert.equal(updated.email, 'new@example.test');
    assert.deepEqual(updated.scopes, ['files.*']);
    const state = new DatabaseSync(databaseFile, { readOnly: true });
    assert.equal(state.prepare('SELECT COUNT(*) AS count FROM oauth_mappings').get().count, 1);
    state.close();
    await authelia.deleteOAuthUser('developer');
    assert.equal((await authelia.getOAuthUsers()).length, 0);
  });

  it('defaults administrative mappings to no approval unless explicitly enabled', async () => {
    await authelia.addOAuthUser({
      username: 'admin-oauth-no-approval',
      password: 'correct horse battery staple',
      email: 'admin-oauth@example.test',
      role: 'admin',
      scopes: ['*'],
    });
    const users = await authelia.getOAuthUsers();
    const adminUser = users.find(user => user.username === 'admin-oauth-no-approval');
    assert.equal(adminUser?.role, 'admin');
    assert.equal(adminUser?.requireApproval, false);
    await authelia.deleteOAuthUser('admin-oauth-no-approval');
  });

  it('creates PKCE S256 clients, returns the secret once, and removes them', async () => {
    const client = await authelia.addOAuthClient({
      clientId: 'chatgpt-test',
      clientName: 'ChatGPT Test',
      redirectUris: ['https://chatgpt.com/aip/g-test/oauth/callback'],
    });
    assert.ok(client.client_secret.length >= 32);
    const persisted = await fs.readFile(configFile, 'utf8');
    assert.match(persisted, /require_pkce: true/);
    assert.match(persisted, /pkce_challenge_method: S256/);
    assert.ok(!persisted.includes(client.client_secret));
    assert.equal((await authelia.getOAuthClients()).length, 1);
    const health = await authelia.getAutheliaHealth();
    assert.equal(health.status, 'active');
    assert.equal(health.totalClients, 1);
    await authelia.deleteOAuthClient('chatgpt-test');
    assert.equal((await authelia.getOAuthClients()).length, 0);
  });

  it('preserves the credential-backed OIDC signing-key template during client mutations', async () => {
    const signingTemplate =
      '{{ secret "/run/credentials/authelia.service/oidc-private-key" | mindent 10 "|" | msquote }}';
    await fs.writeFile(
      configFile,
      `identity_providers:\n  oidc:\n    jwks:\n      - key: ${signingTemplate}\n    clients: []\n`,
      { mode: 0o600 }
    );

    assert.deepEqual(await authelia.getOAuthClients(), []);
    await authelia.addOAuthClient({
      clientId: 'templated-client',
      redirectUris: ['https://example.test/callback'],
    });
    assert.match(
      await fs.readFile(configFile, 'utf8'),
      new RegExp(`key: ${signingTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );
    await authelia.deleteOAuthClient('templated-client');
    assert.match(await fs.readFile(configFile, 'utf8'), /key: \{\{ secret .* \| msquote \}\}/);
  });

  it('rejects unsafe redirects and deletion of protected identities', async () => {
    await assert.rejects(
      authelia.addOAuthClient({ clientId: 'unsafe', redirectUris: ['http://example.test/callback'] }),
      /redirectUris/
    );
    await assert.rejects(authelia.deleteOAuthUser('admin'), /Cannot delete/);
    await assert.rejects(authelia.deleteOAuthClient('chatgpt'), /Cannot delete/);
  });

  it('validates complete user and client-specific authorization before changing files', async () => {
    const original = await fs.readFile(usersFile, 'utf8');
    const base = { username: 'candidate', password: 'a secure password', email: 'candidate@example.test' };
    const invalid = [
      [{ ...base, role: 'owner' }, /role/],
      [{ ...base, scopes: ['valid', 'not allowed!'] }, /scopes/],
      [{ ...base, role: 'developer', scopes: ['*'] }, /Wildcard OAuth scope/],
      [{ ...base, projectIds: ['not-a-uuid'] }, /project assignments/],
      [{ ...base, requireApproval: 'yes' }, /approval setting/],
      [{ ...base, linuxUser: 'root' }, /Linux user/],
      [{ ...base, organizationId: 'invalid' }, /organization/],
      [{ ...base, teamId: 'invalid' }, /team/],
      [{ ...base, authorizationVersion: 0 }, /authorization version/],
      [{ ...base, clients: [] }, /client overrides/],
      [{ ...base, clients: { 'x!': {} } }, /override ID/],
      [{ ...base, clients: { chatgpt: [] } }, /client override/],
      [{ ...base, clients: { chatgpt: { unknown: true } } }, /unknown field/],
      [{ ...base, clients: { chatgpt: { linuxUser: 'root' } } }, /directly to root/],
      [{ ...base, clients: { chatgpt: { role: 'owner' } } }, /override role/],
      [{ ...base, clients: { chatgpt: { scopes: 'files.*' } } }, /override scopes/],
      [{ ...base, clients: { chatgpt: { projectIds: ['invalid'] } } }, /project assignments/],
      [{ ...base, clients: { chatgpt: { requireApproval: 'yes' } } }, /approval setting/],
      [{ ...base, clients: { chatgpt: { authorizationVersion: 0 } } }, /authorization version/],
    ];
    for (const [input, message] of invalid) await assert.rejects(authelia.addOAuthUser(input), message);
    assert.equal(await fs.readFile(usersFile, 'utf8'), original);
  });

  it('rejects malformed user records, missing identities, and hash failures', async () => {
    await assert.rejects(authelia.addOAuthUser({}), /required/);
    await assert.rejects(
      authelia.addOAuthUser({ username: 'bad user', password: 'password', email: 'user@example.test' }),
      /Username/
    );
    await assert.rejects(
      authelia.addOAuthUser({ username: 'valid', password: 'password', email: 'invalid' }),
      /valid email/
    );
    await assert.rejects(
      authelia.addOAuthUser({
        username: 'valid',
        password: 'password',
        email: 'valid@example.test',
        linuxUser: 'definitely-not-a-real-user',
      }),
      /does not exist/
    );
    process.env.FAKE_AUTHELIA_BAD_DIGEST = 'true';
    await assert.rejects(
      authelia.addOAuthUser({ username: 'valid', password: 'password', email: 'valid@example.test' }),
      /Password hashing failed/
    );
    delete process.env.FAKE_AUTHELIA_BAD_DIGEST;
    await assert.rejects(authelia.updateOAuthUser('missing', {}), /not found/);
    await assert.rejects(authelia.deleteOAuthUser('missing'), /not found/);
  });

  it('rolls back an unhealthy user-file change and reports inactive health', async () => {
    await authelia.addOAuthUser({
      username: 'rollback-user',
      password: 'password',
      email: 'before@example.test',
      role: 'viewer',
    });
    const before = await fs.readFile(usersFile, 'utf8');
    process.env.FAKE_SYSTEMCTL_INACTIVE = 'true';
    await assert.rejects(authelia.updateOAuthUser('rollback-user', { email: 'after@example.test' }), /Rolled back/);
    delete process.env.FAKE_SYSTEMCTL_INACTIVE;
    assert.equal(await fs.readFile(usersFile, 'utf8'), before);
    process.env.FAKE_SYSTEMCTL_FAIL = 'true';
    assert.equal((await authelia.getAutheliaHealth()).status, 'inactive');
    delete process.env.FAKE_SYSTEMCTL_FAIL;
    await authelia.deleteOAuthUser('rollback-user');
  });

  it('validates OAuth client configuration and supports generated localhost clients', async () => {
    await assert.rejects(authelia.addOAuthClient({ redirectUris: [] }), /redirect URI/);
    await assert.rejects(
      authelia.addOAuthClient({ clientId: 'x!', redirectUris: ['https://example.test/callback'] }),
      /clientId/
    );
    for (const redirect of [
      'https://user:pass@example.test/callback',
      'https://example.test/callback#fragment',
      'not a URL',
    ]) {
      await assert.rejects(
        authelia.addOAuthClient({ clientId: 'invalid-client', redirectUris: [redirect] }),
        /redirectUris/
      );
    }
    const generated = await authelia.addOAuthClient({
      clientName: '',
      redirectUris: ['http://localhost/callback', 'http://localhost/callback'],
    });
    assert.match(generated.client_id, /^chatgpt-[0-9a-f]{16}$/);
    assert.equal(generated.redirect_uris.length, 1);
    await assert.rejects(
      authelia.addOAuthClient({ clientId: generated.client_id, redirectUris: ['https://example.test/callback'] }),
      /already exists/
    );
    await assert.rejects(authelia.deleteOAuthClient('missing-client'), /not found/);
    await authelia.deleteOAuthClient(generated.client_id);

    await fs.writeFile(configFile, '{}\n', { mode: 0o600 });
    await assert.rejects(
      authelia.addOAuthClient({ clientId: 'missing-section', redirectUris: ['https://example.test/callback'] }),
      /missing OIDC clients/
    );
    await assert.rejects(authelia.deleteOAuthClient('missing-section'), /Invalid Authelia config/);
    await fs.writeFile(configFile, 'identity_providers:\n  oidc:\n    clients: []\n', { mode: 0o600 });
  });

  it('covers remaining uncovered lines', async () => {
    // line 55-56: backup dir creation fails
    const backupDir = process.env.AUTHELIA_BACKUP_DIR;
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.writeFile(backupDir, 'im a file now'); // file instead of dir makes mkdir fail
    await assert.rejects(
      authelia.addOAuthUser({ username: 'baddir', password: 'pw', email: 'a@b.com' }),
      /Cannot prepare Authelia backup directory/
    );
    await fs.rm(backupDir);
    await fs.mkdir(backupDir, { recursive: true });

    // line 83-84: restartAuthelia fails (systemctl restart throws)
    // line 92-93: rollbackFile catch
    process.env.FAKE_SYSTEMCTL_FAIL = 'true';
    process.env.FAKE_SYSTEMCTL_FAIL = 'true';
    process.env.AUTHELIA_RESTART_SETTLE_MS = '100';
    let oldConsoleError = console.error;
    let rollbackFailedCalled = false;
    console.error = (msg, ...args) => {
      if (typeof msg === 'string' && msg.includes('Rollback failed:')) rollbackFailedCalled = true;
    };
    const p = assert.rejects(
      authelia.addOAuthUser({ username: 'restartfail', password: 'pw', email: 'a@b.com' }),
      /Authelia failed to restart/
    );
    const p2 = (async () => {
      let found = false;
      for (let i = 0; i < 50 && !found; i++) {
        await new Promise(r => setTimeout(r, 20));
        try {
          const backups = await fs.readdir(backupDir);
          if (backups.length > 0) {
            for (const b of backups) await fs.rm(path.join(backupDir, b));
            found = true;
          }
        } catch (readErr) {
          // Retry reading backup directory until file is present
        }
      }
    })();
    await Promise.all([p, p2]);
    console.error = oldConsoleError;
    assert.equal(rollbackFailedCalled, true, 'rollbackFile should catch error');
    process.env.AUTHELIA_RESTART_SETTLE_MS = '0';
    delete process.env.FAKE_SYSTEMCTL_FAIL;

    // line 141: scopesMatch false with same length
    await authelia.addOAuthUser({ username: 'scopes-match', password: 'pw', email: 's@a.com', scopes: ['files.*'] });
    await authelia.updateOAuthUser('scopes-match', { scopes: ['projects.*'] });

    // line 166-168: wildcard scopes restricted migration (existing mapping has wildcard but role is not admin)
    const db = new DatabaseSync(process.env.MCP_STATE_DB);
    db.prepare(
      "UPDATE oauth_mappings SET payload = json_set(payload, '$.scopes', json('[\" * \"]')) WHERE username = 'scopes-match'"
    ).run();
    db.close();
    await assert.rejects(authelia.updateOAuthUser('scopes-match', { scopes: ['*'] }), /Wildcard OAuth scope/);

    // line 262-264: USERS_FILE non-ENOENT error
    const usersFileContent = await fs.readFile(process.env.AUTHELIA_USERS_FILE, 'utf8');
    await fs.rm(process.env.AUTHELIA_USERS_FILE);
    await fs.mkdir(process.env.AUTHELIA_USERS_FILE);
    await assert.rejects(authelia.getOAuthUsers(), /EISDIR/);
    await fs.rm(process.env.AUTHELIA_USERS_FILE, { recursive: true });
    await fs.writeFile(process.env.AUTHELIA_USERS_FILE, usersFileContent, { mode: 0o600 });

    // line 269-270: USERS_FILE invalid YAML
    await fs.writeFile(process.env.AUTHELIA_USERS_FILE, 'invalid: yaml: :');
    assert.deepEqual(await authelia.getOAuthUsers(), []);
    await fs.writeFile(process.env.AUTHELIA_USERS_FILE, usersFileContent, { mode: 0o600 });

    // line 349-350: User already exists
    await authelia.addOAuthUser({ username: 'existing', password: 'pw', email: 'e@e.com' });
    await assert.rejects(
      authelia.addOAuthUser({ username: 'existing', password: 'pw', email: 'e@e.com' }),
      /already exists/
    );

    // line 404-418: updateOAuthUser with groups and password
    await authelia.updateOAuthUser('existing', { groups: ['new-group'], password: 'new-password' });

    // line 464-466: CONFIG_FILE non-ENOENT error
    const configFileContent = await fs.readFile(process.env.AUTHELIA_CONFIG_FILE, 'utf8');
    await fs.rm(process.env.AUTHELIA_CONFIG_FILE);
    await fs.mkdir(process.env.AUTHELIA_CONFIG_FILE);
    await assert.rejects(authelia.getOAuthClients(), /EISDIR/);
    await fs.rm(process.env.AUTHELIA_CONFIG_FILE, { recursive: true });
    await fs.writeFile(process.env.AUTHELIA_CONFIG_FILE, configFileContent, { mode: 0o600 });

    // line 471-472: CONFIG_FILE invalid YAML
    await fs.writeFile(process.env.AUTHELIA_CONFIG_FILE, 'invalid: yaml: :');
    assert.deepEqual(await authelia.getOAuthClients(), []);
    await fs.writeFile(process.env.AUTHELIA_CONFIG_FILE, configFileContent, { mode: 0o600 });

    // line 522-523: addOAuthClient secret generation fails
    process.env.FAKE_AUTHELIA_COMMAND_FAIL = 'true';
    await assert.rejects(
      authelia.addOAuthClient({ clientId: 'fail-client', redirectUris: ['https://example.test'] }),
      /secret generation failed/
    );
    delete process.env.FAKE_AUTHELIA_COMMAND_FAIL;

    // line 651-652: forceRestartAuthelia
    assert.equal(await authelia.forceRestartAuthelia(), true);

    // branch coverage: invalid linuxUser
    await assert.rejects(authelia.updateOAuthUser('existing', { linuxUser: '1invalid' }), /Invalid OAuth Linux user/);

    // branch coverage: falsy AUTHELIA_URL and AUTHELIA_JWKS_URL
    const oldIssuer = process.env.AUTHELIA_ISSUER;
    const oldJwks = process.env.AUTHELIA_JWKS_URL;
    const oldRes = process.env.OAUTH_RESOURCE_URL;
    delete process.env.AUTHELIA_ISSUER;
    delete process.env.AUTHELIA_JWKS_URL;
    delete process.env.OAUTH_RESOURCE_URL;
    delete process.env.PUBLIC_URL;
    const autheliaFalsy = await import(`../../lib/authelia.js?test=falsy-${Date.now()}`);
    const health = await autheliaFalsy.getAutheliaHealth();
    assert.equal(health.discoveryUrl, '');
    assert.equal(health.jwksUrl, '');

    // branch coverage: falsy resourceAudience in addOAuthClient
    await autheliaFalsy.addOAuthClient({
      clientId: 'no-audience',
      redirectUris: ['https://example.test', 123],
      clientName: '',
    });

    // branch coverage: bad digest in addOAuthClient (line 519)
    process.env.FAKE_AUTHELIA_BAD_DIGEST = 'true';
    await assert.rejects(
      autheliaFalsy.addOAuthClient({ clientId: 'bad-digest-client', redirectUris: ['https://example.test'] }),
      /Failed to parse secret hash/
    );
    delete process.env.FAKE_AUTHELIA_BAD_DIGEST;

    // branch coverage: non-array redirectUris
    await assert.rejects(
      autheliaFalsy.addOAuthClient({ clientId: 'no-array-redirect', redirectUris: 'not-an-array' }),
      /At least one redirect URI is required/
    );
    delete process.env.FAKE_AUTHELIA_BAD_DIGEST;

    // branch coverage: client with falsy attributes
    const rawConf = await fs.readFile(process.env.AUTHELIA_CONFIG_FILE, 'utf8');
    const yamlConf = yaml.load(rawConf);
    yamlConf.identity_providers.oidc.clients.push({ client_id: 'missing-attrs' });
    await fs.writeFile(process.env.AUTHELIA_CONFIG_FILE, yaml.dump(yamlConf));
    const clients = await autheliaFalsy.getOAuthClients();
    assert.ok(clients.find(c => c.client_id === 'missing-attrs'));

    process.env.AUTHELIA_ISSUER = oldIssuer;
    process.env.AUTHELIA_JWKS_URL = oldJwks;
    process.env.OAUTH_RESOURCE_URL = oldRes;
  });
});
