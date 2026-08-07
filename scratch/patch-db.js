const fs = require('fs');
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');

const scenarios = `    const scenarios = [
        (tmp) => fs.unlinkSync(path.join(tmp, 'etc/mcp-sentinel/environment')),
        (tmp) => fs.unlinkSync(path.join(tmp, 'opt/mcp-sentinel/current')),
        (tmp) => {
            const DatabaseSync = require('node:sqlite').DatabaseSync;
            const db = new DatabaseSync(require('path').join(tmp, 'var/lib/mcp-sentinel/state.sqlite3'));
            db.exec("INSERT INTO projects VALUES ('p1', '{\"transportKind\":\"local\",\"repoPath\":\"/tmp/repo\",\"rootPath\":\"/tmp/repo\"}');");
            db.exec("INSERT INTO oauth_mappings VALUES ('u1', '{\"role\":\"user\",\"scopes\":[\"*\"]}');");
            db.close();
        },
        (tmp) => {
            const DatabaseSync = require('node:sqlite').DatabaseSync;
            const db = new DatabaseSync(require('path').join(tmp, 'var/lib/mcp-sentinel/state.sqlite3'));
            db.exec("INSERT INTO oauth_mappings VALUES ('u2', '{\"role\":\"user\",\"projectIds\":[\"unknown\"]}');");
            db.close();
        },
        (tmp) => {
            const DatabaseSync = require('node:sqlite').DatabaseSync;
            const db = new DatabaseSync(require('path').join(tmp, 'var/lib/mcp-sentinel/state.sqlite3'));
            db.exec("INSERT INTO oauth_mappings VALUES ('u3', '{\"role\":\"user\",\"clients\":{\"c1\":{\"role\":\"user\",\"scopes\":[\"*\"]}}}');");
            db.close();
        },
        (tmp) => {
            const DatabaseSync = require('node:sqlite').DatabaseSync;
            const db = new DatabaseSync(require('path').join(tmp, 'var/lib/mcp-sentinel/state.sqlite3'));
            db.exec("INSERT INTO oauth_mappings VALUES ('u4', '{\"role\":\"user\",\"clients\":{\"c1\":{\"role\":\"user\",\"projectIds\":[\"unknown\"]}}}');");
            db.close();
        }
    ];`;

code = code.replace(/const scenarios = \[[\s\S]*?\];/, scenarios);
fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
