import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';

const directory = path.join(process.cwd(), 'cov_tmp2');
fs.mkdirSync(directory, { recursive: true });
const fakeBin = path.join(directory, 'bin');
fs.mkdirSync(fakeBin, { recursive: true });

const fakeCommand = path.join(fakeBin, 'ufw');
fs.writeFileSync(fakeCommand, `#!/usr/bin/env node
const name = process.argv[1].split('/').pop();
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.cwd(), 'cov_tmp2', 'fake.log'), name + ' ' + args.join(' ') + '\n');
if (name === 'ufw') process.exit(1); // ALWAYS FAIL UFW
if (name === 'systemctl' && args.includes('start')) {
  console.log("SYSTEMCTL START CALLED");
  process.exit(1);
}
if (name === 'systemd-run') process.exit(0); // ALWAYS SUCCEED
process.exit(0);
`, { mode: 0o777 });

for (const name of ['systemctl', 'systemd-run']) {
  try { fs.symlinkSync(fakeCommand, path.join(fakeBin, name)); } catch {}
}

process.env.PATH = fakeBin + ':' + process.env.PATH;
process.env.BROKER_FIREWALL_PORTS = '80';
process.env.BROKER_FIREWALL_SNAPSHOT_ROOT = path.join(directory, 'snapshots');
fs.mkdirSync('/etc/ufw', { recursive: true });

const { handleRequest } = await import('./broker.js');
try {
  await handleRequest({ requestId: "11111111-1111-4111-8111-111111111111", operation: "firewall.rule", parameters: { action: "allow", port: "80", protocol: "tcp" } });
} catch (e) {
  console.log("CAUGHT", e.message, e.result);
}
