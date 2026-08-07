import "../test-env.js";
import test from 'node:test';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTROL_PLANE_JS = path.join(__dirname, "../../lib/control-plane.js");

test('control-plane.js loadState EACCES', () => {
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    `
      import fs from 'fs';
      const file = '/tmp/mcp-test-unreadable.json';
      fs.writeFileSync(file, '{}');
      fs.chmodSync(file, 0o000);
      process.env.MCP_STATE_DB = '';
      process.env.MCP_STATE_FILE = file;
      const cp = await import(${JSON.stringify('file://' + CONTROL_PLANE_JS)});
      try {
        await cp.listSshAccessPolicies({ role: "admin" });
      } catch (err) {
        if (err.code !== 'EACCES') {
          console.error('Unexpected error:', err);
          throw err;
        }
      }
      fs.chmodSync(file, 0o644);
      fs.unlinkSync(file);
    `,
  ]);
});
