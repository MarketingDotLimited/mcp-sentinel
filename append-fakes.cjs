const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');

const toAdd = `
if (name === 'systemd-run') {
  console.error('systemd-run failed');
  process.exit(1);
}
if (name === 'systemctl' && args.includes('start')) {
  console.error('systemctl start failed');
  process.exit(1);
}
`;

text = text.replace(
  "if (name === 'userdel' && args.includes('failuser')) {",
  toAdd + "if (name === 'userdel' && args.includes('failuser')) {"
);

fs.writeFileSync('tests/broker-missing.test.js', text);
