import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/generate-user-needs-docs.mjs', import.meta.url));

test('generate-user-needs-docs.mjs', async t => {
  let exitCode = undefined;
  let writtenFiles = {};
  let logs = [];
  let errors = [];

  t.mock.method(process, 'exit', code => {
    exitCode = code;
  });
  t.mock.method(console, 'log', msg => {
    logs.push(msg);
  });
  t.mock.method(console, 'error', msg => {
    errors.push(msg);
  });

  t.afterEach(() => {
    exitCode = undefined;
    writtenFiles = {};
    logs = [];
    errors = [];
    mock.reset();
  });

  await t.test('generates docs correctly', async t => {
    mock.module('node:fs/promises', {
      get namedExports() {
        return this.defaultExport;
      },
      defaultExport: {
        readFile: async () =>
          JSON.stringify({
            personas: [
              {
                name: 'Admin',
                needs: [
                  { id: '1', status: 'fully_met', gap: 'none' },
                  { id: '2', status: 'partially_met' },
                  { id: '3', status: 'not_met' },
                  { id: '4', status: 'cannot_be_automatically_validated' },
                ],
              },
            ],
            gaps: [{ id: 'g1', need: 'n', severity: 'HIGH', impact: 'huge', solution: 'solve it' }],
          }),
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);
    assert.equal(exitCode, undefined);
    assert.ok(logs.some(l => l.includes('Generated')));
    assert.ok(Object.keys(writtenFiles).some(f => f.endsWith('.md')));
    assert.ok(Object.keys(writtenFiles).some(f => f.endsWith('.json')));
  });

  await t.test('handles script errors', async t => {
    mock.module('node:fs/promises', {
      get namedExports() {
        return this.defaultExport;
      },
      defaultExport: {
        readFile: async () => {
          throw new Error('mock err');
        },
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);
    assert.equal(exitCode, 1);
    assert.equal(errors[0].message, 'mock err');
  });
});
