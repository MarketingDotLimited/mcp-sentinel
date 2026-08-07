import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/migrate-state.js', import.meta.url));

test('migrate-state.js', async (t) => {
    let exitCode = undefined;
    let stdoutWrites = [];
    const originalEnv = { ...process.env };
    const originalArgv = [...process.argv];

    t.mock.method(process, 'exit', (code) => { exitCode = code; throw new Error('MOCK_EXIT'); });
    t.mock.method(process.stdout, 'write', (data) => { stdoutWrites.push(data); });

    t.afterEach(() => {
        exitCode = undefined;
        stdoutWrites = [];
        process.env = { ...originalEnv };
        process.argv = [...originalArgv];
        mock.reset();
    });

    await t.test('handles missing legacy file by exiting gracefully in dry-run', async () => {
        delete process.env.CONTROL_PLANE_STATE_FILE;
        try { await import(`${SCRIPT_PATH}?t=${Date.now()}`); } catch (e) { if (e.message !== 'MOCK_EXIT') throw e; }
        assert.equal(exitCode, 0);
        assert.ok(stdoutWrites.some(w => typeof w === 'string' && w.includes('No legacy JSON source')));
    });

    await t.test('throws when missing legacy file in apply mode', async () => {
        delete process.env.CONTROL_PLANE_STATE_FILE;
        process.argv.push('--apply');
        await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /CONTROL_PLANE_STATE_FILE must identify the legacy control-plane JSON/);
    });

    await t.test('throws if legacy state is unreadable', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => { throw new Error('read error'); }
            }
        });
        await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /Cannot read legacy state/);
    });

    await t.test('throws if legacy state is not an object', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => '[]'
            }
        });
        await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /Legacy state root must be an object/);
    });

    await t.test('throws if domains are not arrays', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => '{"projects": {}}'
            }
        });
        await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /Legacy state domains must be arrays/);
    });

    await t.test('throws if missing project root path', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => '{"projects": [{"id": "bad-id"}]}'
            }
        });
        await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /1 project record\(s\) have no root path/);
    });

    await t.test('handles dry-run with unverified export', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (f) => {
                    if (f.endsWith('legacy.json')) return '{"automations": [{"id": "x"}], "projects": []}';
                    throw new Error('marker missing');
                }
            }
        });
        try { await import(`${SCRIPT_PATH}?t=${Date.now()}`); } catch (e) { if (e.message !== 'MOCK_EXIT') throw e; }
        assert.equal(process.exitCode, 2);
        assert.ok(stdoutWrites.some(w => typeof w === 'string' && w.includes('Export removed 1.x domains')));
        process.exitCode = 0; // reset
    });

    await t.test('handles dry-run with verified export', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        process.env.MCP_LEGACY_EXPORT_DIR = '/mock/export';
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (f) => {
                    if (f.endsWith('legacy.json')) return '{"automations": [{"id": "x"}], "projects": []}';
                    if (f.endsWith('verified.json')) return JSON.stringify({ output: '/mock/export/test.json', sha256: 'fake', counts: { automations: 1, fleets: 0, backupTargets: 0, webhooks: 0 } });
                    if (f.endsWith('test.json')) return JSON.stringify({ counts: { automations: 1, fleets: 0, backupTargets: 0, webhooks: 0 } });
                    return '';
                }
            }
        });
        mock.module('node:crypto', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                createHash: () => ({ update: () => ({ digest: () => 'fake' }) })
            }
        });
        try { await import(`${SCRIPT_PATH}?t=${Date.now()}`); } catch (e) { if (e.message !== 'MOCK_EXIT') throw e; }
        assert.equal(process.exitCode, 0);
    });

    await t.test('throws in apply mode with unverified export', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        process.argv.push('--apply');
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (f) => {
                    if (f.endsWith('legacy.json')) return '{"automations": [{"id": "x"}], "projects": []}';
                    throw new Error('marker missing');
                }
            }
        });
        await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /Legacy JSON contains removed 1.x domains/);
    });

    await t.test('executes apply migration successfully', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        process.argv.push('--apply');
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (f) => {
                    if (f.endsWith('legacy.json')) return '{"projects": []}'; // no removed domains
                    return '';
                }
            }
        });
        const mockDb = {
            prepare: () => ({ get: () => ({ integrity_check: 'ok' }) }),
            close: () => {}
        };
        mock.module('../../lib/sqlite-state.js', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                openSqliteState: async () => mockDb,
                loadSqliteState: () => ({ approvals: [], projects: [], organizations: [], teams: [] })
            }
        });
        try { await import(`${SCRIPT_PATH}?t=${Date.now()}`); } catch (e) { if (e.message !== 'MOCK_EXIT') throw e; }
        assert.ok(stdoutWrites.some(w => typeof w === 'string' && w.includes('"applied": true')));
    });

    await t.test('throws on count mismatch in apply mode', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        process.argv.push('--apply');
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (f) => {
                    if (f.endsWith('legacy.json')) return '{"projects": [{"id":"00000000-0000-1000-8000-000000000000","rootPath":"x"}]}';
                    return '';
                }
            }
        });
        const mockDb = { close: () => {} };
        mock.module('../../lib/sqlite-state.js', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                openSqliteState: async () => mockDb,
                loadSqliteState: () => ({ approvals: [], projects: [], organizations: [], teams: [] }) // 0 projects instead of 1
            }
        });
        await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /Migration count mismatch for projects/);
    });

    await t.test('throws on missing aliases in apply mode', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        process.argv.push('--apply');
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (f) => {
                    if (f.endsWith('legacy.json')) return '{"projects": [{"id":"invalid","rootPath":"x"}]}';
                    return '';
                }
            }
        });
        const mockDb = { close: () => {} };
        mock.module('../../lib/sqlite-state.js', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                openSqliteState: async () => mockDb,
                loadSqliteState: () => ({ approvals: [], projects: [{ id: "new", rootPath: "x" }], organizations: [], teams: [] }) // count is 1, but no legacyIds aliases!
            }
        });
        await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /Legacy project aliases were not preserved/);
    });

    await t.test('throws on integrity check failure in apply mode', async () => {
        process.env.CONTROL_PLANE_STATE_FILE = '/mock/legacy.json';
        process.argv.push('--apply');
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (f) => {
                    if (f.endsWith('legacy.json')) return '{"projects": []}';
                    return '';
                }
            }
        });
        const mockDb = {
            prepare: () => ({ get: () => ({ integrity_check: 'fail' }) }),
            close: () => {}
        };
        mock.module('../../lib/sqlite-state.js', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                openSqliteState: async () => mockDb,
                loadSqliteState: () => ({ approvals: [], projects: [], organizations: [], teams: [] })
            }
        });
        await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /Migrated SQLite database failed integrity verification/);
    });
});
