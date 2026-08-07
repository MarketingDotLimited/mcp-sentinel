import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import fs from 'node:fs/promises';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/register-node-project.js', import.meta.url));

test('register-node-project.js', async (t) => {
    let stdoutWrites = [];
    let stderrWrites = [];
    let exitCode = undefined;
    const originalEnv = { ...process.env };
    const originalArgv = [...process.argv];

    t.mock.method(process.stdout, 'write', (data) => { stdoutWrites.push(data); });
    t.mock.method(process.stderr, 'write', (data) => { stderrWrites.push(data); });

    t.afterEach(() => {
        stdoutWrites = [];
        stderrWrites = [];
        exitCode = undefined;
        process.env = { ...originalEnv };
        process.argv = [...originalArgv];
        mock.reset();
    });

    await t.test('validateNodeProject validates input', async (t) => {
        let cpExecMock = '1000';
        mock.module('node:child_process', {
            get namedExports() { return this.defaultExport; }, defaultExport: { execFileSync: () => cpExecMock }
        });
        const module = await import(SCRIPT_PATH + '?t=' + Date.now());
        await assert.rejects(() => module.validateNodeProject(null), /Project record must be an object/);
        await assert.rejects(() => module.validateNodeProject({}), /Project ID must be a UUID/);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: ''}), /Invalid project name/);
        
        mock.method(fs, 'realpath', async (p) => p);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/b'}), /Project repository must be inside its root/);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'root'}), /Project execution user must be non-root/);
        
        cpExecMock = '0';
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user'}), /Project execution user must resolve to a non-root UID/);
        
        cpExecMock = '1000';
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user', permittedTasks: ['invalid']}), /Project contains an invalid task recipe/);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user', permittedTasks: ['npm'], permittedGitActions: ['invalid']}), /Project contains an invalid Git recipe/);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user', permittedTasks: ['npm'], permittedGitActions: ['status'], testNetworkHosts: ['not-an-ip']}), /Project test network dependencies must be explicit IP addresses/);

        // Valid
        const res = await module.validateNodeProject({
            id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a/b', runAsUser: 'user', permittedTasks: ['npm'], permittedGitActions: ['status'], testNetworkHosts: ['127.0.0.1'], environment: 'development', protectedPaths: ['/x'], allowRecursiveDelete: true
        });
        assert.equal(res.id, '00000000-0000-1000-8000-000000000000');
    });

    await t.test('main() missing project', async () => {
        process.argv = ['node', 'scripts/register-node-project.js'];
        const { main } = await import(`${SCRIPT_PATH}?t=${Date.now()}`);
try { await main(); } catch(e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
        assert.ok(stderrWrites.some(w => w.includes('--project must reference a protected JSON')));
        assert.equal(process.exitCode, 1);
        process.exitCode = 0;
    });

    await t.test('main() dry-run', async () => {
        process.argv = ['node', 'scripts/register-node-project.js', '--project', '/mock/project.json'];
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => JSON.stringify({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user', permittedTasks: ['npm']}),
                realpath: async (p) => p
            }
        });
        mock.module('node:child_process', {
            get namedExports() { return this.defaultExport; }, defaultExport: { execFileSync: () => '1000' }
        });
        const { main } = await import(`${SCRIPT_PATH}?t=${Date.now()}`);
try { await main(); } catch(e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
        assert.ok(stdoutWrites.some(w => w.includes('"mode": "dry-run"')));
    });

    await t.test('main() apply requires confirm', async () => {
        process.argv = ['node', 'scripts/register-node-project.js', '--project', '/mock/project.json', '--apply'];
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => JSON.stringify({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user', permittedTasks: ['npm']}),
                realpath: async (p) => p
            }
        });
        mock.module('node:child_process', {
            get namedExports() { return this.defaultExport; }, defaultExport: { execFileSync: () => '1000' }
        });
        const { main } = await import(`${SCRIPT_PATH}?t=${Date.now()}`);
try { await main(); } catch(e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
        assert.ok(stderrWrites.some(w => w.includes('--apply requires --confirm')));
        process.exitCode = 0;
    });

    await t.test('main() apply creates entry', async () => {
        process.argv = ['node', 'scripts/register-node-project.js', '--project', '/mock/project.json', '--apply', '--confirm'];
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => JSON.stringify({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user', permittedTasks: ['npm']}),
                realpath: async (p) => p
            }
        });
        mock.module('node:child_process', {
            get namedExports() { return this.defaultExport; }, defaultExport: { execFileSync: () => '1000' }
        });
        
        const dbFile = '/tmp/mock-sqlite-' + Date.now() + '.sqlite3';
        const sqlite = await import('node:sqlite');
        const db = new sqlite.DatabaseSync(dbFile);
        db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT)");
        db.close();
        process.env.MCP_STATE_DB = dbFile;

        const { main } = await import(`${SCRIPT_PATH}?t=${Date.now()}`);
try { await main(); } catch(e) { process.stderr.write(e.message + '\n'); process.exitCode = 1; }
        assert.ok(stdoutWrites.some(w => w.includes('"mode":"applied"')));
    });
});
