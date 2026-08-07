import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/export-legacy-state.js', import.meta.url));

test('export-legacy-state.js', async (t) => {
    const originalEnv = { ...process.env };
    const originalArgv = [...process.argv];
    let stdoutWrites = [];
    let writtenFiles = {};

    t.mock.method(process.stdout, 'write', (data) => { stdoutWrites.push(data); });

    t.afterEach(() => {
        process.env = { ...originalEnv };
        process.argv = [...originalArgv];
        stdoutWrites = [];
        writtenFiles = {};
        mock.reset();
    });

    await t.test('throws if offline env not set', async () => {
        delete process.env.MCP_LEGACY_EXPORT_OFFLINE;
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Legacy export requires MCP_LEGACY_EXPORT_OFFLINE=true/
        );
    });

    await t.test('throws if argv[2] not provided', async () => {
        process.env.MCP_LEGACY_EXPORT_OFFLINE = 'true';
        process.argv.length = 2; // only node and script
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Usage:/
        );
    });

    await t.test('throws if argv[2] outside root', async () => {
        process.env.MCP_LEGACY_EXPORT_OFFLINE = 'true';
        process.env.MCP_LEGACY_EXPORT_DIR = '/mock/root';
        process.argv[2] = '/mock/bad/export.json';
        await assert.rejects(
            () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
            /Legacy export must be a JSON file inside/
        );
    });

    await t.test('exports from legacy JSON', async (t) => {
        process.env.MCP_LEGACY_EXPORT_OFFLINE = 'true';
        process.env.MCP_LEGACY_EXPORT_DIR = '/mock/root';
        process.env.MCP_LEGACY_JSON_FILE = '/mock/legacy.json';
        process.argv[2] = '/mock/root/export.json';
        
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                mkdir: async () => {},
                readFile: async (f) => {
                    if (f.endsWith('legacy.json')) return JSON.stringify({
                        automations: [{ token: 'abc' }, { other: [ { password: 'xyz' } ] }]
                    });
                    if (f.endsWith('export.json')) return Object.values(writtenFiles)[0];
                    return '';
                },
                writeFile: async (f, data) => { writtenFiles[f] = data; },
                rename: async () => {},
                chmod: async () => {}
            }
        });

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        stdoutWrites = stdoutWrites.filter(w => typeof w === 'string');
        const output = JSON.parse(stdoutWrites[0]);
        assert.equal(output.verified, true);
        assert.equal(output.counts.automations, 2);
    });

    await t.test('exports from sqlite', async (t) => {
        process.env.MCP_LEGACY_EXPORT_OFFLINE = 'true';
        process.env.MCP_LEGACY_EXPORT_DIR = '/mock/root';
        delete process.env.MCP_LEGACY_JSON_FILE;
        process.argv[2] = '/mock/root/export.json';
        
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                mkdir: async () => {},
                readFile: async (f) => {
                    if (f.endsWith('export.json')) return Object.values(writtenFiles)[0];
                    return '';
                },
                writeFile: async (f, data) => { writtenFiles[f] = data; },
                rename: async () => {},
                chmod: async () => {}
            }
        });

        const dbFile = '/tmp/mock-sqlite-' + Date.now() + '.sqlite3';
        const sqlite = await import('node:sqlite');
        const db = new sqlite.DatabaseSync(dbFile);
        db.exec("CREATE TABLE automations (id INTEGER PRIMARY KEY, payload TEXT, updated_at TEXT)");
        db.prepare("INSERT INTO automations (payload) VALUES (?)").run('{"foo":"bar"}');
        db.close();
        process.env.MCP_STATE_DB = dbFile;
        
        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        stdoutWrites = stdoutWrites.filter(w => typeof w === 'string');
        const output = JSON.parse(stdoutWrites[0]);
        assert.equal(output.verified, true);
        assert.equal(output.counts.automations, 1);
    });
});
