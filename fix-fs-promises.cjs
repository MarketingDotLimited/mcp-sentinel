const fs = require('fs');

['tests/scripts/backup-state.test.js', 'tests/scripts/restore-state.test.js'].forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    
    // Remove the mock of node:fs/promises
    content = content.replace(/mock\.module\('node:fs\/promises', \{[\s\S]*?\}\);\n/g, '');
    
    // Create real credential directory and file before import
    content = content.replace(/process\.env\.CREDENTIALS_DIRECTORY = '\/mock\/creds';/g, (match) => {
        return `process.env.CREDENTIALS_DIRECTORY = require('os').tmpdir() + '/creds-' + Date.now() + Math.random();
        require('fs').mkdirSync(process.env.CREDENTIALS_DIRECTORY, { recursive: true });
        require('fs').writeFileSync(process.env.CREDENTIALS_DIRECTORY + '/state-backup-key', 'a'.repeat(64) + '\\n');`;
    });
    
    fs.writeFileSync(file, content);
});
