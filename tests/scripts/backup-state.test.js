import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/backup-state.js', import.meta.url));

test('backup-state.js credentials directory coverage', async (t) => {
    const originalEnv = { ...process.env };

    t.afterEach(() => {
        process.env = { ...originalEnv };
        mock.reset();
    });

    await t.test('reads key from CREDENTIALS_DIRECTORY', async (t) => {
        delete process.env.MCP_STATE_BACKUP_KEY;
        process.env.MCP_STATE_DB = '/tmp/fake-test-db-' + Date.now() + '.sqlite3';
        import('fs').then(fs => fs.writeFileSync(process.env.MCP_STATE_DB, ''));
        process.env.MCP_BACKUP_ROOT = '/tmp/fake-backup-' + Date.now();
        import('fs').then(fs => fs.mkdirSync(process.env.MCP_BACKUP_ROOT, { recursive: true }));
        process.env.CREDENTIALS_DIRECTORY = (await import('os')).tmpdir() + '/creds-' + Date.now() + Math.random();
        (await import('fs')).mkdirSync(process.env.CREDENTIALS_DIRECTORY, { recursive: true });
        (await import('fs')).writeFileSync(process.env.CREDENTIALS_DIRECTORY + '/state-backup-key', 'a'.repeat(64) + '\n');
        
        
        
        t.mock.method(process.stdout, 'write', () => {});

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
    });

    await t.test('ignores read failure from CREDENTIALS_DIRECTORY and throws due to invalid key', async (t) => {
        delete process.env.MCP_STATE_BACKUP_KEY;
        process.env.MCP_STATE_DB = '/tmp/fake-test-db-' + Date.now() + '.sqlite3';
        import('fs').then(fs => fs.writeFileSync(process.env.MCP_STATE_DB, ''));
        process.env.MCP_BACKUP_ROOT = '/tmp/fake-backup-' + Date.now();
        import('fs').then(fs => fs.mkdirSync(process.env.MCP_BACKUP_ROOT, { recursive: true }));
        process.env.CREDENTIALS_DIRECTORY = (await import('os')).tmpdir() + '/creds-' + Date.now() + Math.random();
        (await import('fs')).mkdirSync(process.env.CREDENTIALS_DIRECTORY, { recursive: true });
        
        
        
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /state-backup-key must contain 64 hexadecimal characters/
        );
    });
});
