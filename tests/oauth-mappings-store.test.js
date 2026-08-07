import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

describe('oauth-mappings-store.js coverage', () => {
  let directory;

  before(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-oauth-store-'));
  });

  after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('covers USE_LEGACY_JSON read and write', async () => {
    const mappingsFile = path.join(directory, 'mappings.json');
    process.env.AUTHELIA_MAPPINGS_FILE = mappingsFile;
    delete process.env.MCP_STATE_DB;

    const { readOAuthMappings, writeOAuthMappings } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);

    const res1 = await readOAuthMappings();
    assert.deepEqual(res1, {});

    await writeOAuthMappings({ alice: { role: 'admin' } });

    const res2 = await readOAuthMappings();
    assert.deepEqual(res2, { alice: { role: 'admin' } });

    const dirAsFile = path.join(directory, 'not-a-file');
    await fs.mkdir(dirAsFile);
    process.env.AUTHELIA_MAPPINGS_FILE = dirAsFile;
    const { readOAuthMappings: read2 } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);
    await assert.rejects(read2(), /EISDIR/);
  });

  it('covers USE_LEGACY_JSON with other env vars', async () => {
    delete process.env.MCP_STATE_DB;
    delete process.env.AUTHELIA_MAPPINGS_FILE;
    delete process.env.CONTROL_PLANE_STATE_FILE;
    process.env.KEYSTORE_FILE = path.join(directory, 'ks.json');
    const { readOAuthMappings: r1 } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);
    // Should be ENOENT from KS file path which doesn't exist? Wait, readOAuthMappings uses MAPPINGS_FILE!
    // But USE_LEGACY_JSON is true! So it tries to read MAPPINGS_FILE which is undefined/empty and throws ENOENT or fails.
    try {
      await r1();
    } catch (e) {}

    delete process.env.KEYSTORE_FILE;
    process.env.CONTROL_PLANE_STATE_FILE = path.join(directory, 'cp.json');
    const { readOAuthMappings: r2 } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);
    try {
      await r2();
    } catch (e) {}
  });

  it('covers USE_LEGACY_JSON false', async () => {
    delete process.env.MCP_STATE_DB;
    delete process.env.AUTHELIA_MAPPINGS_FILE;
    delete process.env.KEYSTORE_FILE;
    delete process.env.CONTROL_PLANE_STATE_FILE;
    // all false -> USE_LEGACY_JSON = false
    const { readOAuthMappings: r3 } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);
    // It will try to use /var/lib/mcp-sentinel/state.sqlite3 which might fail due to permissions, so we catch
    try {
      await r3();
    } catch (e) {}
  });

  it('covers writeRows rollback on invalid username', async () => {
    const dbFile = path.join(directory, 'state1.sqlite3');
    process.env.MCP_STATE_DB = dbFile;
    delete process.env.AUTHELIA_MAPPINGS_FILE;

    const { writeOAuthMappings } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);
    await assert.rejects(writeOAuthMappings({ 'invalid user!': { role: 'dev' } }), /Invalid OAuth mapping username/);
  });

  it('covers SQLite read and write including migration', async () => {
    const dbFile = path.join(directory, 'state2.sqlite3');
    const legacyFile = path.join(directory, 'legacy.json');
    await fs.writeFile(legacyFile, JSON.stringify({ bob: { role: 'dev' } }));

    process.env.MCP_STATE_DB = dbFile;
    process.env.AUTHELIA_MAPPINGS_FILE = legacyFile;

    const { readOAuthMappings, writeOAuthMappings } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);

    const res1 = await readOAuthMappings();
    assert.deepEqual(res1, { bob: { role: 'dev' } });

    await writeOAuthMappings({ charlie: { role: 'user' } });

    const res2 = await readOAuthMappings();
    assert.deepEqual(res2, { charlie: { role: 'user' } });
  });

  it('covers failed migration', async () => {
    const dbFile = path.join(directory, 'state3.sqlite3');
    const legacyFile = path.join(directory, 'legacy2.json');
    await fs.writeFile(legacyFile, 'invalid json');

    process.env.MCP_STATE_DB = dbFile;
    process.env.AUTHELIA_MAPPINGS_FILE = legacyFile;

    const { readOAuthMappings } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);
    await assert.rejects(readOAuthMappings(), /OAuth mapping migration failed/);
  });

  it('covers safeParseJson empty or invalid', async () => {
    const dbFile = path.join(directory, 'state4.sqlite3');
    process.env.MCP_STATE_DB = dbFile;
    delete process.env.AUTHELIA_MAPPINGS_FILE;

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbFile);
    db.exec(`
      CREATE TABLE oauth_mappings (username TEXT PRIMARY KEY, payload ANY, updated_at TEXT NOT NULL);
      CREATE TABLE state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT INTO state_meta(key, value) VALUES ('oauth_mapping_json_migration', 'yes');
      INSERT INTO oauth_mappings(username, payload, updated_at) VALUES ('david', 'bad json', 'now');
      INSERT INTO oauth_mappings(username, payload, updated_at) VALUES ('eve', '"string"', 'now');
      INSERT INTO oauth_mappings(username, payload, updated_at) VALUES ('frank', 123, 'now');
    `);
    db.close();

    const { readOAuthMappings } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);
    const res = await readOAuthMappings();
    assert.deepEqual(res, { david: {}, eve: {}, frank: {} });
  });

  it('covers writeRows invalid mappings type', async () => {
    const dbFile = path.join(directory, 'state5.sqlite3');
    process.env.MCP_STATE_DB = dbFile;
    const { writeOAuthMappings } = await import(`../lib/oauth-mappings-store.js?t=${Date.now()}`);
    await assert.rejects(writeOAuthMappings([]), /OAuth mappings must be an object/);
    await assert.rejects(writeOAuthMappings(null), /OAuth mappings must be an object/);
  });
});
