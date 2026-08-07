const fs = require('fs');
const content = fs.readFileSync('tests/broker-missing.test.js', 'utf8');

// Add service.list and project.cancel tests
const toAdd = `
    await assert.rejects(
      handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'service.list', parameters: { state: 'invalid@state' } }),
      /Invalid service state/
    );
    await assert.rejects(
      handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'project.cancel', parameters: { runId: '11111111-1111-4111-8111-111111111111' } })
    );
`;
const idx = content.indexOf('// 1000 project read missing');
fs.writeFileSync('tests/broker-missing.test.js', content.slice(0, idx) + toAdd + content.slice(idx));
