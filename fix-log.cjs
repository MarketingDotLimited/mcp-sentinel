const fs = require('fs');
let text = fs.readFileSync('tests/broker-missing.test.js', 'utf8');

text = text.replace(
  "if (name === 'systemctl' && args.includes('start')) {",
  "require('fs').appendFileSync(require('path').join('/tmp', 'fake.log'), 'name=' + name + ' args=' + args.join(' ') + '\\n');\nif (name === 'systemctl' && args.includes('start')) {"
);

fs.writeFileSync('tests/broker-missing.test.js', text);
