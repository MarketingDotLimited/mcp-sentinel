const fs = require('fs');
let content = fs.readFileSync('tests/scripts/register-node-project.test.js', 'utf8');
content = content.replace(/await import\(\`\$\{SCRIPT_PATH\}\?t=\$\{Date\.now\(\)\}\`\);/g, "const { main } = await import(`${SCRIPT_PATH}?t=${Date.now()}`);\ntry { await main(); } catch(e) { process.stderr.write(e.message + '\\n'); process.exitCode = 1; }");
fs.writeFileSync('tests/scripts/register-node-project.test.js', content);
