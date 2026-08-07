const fs = require('fs');

['tests/scripts/backup-state.test.js', 'tests/scripts/restore-state.test.js'].forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/mock\.module\('node:sqlite', \{[\s\S]*?\}\);\n/g, '');
    fs.writeFileSync(file, content);
});
