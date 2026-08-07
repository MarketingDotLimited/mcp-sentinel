import path from 'path';
import fs from 'fs';

const directory = path.join(process.cwd(), 'cov_tmp2');
const fakeBin = path.join(directory, 'bin');
process.env.PATH = fakeBin + ':' + process.env.PATH;
process.env.BROKER_FIREWALL_PORTS = '80';
process.env.BROKER_FIREWALL_SNAPSHOT_ROOT = path.join(directory, 'snapshots');

const { handleRequest } = await import('./broker.js');
try {
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'firewall.rule',
    parameters: { action: 'allow', port: '80', protocol: 'tcp' },
  });
} catch (e) {
  // Check if systemctl was called
  const logs = fs.readFileSync(path.join(directory, 'fake.log'), 'utf8');
  console.log('FAKE LOG:', logs);
}
