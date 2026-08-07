import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const tmp = fs.mkdtempSync('/tmp/preflight-');
process.env.MCP_PREFLIGHT_ROOT = tmp;

fs.mkdirSync(path.join(tmp, 'etc'));
fs.writeFileSync(path.join(tmp, 'etc/passwd'), 'mcp-sentinel:x:999:999::/var/lib/mcp-sentinel:/usr/sbin/nologin\n');

import { runPreflight } from '../scripts/production-preflight.js';

try {
  console.log(runPreflight());
} catch(e) {
  console.error(e);
}
