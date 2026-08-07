const fs = require('fs');
let text = fs.readFileSync('broker.js', 'utf8');

text = text.replace(
  "await execute('systemctl', ['start', '--', `${rollbackUnit}.service`]).catch(() => {});",
  "try { await execute('systemctl', ['start', '--', `${rollbackUnit}.service`]); } catch (ignore) {}"
);

fs.writeFileSync('broker.js', text);
