import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/verify-coverage-scope.mjs', import.meta.url));

test('verify-coverage-scope.mjs', async t => {
  let logs = [];
  let errors = [];
  let exitCode = undefined;
  let writtenFiles = {};

  t.mock.method(console, 'log', msg => {
    logs.push(msg);
  });
  t.mock.method(console, 'error', (msg, ...args) => {
    errors.push([msg, ...args].join(' '));
  });
  t.mock.method(process, 'exit', code => {
    exitCode = code;
  });

  t.afterEach(() => {
    logs = [];
    errors = [];
    exitCode = undefined;
    writtenFiles = {};
    mock.reset();
  });

  await t.test('passes when config is valid', async t => {
    mock.module('node:fs/promises', {
      get namedExports() {
        return this.defaultExport;
      },
      defaultExport: {
        readFile: async file => {
          if (file.endsWith('.c8rc')) {
            return JSON.stringify({
              'per-file': true,
              statements: 100,
              branches: 100,
              functions: 100,
              lines: 100,
              include: ['lib/**', 'routes/**', 'tools/**', 'scripts/**', 'public/js/**'],
              exclude: [],
            });
          }
          if (file.endsWith('executable-code-inventory.json')) {
            return '{}';
          }
          return '';
        },
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);

    assert.equal(exitCode, undefined);
    assert.ok(logs.some(l => l.includes('Coverage scope verification passed')));
    const report = JSON.parse(Object.values(writtenFiles)[0]);
    assert.equal(report.scopeComplete, true);
  });

  await t.test('fails when missing patterns', async t => {
    mock.module('node:fs/promises', {
      get namedExports() {
        return this.defaultExport;
      },
      defaultExport: {
        readFile: async file => {
          if (file.endsWith('.c8rc')) {
            return JSON.stringify({
              'per-file': true,
              statements: 100,
              branches: 100,
              functions: 100,
              lines: 100,
              include: ['lib/**'], // Missing others
              exclude: [],
            });
          }
          return '{}';
        },
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);

    assert.equal(exitCode, 1);
    assert.ok(errors.some(e => e.includes('Coverage scope verification failed!')));
  });

  await t.test('fails when file read throws', async t => {
    mock.module('node:fs/promises', {
      get namedExports() {
        return this.defaultExport;
      },
      defaultExport: {
        readFile: async () => {
          throw new Error('mock read error');
        },
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);

    assert.equal(exitCode, 1);
    assert.ok(errors.some(e => e.includes('mock read error')));
  });
});
