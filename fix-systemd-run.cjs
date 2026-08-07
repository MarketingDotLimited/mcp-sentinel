const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');

text = text.replace(
  "if (name === 'systemd-run' && args.some(a => a.startsWith('--unit=mcp-test-'))) {",
  "if (name === 'systemd-run' && args.some(a => a.startsWith('--unit=mcp-project-test-'))) {"
);

fs.writeFileSync('tests/broker-missing.test.js', text);
