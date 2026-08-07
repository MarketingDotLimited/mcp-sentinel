const fs = require('fs');
let text = fs.readFileSync('test-firewall.mjs', 'utf8');
text = text.replace(/require\("fs"\).*/g, "fs.appendFileSync(path.join(process.cwd(), 'cov_tmp2', 'fake.log'), name + ' ' + args.join(' ') + '\\n');");
fs.writeFileSync('test-firewall.mjs', text);
