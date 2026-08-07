const fs = require('fs');
let content = fs.readFileSync('tests/scripts/migrate-state.test.js', 'utf8');
content = content.replace(/t\.mock\.method\(process, 'exit', \(code\) => \{ exitCode = code; \}\);/g, "t.mock.method(process, 'exit', (code) => { exitCode = code; throw new Error('MOCK_EXIT'); });");
content = content.replace(/await import\(\`\$\{SCRIPT_PATH\}\?t=\$\{Date.now\(\)\}\`\);/g, "try { await import(`${SCRIPT_PATH}?t=${Date.now()}`); } catch (e) { if (e.message !== 'MOCK_EXIT') throw e; }");
content = content.replace(/await assert\.rejects\(\(\) => import\(\`\$\{SCRIPT_PATH\}\?t=\$\{Date.now\(\)\}\`\),/g, "await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`),"); // No change for assert.rejects
fs.writeFileSync('tests/scripts/migrate-state.test.js', content);
