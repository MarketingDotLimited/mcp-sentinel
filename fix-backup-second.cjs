const fs = require('fs');
let content = fs.readFileSync('tests/scripts/backup-state.test.js', 'utf8');
// Find the second test and remove writeFileSync
const parts = content.split("await t.test('ignores read failure");
parts[1] = parts[1].replace(/\(await import\('fs'\)\)\.writeFileSync[^;]+;/g, '');
fs.writeFileSync('tests/scripts/backup-state.test.js', parts.join("await t.test('ignores read failure"));
