import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/restore-state.js', import.meta.url));

test('restore-state.js extra coverage', async (t) => {
    const originalEnv = { ...process.env };
    const originalArgv = [...process.argv];

    t.afterEach(() => {
        process.env = { ...originalEnv };
        process.argv = [...originalArgv];
        mock.reset();
    });

    await t.test('reads key from CREDENTIALS_DIRECTORY and throws on error to clean up', async (t) => {
        process.env.MCP_RESTORE_OFFLINE = 'true';
        delete process.env.MCP_STATE_BACKUP_KEY;
        process.env.MCP_STATE_BACKUP_DIR = path.join(os.tmpdir(), 'fake-backup-' + Date.now());
        const dbPath = path.join(os.tmpdir(), 'fake-test-db-' + Date.now() + '.sqlite3');
        process.env.MCP_STATE_DB = dbPath;
        fs.writeFileSync(dbPath, '');
        
        process.env.MCP_STATE_BACKUP_DIR = path.join(os.tmpdir(), 'fake-backup-' + Date.now());
        fs.mkdirSync(process.env.MCP_STATE_BACKUP_DIR, { recursive: true });
        
        process.env.CREDENTIALS_DIRECTORY = path.join(os.tmpdir(), 'creds-' + Date.now());
        fs.mkdirSync(process.env.CREDENTIALS_DIRECTORY, { recursive: true });
        fs.writeFileSync(path.join(process.env.CREDENTIALS_DIRECTORY, 'state-backup-key'), 'a'.repeat(64) + '\n');
        
        const backupFile = path.join(process.env.MCP_STATE_BACKUP_DIR, 'test.sqlite3.enc');
        fs.writeFileSync(backupFile, JSON.stringify({
            version: 1,
            algorithm: 'aes-256-gcm',
            iv: 'AAAA',
            tag: 'AAAA',
            ciphertext: 'AAAA',
            sourceSha256: 'fake'
        }));
        process.argv[2] = backupFile;
        
        mock.module('node:crypto', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                createDecipheriv: () => ({
                    setAuthTag: () => {},
                    update: () => Buffer.from('fake'),
                    final: () => Buffer.from('')
                }),
                createHash: () => ({
                    update: () => ({ digest: () => 'fake' })
                })
            }
        });

        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /file is not a database/
        );
        
        // Check that cleanup worked by looking for the .restore file
        const files = fs.readdirSync(path.dirname(dbPath));
        assert.ok(!files.some(f => f.endsWith('.restore')));
    });

    await t.test('ignores read failure from CREDENTIALS_DIRECTORY and throws due to invalid key', async (t) => {
        process.env.MCP_RESTORE_OFFLINE = 'true';
        delete process.env.MCP_STATE_BACKUP_KEY;
        process.env.MCP_STATE_BACKUP_DIR = path.join(os.tmpdir(), 'fake-backup-' + Date.now());
        process.env.CREDENTIALS_DIRECTORY = path.join(os.tmpdir(), 'creds-missing-' + Date.now());
        fs.mkdirSync(process.env.CREDENTIALS_DIRECTORY, { recursive: true });
        // intentionally not writing the key file
        
        process.argv[2] = path.join(process.env.MCP_STATE_BACKUP_DIR || '', 'test.sqlite3.enc');
        
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /state-backup-key must contain 64 hexadecimal characters/
        );
    });
});
