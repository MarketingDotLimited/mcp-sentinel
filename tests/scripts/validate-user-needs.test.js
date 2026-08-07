import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import path from 'path';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/validate-user-needs.mjs', import.meta.url));

test('validate-user-needs.mjs', async (t) => {
    let exitCode = undefined;
    const errors = [];
    const logs = [];

    t.mock.method(process, 'exit', (code) => { exitCode = code; });
    t.mock.method(console, 'error', (msg) => { errors.push(msg); });
    t.mock.method(console, 'log', (msg) => { logs.push(msg); });

    t.afterEach(() => {
        exitCode = undefined;
        errors.length = 0;
        logs.length = 0;
        mock.reset();
    });

    await t.test('passes when counts match', async (t) => {
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (file) => {
                    if (file.includes('.json')) {
                        return JSON.stringify({ personas: Array(7).fill({ needs: ['a', 'b'] }) });
                    }
                    if (file.includes('.md')) {
                        return 'Total user needs identified**: 14';
                    }
                    return '';
                }
            }
        });
        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        assert.equal(exitCode, undefined);
        assert.ok(logs.includes('✅ User needs matrix reconciliation validated successfully.'));
    });

    await t.test('fails when persona count mismatch', async (t) => {
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (file) => {
                    if (file.includes('.json')) {
                        return JSON.stringify({ personas: Array(6).fill({ needs: [] }) });
                    }
                    return '';
                }
            }
        });
        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        assert.equal(exitCode, 1);
        assert.ok(errors.includes('❌ Persona count mismatch: expected 7, got 6'));
    });

    await t.test('fails when markdown summary out of sync', async (t) => {
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async (file) => {
                    if (file.includes('.json')) {
                        return JSON.stringify({ personas: Array(7).fill({ needs: ['a'] }) });
                    }
                    if (file.includes('.md')) {
                        return 'Total user needs identified**: 99';
                    }
                    return '';
                }
            }
        });
        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        assert.equal(exitCode, 1);
        assert.ok(errors.includes('❌ Markdown summary out of sync with user-needs-coverage.json!'));
    });

    await t.test('fails when read throws', async (t) => {
        mock.module('node:fs/promises', {
            get namedExports() { return this.defaultExport; }, defaultExport: {
                readFile: async () => { throw new Error('mock read error'); }
            }
        });
        await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        assert.equal(exitCode, 1);
        assert.equal(errors[0].message, 'mock read error');
    });
});
