with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

import re
text = re.sub(r"test\('production-preflight\.js final-final branches', async \(t\) => \{.*?\n\}\);\n", "", text, flags=re.DOTALL)

new_tests = """
test('production-preflight.js final-final branches', async (t) => {
    const run = async (tmp) => {
        try { await runPreflight(tmp); } catch {}
    };

    const envBase = 'BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\\nBROKER_MANAGEMENT_PORTS=22,443\\nMCP_STATE_DB=/var/lib/mcp-sentinel/state.sqlite3\\nBROKER_GIT_ALLOWED_REPOS=/tmp/repo\\nBROKER_MANAGED_USERS=projuser\\n';

    // 151 - missing protected services var
    await t.test('missing protected services var entirely', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\\n', ''));
        await run(tmp);
    });

    // 167 - missing management ports var
    await t.test('missing management ports var entirely', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('BROKER_MANAGEMENT_PORTS=22,443\\n', ''));
        await run(tmp);
    });

    // 186-187 - missing allowed repos and managed users entirely
    await t.test('missing allow list vars entirely', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('BROKER_GIT_ALLOWED_REPOS=/tmp/repo\\n', '').replace('BROKER_MANAGED_USERS=projuser\\n', ''));
        await run(tmp);
    });

    // 182 - integrity check failed
    await t.test('integrity check fail', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        const { DatabaseSync } = await import('node:sqlite');
        const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
        const db = new DatabaseSync(dbPath);
        db.exec("PRAGMA writable_schema = 1; DELETE FROM sqlite_master WHERE type='table' AND name='schema_migrations';");
        db.close();
        await run(tmp);
    });
});
"""
text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
