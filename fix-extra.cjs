const fs = require('fs');
const glob = require('glob');

const files = glob.sync('tests/scripts/*.test.js');
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/\s*\)\n\s*\}/g, '\n            }');
    content = content.replace(/\}\'\n\s*\}/g, "}'\n            }");
    fs.writeFileSync(file, content);
});
