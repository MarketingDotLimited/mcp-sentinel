const fs = require('fs');
let content = fs.readFileSync('tests/scripts/register-node-project.test.js', 'utf8');
content = content.replace(/    const \{ validateNodeProject \} = await import\(SCRIPT_PATH\);\n\n    await t\.test\('validateNodeProject validates input', async \(t\) => \{/g, "    await t.test('validateNodeProject validates input', async (t) => {\n        const { validateNodeProject } = await import(SCRIPT_PATH + '?t=' + Date.now());");
fs.writeFileSync('tests/scripts/register-node-project.test.js', content);
