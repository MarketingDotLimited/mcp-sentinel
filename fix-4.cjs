const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');
const toAdd = `
    await handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'project.test', parameters: { projectId: '22222222-2222-4222-8222-222222222222', runId: '11111111-1111-4111-8111-111111111111', framework: 'node' } });
`;
const idx = text.indexOf('// 1000 project read missing');
text = text.slice(0, idx) + toAdd + text.slice(idx);
fs.writeFileSync('tests/broker-missing.test.js', text);
