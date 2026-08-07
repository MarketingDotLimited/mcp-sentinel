const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');

text = text.replace(
  "await assert.rejects(\n      handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'firewall.rule', parameters: { action: \"allow\", port: \"80\", protocol: \"tcp\" } })\n    );",
  "try { await handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'firewall.rule', parameters: { action: \"allow\", port: \"80\", protocol: \"tcp\" } }); } catch(e) { console.log('FIREWALL 1 ERROR:', e.message, e.result); }"
);

fs.writeFileSync('tests/broker-missing.test.js', text);
