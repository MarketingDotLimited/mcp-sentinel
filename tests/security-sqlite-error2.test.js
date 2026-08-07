import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DatabaseSync } from 'node:sqlite';

describe('security.js SQLite errors', async () => {
  let tmpDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-security-sqlite-err-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persistJwtRevocations rollback on error', async () => {
    process.env.MCP_STATE_DB = path.join(tmpDir, 'state.sqlite3');
    process.env.JWT_SECRET = 's'.repeat(64);

    // Let security.js initialize the db
    const security = await import(`../security.js?test=${Date.now()}`);

    // Now, break the database! Let's close it under its feet? No, it doesn't expose the instance.
    // Let's drop the table using a separate connection!
    const db = new DatabaseSync(process.env.MCP_STATE_DB);
    db.exec('DROP TABLE jwt_revocations');
    db.close();

    const req = {
      identity: { authType: 'apiKey', jti: 'test-jti', tokenExpiresAt: Date.now() + 10000 },
      clientIP: '127.0.0.1',
    };
    const res = { json: () => {} };

    try {
      security.revokeSessionToken(req, res);
      assert.fail('should have thrown');
    } catch (err) {
      assert.match(err.message, /no such table: jwt_revocations/);
    }
  });
});
