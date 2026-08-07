import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../scripts/deploy-release.js', import.meta.url));

mock.module('child_process', {
  namedExports: {
    execFileSync: (cmd, args) => {
      console.log("MOCKED EXEC:", cmd);
      return '123\n';
    }
  }
});

mock.module('fs', {
  namedExports: {
    mkdirSync: () => {},
    chownSync: () => {},
    chmodSync: () => {}
  }
});

test('mock module', async (t) => {
  const originalArgv = [...process.argv];
  process.argv = ['node', SCRIPT_PATH, 'prepare'];
  await import(`${SCRIPT_PATH}?t=${Date.now()}`);
  process.argv = originalArgv;
});
