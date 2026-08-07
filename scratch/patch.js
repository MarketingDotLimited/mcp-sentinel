import fs from 'fs';
let code = fs.readFileSync('tests/scripts/deploy-release.test.js', 'utf8');
code = code.replace("t.beforeEach(() => {", "t.afterEach(() => { console.log('AFTER EACH', process.exitCode); process.exitCode = 0; }); t.beforeEach(() => {");
fs.writeFileSync('tests/scripts/deploy-release.test.js', code);
