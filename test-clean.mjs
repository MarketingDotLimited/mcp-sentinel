import path from 'path';
import fs from 'fs';

const directory = path.join(process.cwd(), 'cov_tmp3');
const fakeBin = path.join(directory, 'bin');
process.env.PATH = fakeBin + ':' + process.env.PATH;
process.env.BROKER_FIREWALL_PORTS = '80';
process.env.BROKER_FIREWALL_SNAPSHOT_ROOT = path.join(directory, 'snapshots');
fs.mkdirSync('/etc/ufw', { recursive: true });

const { handleRequest } = await import('./broker.js');
try {
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'firewall.rule',
    parameters: { action: 'allow', port: '80', protocol: 'tcp' },
  });
} catch (e) {
  console.log('CAUGHT', e.message, e.result);
}
