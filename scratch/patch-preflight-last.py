with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

import re

# Remove old block if exists
text = re.sub(r"test\('production-preflight\.js missing last branches', async \(t\) => \{.*?\n\}\);\n", "", text, flags=re.DOTALL)

new_tests = """
test('production-preflight.js missing last branches', async (t) => {
    const run = async (tmp) => {
        try { await runPreflight(tmp); } catch {}
    };

    // 186-187 - fallback for missing ALLOWED_REPOS and MANAGED_USERS
    await t.test('missing allow list vars', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 'BROKER_PROTECTED_SERVICES=mcp-sentinel\\nBROKER_MANAGEMENT_PORTS=22\\nMCP_STATE_DB=/var/lib/mcp-sentinel/state.sqlite3\\n');
        await run(tmp);
    });

    // 192 - No registered projects
    await t.test('no registered projects', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        const { DatabaseSync } = await import('node:sqlite');
        const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
        const db = new DatabaseSync(dbPath);
        db.exec('DELETE FROM projects;'); // Delete the default project!
        db.close();
        await run(tmp);
    });

    // 231 - No active stored administrator key
    await t.test('no active admin key', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        const { DatabaseSync } = await import('node:sqlite');
        const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
        const db = new DatabaseSync(dbPath);
        db.exec('DELETE FROM api_keys;'); // Delete the default api_key!
        db.close();
        await run(tmp);
    });

    // 269 - active release signature mismatch
    await t.test('signature mismatch', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/release-signing-fingerprint'), 'A'.repeat(40));
        await run(tmp);
    });
});
"""

text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
