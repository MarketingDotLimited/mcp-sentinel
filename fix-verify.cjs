const fs = require('fs');
let content = fs.readFileSync('tests/scripts/verify-coverage.test.js', 'utf8');
content = content.replace(/\n            }'\n            \}/g, '\n            }');
content = content.replace(/\}\n            \}\n        \}\);/g, '})\n            }\n        });');
fs.writeFileSync('tests/scripts/verify-coverage.test.js', content);
