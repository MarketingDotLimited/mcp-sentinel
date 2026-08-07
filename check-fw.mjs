import path from 'path';
import fs from 'fs';
process.env.BROKER_FIREWALL_PORTS = '80';
process.env.PATH = '/bin:/usr/bin';
const { handleRequest } = await import('./broker.js?v=fw123');
try {
  await handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'firewall.rule', parameters: { action: "allow", port: "80", protocol: "tcp" } });
  console.log("SUCCEEDED");
} catch (e) {
  console.log("FAILED WITH", e);
}
