import "../test-env.js";
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

describe('scripts CLI behavioral contract tests', () => {
  it('scripts/firewall-rollback.js input validation', () => {
    assert.throws(
      () => execFileSync(process.execPath, ['scripts/firewall-rollback.js', 'invalid-id'], { stdio: 'pipe' }),
      /Invalid firewall rollback ID/
    );
  });

  it('scripts/upgrade-state.js executes state migrations on temp DB', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-script-upgrade-'));
    const tmpDb = path.join(tmpDir, 'state.sqlite3');
    try {
      const output = execFileSync(process.execPath, ['scripts/upgrade-state.js'], {
        env: { ...process.env, MCP_STATE_DB: tmpDb },
        encoding: 'utf8',
      });
      const parsed = JSON.parse(output.trim());
      assert.equal(parsed.upgraded, true);
      assert.equal(parsed.integrity, 'ok');
      assert.ok(Array.isArray(parsed.versions));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('scripts/backup-state.js and restore-state.js execute end-to-end backup/restore', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-script-backup-'));
    const tmpDb = path.join(tmpDir, 'state.sqlite3');
    const backupDir = path.join(tmpDir, 'backups');
    const secret = 'a'.repeat(64);

    try {
      // 1. Init DB via upgrade-state
      execFileSync(process.execPath, ['scripts/upgrade-state.js'], {
        env: { ...process.env, MCP_STATE_DB: tmpDb },
      });

      // 2. Backup
      const backupOut = execFileSync(process.execPath, ['scripts/backup-state.js'], {
        env: {
          ...process.env,
          MCP_STATE_DB: tmpDb,
          MCP_STATE_BACKUP_DIR: backupDir,
          MCP_STATE_BACKUP_KEY: secret,
        },
        encoding: 'utf8',
      });
      const backupRes = JSON.parse(backupOut.trim());
      assert.equal(backupRes.verified, true);
      assert.ok(backupRes.backup);

      // 3. Restore
      const restoreOut = execFileSync(process.execPath, ['scripts/restore-state.js', backupRes.backup, tmpDb], {
        env: {
          ...process.env,
          MCP_RESTORE_OFFLINE: 'true',
          MCP_STATE_BACKUP_DIR: backupDir,
          MCP_STATE_BACKUP_KEY: secret,
          STATE_BACKUP_KEY: secret,
        },
        encoding: 'utf8',
      });
      const restoreRes = JSON.parse(restoreOut.trim());
      assert.equal(restoreRes.verified, true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
