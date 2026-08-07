import { handleRequest } from './broker.js';
import assert from 'node:assert/strict';
try {
  await handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'firewall.rule', parameters: { action: 'allow', port: '80', protocol: 'tcp' } });
  console.log("SUCCEEDED");
} catch(e) {
  console.log("FAILED", e.message);
}
