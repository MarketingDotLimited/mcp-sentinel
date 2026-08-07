const fs = require('fs');
const glob = require('glob');

const files = glob.sync('tests/scripts/*.test.js');
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/require\('fs'\)/g, "(await import('fs'))");
    content = content.replace(/require\('os'\)/g, "(await import('os'))");
    fs.writeFileSync(file, content);
});
