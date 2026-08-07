const fs = require('fs');
let content = fs.readFileSync('tests/scripts/validate-user-needs.test.js', 'utf8');
content = content.replace(/                \}\) \}\);\n[\s\S]*?return '';\n                \}/g, '                }');
fs.writeFileSync('tests/scripts/validate-user-needs.test.js', content);
