import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import fs from 'node:fs';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/merge-coverage.js', import.meta.url));

test('merge-coverage.js', async (t) => {
    let warnings = [];
    let logs = [];
    
    t.mock.method(console, 'warn', (msg) => { warnings.push(msg); });
    t.mock.method(console, 'log', (msg) => { logs.push(msg); });

    t.afterEach(() => {
        warnings = [];
        logs = [];
        mock.reset();
    });

    await t.test('merges when both files exist', async (t) => {
        let merges = [];
        t.mock.method(fs, 'existsSync', () => true);
        t.mock.method(fs, 'readFileSync', (file) => {
            if (file.includes('node/coverage-final.json')) return '{"node": true}';
            if (file.includes('browser/istanbul/coverage.json')) return '{"browser": true}';
            return '{}';
        });

        const mockMap = { merge: (cov) => { merges.push(cov); } };
        mock.module('istanbul-lib-coverage', {
            get namedExports() { return this.defaultExport; }, defaultExport: { createCoverageMap: () => mockMap }
        });

        mock.module('istanbul-lib-report', {
            get namedExports() { return this.defaultExport; }, defaultExport: { createContext: () => ({}) }
        });

        let executedReports = [];
        mock.module('istanbul-reports', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                create: (type) => ({ execute: () => { executedReports.push(type); } })
            }
        });

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        
        assert.deepEqual(merges, [{ node: true }, { browser: true }]);
        assert.deepEqual(executedReports, ['json', 'json-summary', 'lcov', 'text', 'html']);
        assert.ok(logs.includes('Coverage merged successfully into coverage/merged'));
        assert.equal(warnings.length, 0);
    });

    await t.test('warns when files are missing', async (t) => {
        t.mock.method(fs, 'existsSync', () => false);
        t.mock.method(fs, 'readFileSync', () => '{}');

        const mockMap = { merge: () => {} };
        mock.module('istanbul-lib-coverage', {
            get namedExports() { return this.defaultExport; }, defaultExport: { createCoverageMap: () => mockMap }
        });

        mock.module('istanbul-lib-report', {
            get namedExports() { return this.defaultExport; }, defaultExport: { createContext: () => ({}) }
        });

        mock.module('istanbul-reports', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                create: () => ({ execute: () => {} })
            }
        });

        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        
        assert.ok(warnings.some(w => w.includes('Node coverage not found')));
        assert.ok(warnings.some(w => w.includes('Browser coverage not found')));
    });
});
