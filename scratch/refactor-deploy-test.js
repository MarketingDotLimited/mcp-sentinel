const fs = require('fs');

let code = fs.readFileSync('tests/scripts/deploy-release.test.js', 'utf8');

// Remove the `if (!process.env.TEST_ACTION) { ... }` block
code = code.replace(/if \(!process\.env\.TEST_ACTION\) \{[\s\S]*?\} else \{/, '');

// Remove the `test(process.env.TEST_ACTION, async () => {` wrapper and the closing brace
code = code.replace(/test\(process\.env\.TEST_ACTION, async \(\) => \{\n\s*const action = process\.env\.TEST_ACTION;/, '');

// Replace `if (action === 'xxx') {` with `await test('xxx', async () => {`
code = code.replace(/if \(action === '([^']+)'\) \{/g, "await test('$1', async () => {");
code = code.replace(/\} else await test\('/g, "});\n        await test('");

// At the end, remove the trailing `});` from the `test(process.env.TEST_ACTION...` and replace it
let lastElseIfIdx = code.lastIndexOf('}');
code = code.substring(0, lastElseIfIdx) + '});\n' + code.substring(lastElseIfIdx + 1);

// Wrap everything in a main describe block to use `await test`
code = code.replace(/async function run/, "test('deploy-release.js suite', async (t) => {\n    async function run");
code += '\n});\n';

// Replace `process.exit(1);` with `throw new Error('exit 1');` in the run function
code = code.replace(/process\.exit\(1\);/g, "throw new Error('exit 1');");

// Handle the unclosed `test('deploy-release.js suite'` block
let idx = code.lastIndexOf('}');
code = code.substring(0, idx) + '});\n' + code.substring(idx + 1);

fs.writeFileSync('tests/scripts/deploy-release.test.js', code);
