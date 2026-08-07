const fs = require('fs');

['tests/scripts/backup-state.test.js', 'tests/scripts/restore-state.test.js'].forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/delete process\.env\.MCP_STATE_BACKUP_KEY;/g, "delete process.env.MCP_STATE_BACKUP_KEY;\n        process.env.MCP_STATE_DB = '/tmp/fake-test-db-' + Date.now() + '.sqlite3';");
    fs.writeFileSync(file, content);
});
