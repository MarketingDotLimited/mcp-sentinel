const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');

const toAdd = `
    fsSync.mkdirSync('/tmp/myrepo/foo', { recursive: true });
`;

text = text.replace(
  "await handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'project.test',",
  toAdd + "await handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'project.test',"
);

fs.writeFileSync('tests/broker-missing.test.js', text);
