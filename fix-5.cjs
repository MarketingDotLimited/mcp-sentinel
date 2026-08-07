const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');

// 1. Update project.test call
text = text.replace(
  "parameters: { projectId: '22222222-2222-4222-8222-222222222222', runId: '11111111-1111-4111-8111-111111111111', framework: 'node' }",
  "parameters: { projectId: '22222222-2222-4222-8222-222222222222', runId: '11111111-1111-4111-8111-111111111111', runner: 'jest' }"
);

// 2. Update DB insertion to include permittedTasks
text = text.replace('"allowRecursiveDelete":true}', '"allowRecursiveDelete":true,"permittedTasks":["jest"]}');

fs.writeFileSync('tests/broker-missing.test.js', text);
