const fs = require('fs');
let code = fs.readFileSync('tests/scripts/deploy-release.test.js', 'utf8');
code = code.replace(/if \(file\.includes\('credentials'\)\) return 'c' \+ Buffer\.from\(file\)\.toString\('hex'\)\.padEnd\(63, '0'\);/g,
"if (file.includes('credentials')) return cryptoMock.createHash().update(file).digest('hex');");
fs.writeFileSync('tests/scripts/deploy-release.test.js', code);
