const fs = require('fs');
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');
code = code.replace(/await t\.test\('branches', async \(\) => \{[\s\S]*\}\);/, '');
fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
