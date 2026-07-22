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

    // A second restore exercises protected pre-restore snapshot creation.
    const secondRestore = JSON.parse(
      (
        await execute(process.execPath, ['scripts/restore-state.js', backupResult.backup], {
          cwd: process.cwd(),
          env: { ...environment, MCP_STATE_DB: restored, MCP_RESTORE_OFFLINE: 'true' },
        })
      ).stdout
    );
    assert.equal(secondRestore.verified, true);
    assert.ok((await fs.readdir(directory)).some(name => name.startsWith('restored.sqlite3.pre-restore-')));
  });

  it('loads backup credentials, prunes retention, and rejects unsafe restore inputs', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-state-backup-errors-'));
    temporaryDirectories.push(directory);
    const source = path.join(directory, 'state.sqlite3');
    const backupDirectory = path.join(directory, 'backups');
    const credentials = path.join(directory, 'credentials');
    await fs.mkdir(backupDirectory);
    await fs.mkdir(credentials);
    await fs.writeFile(path.join(credentials, 'state-backup-key'), 'cd'.repeat(32), { mode: 0o600 });
    const database = new DatabaseSync(source);
    database.exec('CREATE TABLE example(value TEXT)');
    database.close();
    const expired = path.join(backupDirectory, 'state-expired.sqlite3.enc');
    await fs.writeFile(expired, '{}');
    await fs.utimes(expired, new Date(0), new Date(0));
    await fs.writeFile(path.join(backupDirectory, 'keep.txt'), 'not a backup');
    const environment = {
      ...process.env,
      MCP_STATE_DB: source,
      MCP_STATE_BACKUP_DIR: backupDirectory,
      MCP_STATE_BACKUP_KEY: '',
      CREDENTIALS_DIRECTORY: credentials,
      MCP_STATE_BACKUP_RETENTION_DAYS: '1',
    };
    const backupResult = JSON.parse(
      (await execute(process.execPath, ['scripts/backup-state.js'], { cwd: process.cwd(), env: environment })).stdout
    );
    await assert.rejects(fs.stat(expired), error => error.code === 'ENOENT');
    assert.equal(await fs.readFile(path.join(backupDirectory, 'keep.txt'), 'utf8'), 'not a backup');

    const expectFailure = async (args, env, message) => {
      await assert.rejects(execute(process.execPath, args, { cwd: process.cwd(), env }), error =>
        message.test(`${error.stderr || ''}${error.message || ''}`)
      );
    };
    await expectFailure(
      ['scripts/restore-state.js', backupResult.backup],
      { ...environment, MCP_RESTORE_OFFLINE: 'false' },
      /MCP_RESTORE_OFFLINE/
    );
    await expectFailure(['scripts/restore-state.js'], { ...environment, MCP_RESTORE_OFFLINE: 'true' }, /Usage:/);
    await expectFailure(
      ['scripts/restore-state.js', source],
      { ...environment, MCP_RESTORE_OFFLINE: 'true' },
      /inside MCP_STATE_BACKUP_DIR/
    );
    await expectFailure(
      ['scripts/restore-state.js', backupResult.backup],
      { ...environment, CREDENTIALS_DIRECTORY: '', MCP_STATE_BACKUP_KEY: 'invalid', MCP_RESTORE_OFFLINE: 'true' },
      /64 hexadecimal/
    );

    const unsupported = path.join(backupDirectory, 'unsupported.sqlite3.enc');
    await fs.writeFile(unsupported, JSON.stringify({ version: 2, algorithm: 'unknown' }));
    await expectFailure(
      ['scripts/restore-state.js', unsupported],
      { ...environment, MCP_RESTORE_OFFLINE: 'true' },
      /Unsupported backup format/
    );
    const checksumMismatch = path.join(backupDirectory, 'checksum.sqlite3.enc');
    const payload = JSON.parse(await fs.readFile(backupResult.backup, 'utf8'));
    payload.sourceSha256 = '00'.repeat(32);
    await fs.writeFile(checksumMismatch, JSON.stringify(payload));
    await expectFailure(
      ['scripts/restore-state.js', checksumMismatch],
      { ...environment, MCP_RESTORE_OFFLINE: 'true' },
      /checksum mismatch/
    );

    await expectFailure(
      ['scripts/backup-state.js'],
      { ...environment, CREDENTIALS_DIRECTORY: '', MCP_STATE_BACKUP_KEY: 'invalid' },
      /64 hexadecimal/
    );
  });
});
