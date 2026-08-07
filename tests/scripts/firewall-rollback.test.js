import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/firewall-rollback.js', import.meta.url));

test('firewall-rollback.js', async (t) => {
    const originalArgv = [...process.argv];
    const originalEnv = { ...process.env };
    
    t.afterEach(() => {
        process.argv = [...originalArgv];
        process.env = { ...originalEnv };
        mock.reset();
    });

    await t.test('throws if ID is invalid', async () => {
        process.argv[2] = 'invalid-id';
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Invalid firewall rollback ID/
        );
    });

    await t.test('throws if ID is missing', async () => {
        process.argv[2] = undefined;
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Invalid firewall rollback ID/
        );
    });

    await t.test('throws if snapshot is not a directory', async (t) => {
        process.argv[2] = '12345678-1234-1234-1234-123456789012';
        mock.module('node:fs', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                lstatSync: () => ({ isDirectory: () => false, isSymbolicLink: () => false })
            }
        });
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Invalid firewall snapshot/
        );
    });

    await t.test('throws if snapshot is a symbolic link', async (t) => {
        process.argv[2] = '12345678-1234-1234-1234-123456789012';
        mock.module('node:fs', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => true })
            }
        });
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Invalid firewall snapshot/
        );
    });

    await t.test('executes rollback successfully', async (t) => {
        process.argv[2] = '12345678-1234-1234-1234-123456789012';
        process.env.BROKER_FIREWALL_SNAPSHOT_ROOT = '/custom/root';
        
        let cpSyncArgs, execFileSyncArgs, rmSyncArgs;
        
        mock.module('node:fs', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }),
                cpSync: (...args) => { cpSyncArgs = args; },
                rmSync: (...args) => { rmSyncArgs = args; }
            }
        });
        
        mock.module('node:child_process', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                execFileSync: (...args) => { execFileSyncArgs = args; }
            }
        });

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        
        assert.deepEqual(cpSyncArgs, [
            '/custom/root/12345678-1234-1234-1234-123456789012',
            '/etc/ufw',
            { recursive: true, dereference: false, force: true }
        ]);
        
        assert.deepEqual(execFileSyncArgs, [
            '/usr/sbin/ufw',
            ['reload'],
            { timeout: 30000, stdio: 'inherit' }
        ]);
        
        assert.deepEqual(rmSyncArgs, [
            '/custom/root/12345678-1234-1234-1234-123456789012',
            { recursive: true, force: true }
        ]);
    });
});
