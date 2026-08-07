const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');

// 1. Fix project.cancel assert.rejects -> await handleRequest
text = text.replace(/await assert\.rejects\(\n\s*handleRequest\(\{ requestId: "11111111-1111-4111-8111-111111111111", operation: "project\.cancel"/, 'await handleRequest({ requestId: "11111111-1111-4111-8111-111111111111", operation: "project.cancel"');
// and remove the extra closing parenthesis/semicolon for it
text = text.replace(/111111111111' } }\n    \);\n/, "111111111111' } });\n");

// 2. Add valid service.list test
const validService = `
    await handleRequest({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'service.list', parameters: { state: 'active' } });
`;
const idx = text.indexOf('// 1000 project read missing');
text = text.slice(0, idx) + validService + text.slice(idx);

// 3. Make fake systemctl fail for rollback
text = text.replace(/await fs\.writeFile\(path\.join\(fakeBin, 'systemctl'\), `\s*\#!\/usr\/bin\/env node\\nconst args = process\.argv\.slice\(2\);\\nif \(args\.includes\('fail'\)\) process\.exit\(1\);\\n`, \{ mode: 0o777 \}\);/,
"await fs.writeFile(path.join(fakeBin, 'systemctl'), `#!/usr/bin/env node\\nconst args = process.argv.slice(2);\\nif (args.includes('fail') || args.includes('start')) process.exit(1);\\n`, { mode: 0o777 });"
);

fs.writeFileSync('tests/broker-missing.test.js', text);
