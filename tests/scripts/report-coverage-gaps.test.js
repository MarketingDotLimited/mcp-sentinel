import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/report-coverage-gaps.mjs', import.meta.url));

test('report-coverage-gaps.mjs', async (t) => {
    let logs = [];
    let warns = [];
    let writtenFiles = {};

    t.mock.method(console, 'log', (msg) => { logs.push(msg); });
    t.mock.method(console, 'warn', (msg, err) => { warns.push(`${msg} ${err}`); });

    t.afterEach(() => {
        logs = [];
        warns = [];
        writtenFiles = {};
        mock.reset();
    });

    await t.test('reports gaps correctly', async (t) => {
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => JSON.stringify({
                    total: { lines: { pct: 50 }, branches: { pct: 50 }, branches: { pct: 50 } },
                    '/mock/file1.js': { lines: { pct: 90, skipped: 1 }, branches: { pct: 100 } },
                    '/mock/file2.js': { lines: { pct: 100 }, branches: { pct: 80 } },
                    '/mock/file3.js': { lines: { pct: 100 }, branches: { pct: 100 } },
                    '/mock/file4.js': {}
                }),
                writeFile: async (file, data) => { writtenFiles[file] = data; },
                mkdir: async () => {}
            }
        });

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);

        assert.ok(logs.some(l => typeof l === 'string' && l.includes('Files below 100% threshold: 2')));
        const gapReport = Object.values(writtenFiles)[0];
        assert.ok(gapReport);
        const gaps = JSON.parse(gapReport);
        assert.equal(gaps.length, 2);
    });

    await t.test('reports 100% achieved', async (t) => {
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => JSON.stringify({
                    total: { lines: { pct: 100 }, branches: { pct: 100 }, branches: { pct: 100 } },
                    '/mock/file1.js': { lines: { pct: 100 }, branches: { pct: 100 } }
                }),
                writeFile: async (file, data) => { writtenFiles[file] = data; },
                mkdir: async () => {}
            }
        });

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);

        assert.ok(logs.some(l => typeof l === 'string' && l.includes('100% per-file coverage achieved')));
    });

    await t.test('handles missing summary file', async (t) => {
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => { throw new Error('ENOENT'); }
            }
        });

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);

        assert.ok(warns.some(w => w.includes('Could not read coverage-summary.json: ENOENT')));
    });
});
