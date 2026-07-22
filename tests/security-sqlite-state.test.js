import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-security-state-'));
const databaseFile = path.join(directory, 'state.sqlite3');
const keysFile = path.join(directory, 'api-keys.json');
const capabilitiesFile = path.join(directory, 'capabilities.json');
const mappingsFile = path.join(directory, 'mappings.json');
const legacyKey = 'mcp_legacy_example_key';
const legacyHash = crypto.createHash('sha256').update(legacyKey).digest('hex');
await fs.writeFile(
  keysFile,
  JSON.stringify({
    [legacyHash]: {
      keyId: '44444444-4444-4444-8444-444444444444',
      version: 1,
      active: true,
      userId: 'legacy',
      role: 'viewer',
      scopes: ['get_system_info'],
    },
  })
);
await fs.writeFile(capabilitiesFile, JSON.stringify({ enabled: { 'advanced-data': true } }));
await fs.writeFile(
  mappingsFile,
  JSON.stringify({ developer: { linuxUser: 'developer', role: 'developer', scopes: ['files.*'], clients: {} } })
);
process.env.MCP_STATE_DB = databaseFile;
process.env.KEYSTORE_FILE = keysFile;
process.env.MCP_CAPABILITIES_FILE = capabilitiesFile;
process.env.AUTHELIA_MAPPINGS_FILE = mappingsFile;
const keystore = await import(`../keystore.js?test=${Date.now()}`);
const capabilities = await import(`../lib/capabilities.js?test=${Date.now()}`);
const mappings = await import(`../lib/oauth-mappings-store.js?test=${Date.now()}`);
const adminState = await import(`../lib/admin-state.js?test=${Date.now()}`);

after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('SQLite security state', () => {
  it('migrates and transactionally updates hashed API key records', async () => {
    await keystore.loadKeystore();
    assert.equal(keystore.getKeyEntry(legacyKey).userId, 'legacy');
    const newKey = 'mcp_new_example_key';
    const added = await keystore.addKeyEntry(newKey, {
      active: true,
      userId: 'developer',
      role: 'developer',
      scopes: ['files.*'],
    });
    assert.ok(added.keyId);
    await keystore.updateKeyEntry(added.keyId, { label: 'updated', requireApproval: true });
    assert.equal(keystore.getKeyById(added.keyId).label, 'updated');
    assert.equal(await keystore.revokeKeyEntryById(added.keyId), true);
    assert.equal(await keystore.revokeKeyEntry(newKey), false);
    const database = new DatabaseSync(databaseFile, { readOnly: true });
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM api_keys').get().count, 2);
    database.close();
    await fs.access(`${keysFile}.pre-sqlite-backup`);
  });

  it('migrates capabilities and keeps advanced packs opt-in', async () => {
    assert.equal((await capabilities.getCapabilities()).find(item => item.id === 'advanced-data').enabled, true);
    await capabilities.setCapability('advanced-execution', true);
    assert.equal((await capabilities.toolAvailability('run_sandboxed_code')).available, true);
    await assert.rejects(capabilities.setCapability('core-server-care', false), /must remain enabled/);
    await assert.rejects(capabilities.setCapability('unknown', true), /Unknown/);
  });

  it('migrates OAuth mappings and replaces them transactionally', async () => {
    assert.equal((await mappings.readOAuthMappings()).developer.role, 'developer');
    await mappings.writeOAuthMappings({
      rabeeb: {
        linuxUser: 'rabeeb.com_07v7ld45234',
        role: 'developer',
        scopes: ['files.*'],
        requireApproval: true,
        projectIds: ['11111111-1111-4111-8111-111111111111'],
        clients: {},
      },
    });
    assert.deepEqual(Object.keys(await mappings.readOAuthMappings()), ['rabeeb']);
    await assert.rejects(mappings.writeOAuthMappings([]), /must be an object/);
  });

  it('records remediation evidence in state metadata', () => {
    adminState.setAdminState('action_refresh_status', { complete: true });
    assert.deepEqual(adminState.getAdminState('action_refresh_status'), { complete: true });
    assert.equal(adminState.getAdminState('missing'), null);
    assert.throws(() => adminState.setAdminState('../bad', {}), /Invalid state key/);
  });
});
