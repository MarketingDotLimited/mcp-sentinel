import fs from 'fs';
import path from 'path';

const tmp = fs.mkdtempSync('/tmp/preflight-');
process.env.MCP_PREFLIGHT_ROOT = tmp;

fs.mkdirSync(path.join(tmp, 'etc'));
fs.writeFileSync(path.join(tmp, 'etc/passwd'), 'mcp-sentinel:x:999:999::/var/lib/mcp-sentinel:/usr/sbin/nologin\n');

const { runPreflight } = await import('../scripts/production-preflight.js?t=' + Date.now());

try {
  console.log(runPreflight());
} catch(e) {
  console.error(e);
}
