import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import child_process from 'child_process';
import { fileURLToPath } from 'url';
const SCRIPT_PATH = fileURLToPath(new URL('../scripts/deploy-release.js', import.meta.url));

test('mock', async (t) => {
  let calls = [];
  t.mock.method(child_process, 'execFileSync', (cmd, args) => {
    calls.push(cmd);
    return '0\n';
  });
  process.argv = ['node', SCRIPT_PATH, 'prepare'];
  await import(`${SCRIPT_PATH}?t=${Date.now()}`);
  console.log("CALLS:", calls);
});
