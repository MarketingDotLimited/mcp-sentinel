import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/deploy-release.js', import.meta.url));

const fsMock = {
  mkdirSync: mock.fn(),
  chownSync: mock.fn(),
  chmodSync: mock.fn(),
  lstatSync: mock.fn(),
  readFileSync: mock.fn(),
  existsSync: mock.fn(),
};

mock.module('fs', { defaultExport: fsMock, namedExports: { constants: { COPYFILE_EXCL: 1 } } });

mock.module('child_process', {
  namedExports: {
    execFileSync: mock.fn((cmd, args) => {
      return '123\n';
    })
  }
});

test('mock module fs', async (t) => {
  const originalArgv = [...process.argv];
  process.argv = ['node', SCRIPT_PATH, 'prepare'];
  await import(`${SCRIPT_PATH}?t=${Date.now()}`);
  process.argv = originalArgv;
});
