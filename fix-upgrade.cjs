const fs = require('fs');
let content = fs.readFileSync('tests/scripts/upgrade-state.test.js', 'utf8');
content = content.replace(/get: \(\) => \(\{ integrity_check: 'failed' \}\n            \}\),/g, "get: () => ({ integrity_check: 'failed' })\n            }),");
content = content.replace(/close: mock\.fn\(\n            \};/g, 'close: mock.fn()\n        };');
fs.writeFileSync('tests/scripts/upgrade-state.test.js', content);
