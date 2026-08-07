const fs = require('fs');
let content = fs.readFileSync('tests/scripts/export-legacy-state.test.js', 'utf8');
content = content.replace(/        import\('node:sqlite'\)[\s\S]*?Date\.now\(\)\}\`\);/g, `        const dbFile = '/tmp/mock-sqlite-' + Date.now() + '.sqlite3';
        const sqlite = await import('node:sqlite');
        const db = new sqlite.DatabaseSync(dbFile);
        db.exec("CREATE TABLE automations (id INTEGER PRIMARY KEY, payload TEXT, updated_at TEXT)");
        db.prepare("INSERT INTO automations (payload) VALUES (?)").run('{"foo":"bar"}');
        db.close();
        process.env.MCP_STATE_DB = dbFile;
        
        await import(\`\${SCRIPT_PATH}?t=\${Date.now()}\`);`);
fs.writeFileSync('tests/scripts/export-legacy-state.test.js', content);
