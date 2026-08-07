import fs from 'fs';
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');

code = code.replace(
  /clients: \{\n\s*c1: \{\n\s*role: 'user',\n\s*projectIds: \['unknown'\]\n\s*\}\n\s*\}/,
  `clients: {\n            c1: {\n              role: 'user',\n              projectIds: ['11111111-1111-4111-8111-111111111111', 'unknown']\n            }\n          }`
);

fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
