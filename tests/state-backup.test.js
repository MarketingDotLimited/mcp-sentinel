import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const execute = promisify(execFile);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(item => fs.rm(item, { recursive: true, force: true })));
});

describe('encrypted SQLite state backups', () => {
  it('backs up, authenticates, integrity-checks, and restores the database', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-state-backup-'));
    temporaryDirectories.push(directory);
    const source = path.join(directory, 'state.sqlite3');
    const restored = path.join(directory, 'restored.sqlite3');
    const backupDirectory = path.join(directory, 'backups');
    const database = new DatabaseSync(source);
    database.exec("CREATE TABLE example(value TEXT); INSERT INTO example VALUES ('ok')");
    database.close();
    const environment = {
      ...process.env,
      MCP_STATE_DB: source,
      MCP_STATE_BACKUP_DIR: backupDirectory,
      MCP_STATE_BACKUP_KEY: 'ab'.repeat(32),
      MCP_STATE_BACKUP_KEY_ID: 'test-key',
    };
    const backupResult = JSON.parse(
      (await execute(process.execPath, ['scripts/backup-state.js'], { cwd: process.cwd(), env: environment })).stdout
    );
    assert.equal(backupResult.verified, true);
    const payload = JSON.parse(await fs.readFile(backupResult.backup, 'utf8'));
    assert.equal(payload.keyId, 'test-key');
    assert.equal(payload.algorithm, 'aes-256-gcm');
    assert.equal('plaintext' in payload, false);
    assert.ok(payload.ciphertext.length > 100);

    const restoreResult = JSON.parse(
      (
        await execute(process.execPath, ['scripts/restore-state.js', backupResult.backup], {
          cwd: process.cwd(),
          env: { ...environment, MCP_STATE_DB: restored, MCP_RESTORE_OFFLINE: 'true' },
        })
      ).stdout
    );
    assert.equal(restoreResult.verified, true);
    const verification = new DatabaseSync(restored, { readOnly: true });
    assert.equal(verification.prepare('SELECT value FROM example').get().value, 'ok');
    verification.close();
  });
});
