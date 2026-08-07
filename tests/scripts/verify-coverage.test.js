import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/verify-coverage.js', import.meta.url));

test('verify-coverage.js', async (t) => {
    let exitCode = undefined;
    const logs = [];
    const errors = [];
    
    t.mock.method(process, 'exit', (code) => { exitCode = code; });
    t.mock.method(console, 'log', (msg) => { logs.push(msg); });
    t.mock.method(console, 'error', (msg, ...args) => { errors.push(msg, ...args); });

    t.afterEach(() => {
        exitCode = undefined;
        logs.length = 0;
        errors.length = 0;
        mock.reset();
    });

    await t.test('fails if coverage summary not found', async (t) => {
        mock.module('node:fs', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                existsSync: () => false,
                readFileSync: () => '{}'
            }
        });
        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        assert.equal(exitCode, 1);
        assert.ok(errors.includes('Coverage summary not found!'));
    });

    await t.test('passes if all metrics are 100%', async (t) => {
        mock.module('node:fs', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                existsSync: () => true,
                readFileSync: () => JSON.stringify({
                    total: { lines: { pct: 100 }, statements: { pct: 100 }, functions: { pct: 100 }, branches: { pct: 100 } },
                    'file.js': { lines: { pct: 100 }, statements: { pct: 100 }, functions: { pct: 100 }, branches: { pct: 100 } }
                })
            }
        });
        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        assert.equal(exitCode, undefined);
        assert.ok(logs.includes('Coverage verification passed.'));
    });

    await t.test('fails if any metric is < 100%', async (t) => {
        mock.module('node:fs', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                existsSync: () => true,
                readFileSync: () => JSON.stringify({
                    total: { lines: { pct: 100 }, statements: { pct: 100 }, functions: { pct: 100 }, branches: { pct: 100 } },
                    'file.js': { lines: { pct: 99 }, statements: { pct: 100 }, functions: { pct: 100 }, branches: { pct: 100 } }
                })
            }
        });
        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        assert.equal(exitCode, 1);
        assert.ok(errors.includes('Coverage failed for file.js'));
        assert.ok(errors.includes('Coverage threshold of 100% not met.'));
    });
});
