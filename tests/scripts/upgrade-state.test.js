import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/upgrade-state.js', import.meta.url));

test('upgrade-state.js', async (t) => {
    let stdoutWrites = [];
    const originalEnv = { ...process.env };
    
    t.mock.method(process.stdout, 'write', (data) => {
        stdoutWrites.push(data);
    });

    t.afterEach(() => {
        process.env = { ...originalEnv };
        stdoutWrites = [];
        mock.reset();
    });

    await t.test('uses default db path and throws on integrity fail', async (t) => {
        delete process.env.MCP_STATE_DB;
        
        let dbFileOpened = '';
        const mockDb = {
            prepare: (sql) => ({
                get: () => ({ integrity_check: 'failed' })
            }),
            close: mock.fn()
        };

        mock.module('../../lib/sqlite-state.js', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                openSqliteState: (file) => {
                    dbFileOpened = file;
                    return mockDb;
                }
            }
        });

        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /SQLite integrity verification failed after migration/
        );
        
        assert.equal(dbFileOpened, '/var/lib/mcp-sentinel/state.sqlite3');
        assert.equal(mockDb.close.mock.calls.length, 1);
    });

    await t.test('succeeds and outputs json when integrity is ok', async (t) => {
        process.env.MCP_STATE_DB = '/custom/db.sqlite3';
        
        let dbFileOpened = '';
        const mockDb = {
            prepare: (sql) => {
                if (sql.includes('integrity_check')) {
                    return { get: () => ({ integrity_check: 'ok' }) };
                }
                return { all: () => [{ version: '1' }, { version: '2' }] };
            },
            close: mock.fn()
        };

        mock.module('../../lib/sqlite-state.js', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                openSqliteState: async (file) => {
                    dbFileOpened = file;
                    return mockDb;
                }
            }
        });

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        
        assert.equal(dbFileOpened, '/custom/db.sqlite3');
        assert.equal(mockDb.close.mock.calls.length, 1);
        stdoutWrites = stdoutWrites.filter(w => typeof w === "string");
        assert.equal(stdoutWrites.length, 1);
        const output = JSON.parse(stdoutWrites[0]);
        assert.deepEqual(output, {
            upgraded: true,
            databaseFile: '/custom/db.sqlite3',
            versions: ['1', '2'],
            integrity: 'ok'
        });
    });
});
