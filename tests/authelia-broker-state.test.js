import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

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
if (name === 'authelia') process.stdout.write('Digest: $argon2id$v=19$m=65536,t=3,p=4$ZmFrZXNhbHQ$ZmFrZWRpZ2VzdA\\n');
else if (name === 'systemctl' && args[0] === 'is-active') process.stdout.write('active\\n');
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
const authelia = await import(`../lib/authelia.js?test=${Date.now()}`);

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

  it('rejects unsafe redirects and deletion of protected identities', async () => {
    await assert.rejects(
      authelia.addOAuthClient({ clientId: 'unsafe', redirectUris: ['http://example.test/callback'] }),
      /redirectUris/
    );
    await assert.rejects(authelia.deleteOAuthUser('admin'), /Cannot delete/);
    await assert.rejects(authelia.deleteOAuthClient('chatgpt'), /Cannot delete/);
  });
});
