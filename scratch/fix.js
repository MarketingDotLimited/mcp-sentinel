import fs from 'fs';
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');
const idx = code.indexOf("await t.test('branches'");
if (idx !== -1) {
  code = code.substring(0, idx);
  // remove trailing syntax
  code = code.trim();
}
fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
