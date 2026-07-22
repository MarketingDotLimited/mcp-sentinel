import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const id = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(id || '')) throw new Error('Invalid firewall rollback ID');
const root = process.env.BROKER_FIREWALL_SNAPSHOT_ROOT || '/var/lib/mcp-sentinel/firewall-snapshots';
const snapshot = path.join(root, id);
const target = '/etc/ufw';
const stat = fs.lstatSync(snapshot);
if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid firewall snapshot');

fs.cpSync(snapshot, target, { recursive: true, dereference: false, force: true });
execFileSync('/usr/sbin/ufw', ['reload'], { timeout: 30_000, stdio: 'inherit' });
fs.rmSync(snapshot, { recursive: true, force: true });
