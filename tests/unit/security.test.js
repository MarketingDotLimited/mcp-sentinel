import "../test-env.js";
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

describe('security.js full coverage', () => {
  let tmpDir;
  let security;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-security-test-'));
    process.env.ADMIN_API_KEY = 'mcp_master_admin_test_' + randomUUID().replace(/-/g, '');
    process.env.JWT_REVOCATION_FILE = path.join(tmpDir, 'rev.json');
    process.env.KEYSTORE_FILE = path.join(tmpDir, 'keys.json');
    process.env.MCP_STATE_DB = path.join(tmpDir, 'state.sqlite3');
    process.env.JWT_SECRET = 's'.repeat(64);

    // Create pre-existing state to hit line 78 (for loop)
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(process.env.MCP_STATE_DB);
    db.exec(
      'CREATE TABLE jwt_revocations (jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, revoked_at TEXT NOT NULL) STRICT;'
    );
    db.prepare('INSERT INTO jwt_revocations(jti, expires_at, revoked_at) VALUES (?, ?, ?)').run(
      'expired_test',
      Date.now() - 10000,
      new Date().toISOString()
    );
    db.prepare('INSERT INTO jwt_revocations(jti, expires_at, revoked_at) VALUES (?, ?, ?)').run(
      'active_test',
      Date.now() + 10000,
      new Date().toISOString()
    );
    db.close();

    security = await import(`../../security.js?test=${Date.now()}`);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('jwtSecretIsConfigured', () => {
    assert.equal(security.jwtSecretIsConfigured(), true);
  });

  it('added ADMIN_API_KEY', async () => {
    const { getKeyEntry } = await import("../../keystore.js");
    const entry = getKeyEntry(process.env.ADMIN_API_KEY);
    assert.ok(entry);
    assert.equal(entry.userId, 'admin');
  });
});
describe('security.js branches', async () => {
  let tmpDir;
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sec-'));
    process.env.MCP_STATE_DB = path.join(tmpDir, 'state.sqlite3');
  });
  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('addApiKey branches', async () => {
    const security = await import(`../../security.js?test=${Date.now()}`);

    // Line 673: throw on invalid user
    await assert.rejects(
      security.addApiKey('12345678901234567890123456789012345', { role: 'viewer', userId: 'nonexistent-user-12345' }),
      /Invalid user: Unix account/
    );

    // Line 686: projectIds is not array
    await security.addApiKey('12345678901234567890123456789012346', {
      role: 'viewer',
      userId: 'root',
      projectIds: 'not-array',
    });

    // Line 686: projectIds is array
    await security.addApiKey('12345678901234567890123456789012347', {
      role: 'viewer',
      userId: 'root',
      projectIds: ['p1'],
    });
  });
});
