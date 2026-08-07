const fs = require('fs');

let code = fs.readFileSync('tests/scripts/deploy-release.test.js', 'utf8');

// Remove the multi-process wrapper block
code = code.replace(/if \(!process\.env\.TEST_ACTION\) \{[\s\S]*?\} else \{\s*test\(process\.env\.TEST_ACTION, async \(\) => \{\s*const action = process\.env\.TEST_ACTION;\s*/, "test('deploy-release.js test suite', async () => {\n");

// Replace if (action === 'xxx') with test('xxx', async () => {
code = code.replace(/if \(action === '([^']+)'\) \{/g, "await test('$1', async () => {");
code = code.replace(/\} else await test\('/g, "});\n        await test('");

// Remove the last `    });\n}` and replace with `    });\n});`
code = code.replace(/\s*\}\);\s*\}\s*$/, "\n        });\n});\n");

fs.writeFileSync('tests/scripts/deploy-release.test.js', code);
