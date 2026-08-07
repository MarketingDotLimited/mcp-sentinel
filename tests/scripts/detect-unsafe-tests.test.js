import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import path from 'path';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/detect-unsafe-tests.mjs', import.meta.url));

test('detect-unsafe-tests.mjs', async t => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];
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
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    exitCode = undefined;
    writtenFiles = {};
    logs = [];
    errors = [];
    mock.reset();
  });

  await t.test('passes when no unsafe patterns', async t => {
    mock.module('node:fs/promises', {
      get namedExports() {
        return this.defaultExport;
      },
      defaultExport: {
        readdir: async () => [{ name: 'safe.test.js', isDirectory: () => false }],
        readFile: async () => 'const x = 1;\n',
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);
    assert.equal(exitCode, undefined);
    assert.ok(logs.some(l => l.includes('Found 0 findings')));
  });

  await t.test('fails when process.exit is used', async t => {
    mock.module('node:fs/promises', {
      get namedExports() {
        return this.defaultExport;
      },
      defaultExport: {
        readdir: async dir => {
          if (dir.endsWith('tests')) return [{ name: 'sub', isDirectory: () => true }];
          return [{ name: 'unsafe.test.js', isDirectory: () => false }];
        },
        readFile: async () => 'process.' + 'exit(1);\n',
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);
    assert.equal(exitCode, 1);
    assert.ok(errors.includes('❌ Test integrity audit failed!'));
  });

  await t.test('detects skip and only and empty catch', async t => {
    mock.module('node:fs/promises', {
      get namedExports() {
        return this.defaultExport;
      },
      defaultExport: {
        readdir: async () => [{ name: 'bad.test.js', isDirectory: () => false }],
        readFile: async () =>
          'it.' +
          'skip("test", () => {});\ntest.' +
          'only("x", () => {});\ntry { } catch(e) { }\ntry { fs.rm() } catch(e) { }\n',
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);
    assert.equal(exitCode, 1);
    const report = JSON.parse(Object.values(writtenFiles)[0]);
    assert.equal(report.length, 3);
  });

  await t.test('handles script errors', async t => {
    mock.module('node:fs/promises', {
      get namedExports() {
        return this.defaultExport;
      },
      defaultExport: {
        readdir: async () => {
          throw new Error('mock err');
        },
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);
    assert.equal(exitCode, 1);
    assert.equal(errors[0].message, 'mock err');
  });
});
