import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/run-mutation-test.mjs', import.meta.url));

test('run-mutation-test.mjs', async t => {
  let exitCode = undefined;
  let writtenFiles = {};
  let execCalls = 0;
  let execShouldThrow = false;
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
    execCalls = 0;
    execShouldThrow = false;
    logs = [];
    errors = [];
    mock.reset();
  });

  await t.test('all mutants killed (100% score)', async t => {
    mock.module('node:fs/promises', {
      namedExports: {
        readFile: async () => {
          console.log('MOCKED_READ_FILE');
          return 'const a === b; return true;';
        },
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
      defaultExport: {
        readFile: async () => {
          console.log('MOCKED_READ_FILE');
          return 'const a === b; return true;';
        },
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
    });

    mock.module('node:child_process', {
      namedExports: {
        execSync: () => {
          execCalls++;
          throw new Error('test failed'); // mutant killed
        },
      },
      defaultExport: {
        execSync: () => {
          execCalls++;
          throw new Error('test failed'); // mutant killed
        },
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);

    process.stdout.write('\n\nLOGS: ' + JSON.stringify(logs) + '\n\n');
    assert.equal(exitCode, undefined);
    assert.ok(logs.some(l => l.includes('100% score')));
    assert.equal(execCalls, 8); // 4 files * 2 matches each
  });

  await t.test('no mutants (100% score)', async t => {
    mock.module('node:fs/promises', {
      namedExports: {
        readFile: async () => 'no match',
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
      defaultExport: {
        readFile: async () => 'no match',
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
    });

    mock.module('node:child_process', {
      namedExports: {
        execSync: () => {
          execCalls++;
        },
      },
      defaultExport: {
        execSync: () => {
          execCalls++;
        },
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);

    process.stdout.write('\n\nLOGS: ' + JSON.stringify(logs) + '\n\n');
    assert.equal(exitCode, undefined);
    assert.ok(logs.some(l => l.includes('100% score')));
    assert.equal(execCalls, 0);
  });

  await t.test('mutants survive (score < 95%)', async t => {
    mock.module('node:fs/promises', {
      namedExports: {
        readFile: async () => 'const a === b; return true;',
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
      defaultExport: {
        readFile: async () => 'const a === b; return true;',
        writeFile: async (file, data) => {
          writtenFiles[file] = data;
        },
        mkdir: async () => {},
      },
    });

    mock.module('node:child_process', {
      namedExports: {
        execSync: () => {
          execCalls++;
          // Tests pass, meaning mutant survived
        },
      },
      defaultExport: {
        execSync: () => {
          execCalls++;
          // Tests pass, meaning mutant survived
        },
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);

    assert.equal(exitCode, 1);
    assert.ok(errors.some(e => typeof e === 'string' && e.includes('below required threshold')));
  });

  await t.test('throws on unhandled exception', async t => {
    mock.module('node:fs/promises', {
      namedExports: {
        readFile: async () => {
          throw new Error('file read error');
        },
      },
      defaultExport: {
        readFile: async () => {
          throw new Error('file read error');
        },
      },
    });

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);

    assert.equal(exitCode, 1);
    assert.equal(errors[0].message, 'file read error');
  });
});
