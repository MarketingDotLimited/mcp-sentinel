const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');
text = text.replace("await fs.writeFile(path.join(fakeBin, 'systemctl'), `#!/usr/bin/env node\\nconst args = process.argv.slice(2);\\nif (args.includes('fail')) process.exit(1);\\n`, { mode: 0o777 });", "await fs.writeFile(path.join(fakeBin, 'systemctl'), `#!/usr/bin/env node\\nconst args = process.argv.slice(2);\\nif (args.includes('fail') || args.includes('start')) process.exit(1);\\n`, { mode: 0o777 });");
fs.writeFileSync('tests/broker-missing.test.js', text);
