const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');

text = text.replace(/await handleRequest\(\s*handleRequest/g, 'await assert.rejects(\n      handleRequest');
text = text.replace(/await handleRequest\(handleRequest/g, 'await assert.rejects(handleRequest');
text = text.replace(/handleRequestFw\(\{/g, 'handleRequestFw({\n');
text = text.replace(/await handleRequest\(\s*handleRequestFw/g, 'await assert.rejects(\n      handleRequestFw');

// Fix the ends
text = text.replace(/    ;\n/g, '    );\n');
text = text.replace(/} }\n    ;/g, '} })\n    ;');

// We also need to fix project.cancel
text = text.replace(/await assert.rejects\(\n      handleRequest\(\{ requestId: '11111111-1111-4111-8111-111111111111', operation: 'project.cancel'/g, 'await handleRequest({ requestId: "11111111-1111-4111-8111-111111111111", operation: "project.cancel"');

fs.writeFileSync('tests/broker-missing.test.js', text);
