import "../test-env.js";
import test from 'node:test';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTROL_PLANE_JS = path.join(__dirname, "../../lib/control-plane.js");

test('control-plane.js sqlite branches', () => {
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      process.env.USE_LEGACY_JSON = 'false';
      process.env.MCP_STATE_DB = '/tmp/mcp-test-db.sqlite3';
      const cp = await import(${JSON.stringify('file://' + CONTROL_PLANE_JS)});
      await cp.persistTaskRun({ id: 'test-run-1', status: 'running' }).catch(() => {});
      const admin = { userId: 'admin', role: 'admin' };
      await cp.adminSetSshAccess({ targetType: 'global', sshAllowed: true, confirm: true }, admin);
    `,
  ]);
});
