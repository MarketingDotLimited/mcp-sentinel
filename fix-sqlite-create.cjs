const fs = require('fs');

['tests/scripts/backup-state.test.js', 'tests/scripts/restore-state.test.js'].forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/process\.env\.MCP_STATE_DB = '(.+?)' \+ Date\.now\(\) \+ '(.+?)';/g, (match) => {
        return `${match}\n        import('fs').then(fs => fs.writeFileSync(process.env.MCP_STATE_DB, ''));\n        process.env.MCP_BACKUP_ROOT = '/tmp/fake-backup-' + Date.now();\n        import('fs').then(fs => fs.mkdirSync(process.env.MCP_BACKUP_ROOT, { recursive: true }));`;
    });
    fs.writeFileSync(file, content);
});
