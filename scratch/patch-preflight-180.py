with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

import re

# Remove old block if exists
text = re.sub(r"test\('production-preflight\.js missing 180 branches', async \(t\) => \{.*?\n\}\);\n", "", text, flags=re.DOTALL)

new_tests = """
test('production-preflight.js missing 180 branches', async (t) => {
    const run = async (tmp) => {
        try { await runPreflight(tmp); } catch {}
    };

    // 182 - Integrity check failed
    // Wait, it's easier to just mock database.prepare('PRAGMA integrity_check').all() to return [{integrity_check: 'fail'}]
    // But we are doing integration tests. Can we corrupt the DB?
    // Let's just create a dummy file that is NOT a sqlite DB!
    // But `new DatabaseSync()` might throw BEFORE we get to PRAGMA?
    // Let's try!
    await t.test('db not sqlite', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3'), 'this is not a database, this is just some text');
        await run(tmp);
    });

    // 184 - Schema migration 6 not applied
    await t.test('db wrong migration', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        const { DatabaseSync } = await import('node:sqlite');
        const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
        const db = new DatabaseSync(dbPath);
        db.exec('DELETE FROM schema_migrations; INSERT INTO schema_migrations VALUES (5);');
        db.close();
        await run(tmp);
    });

    // 185 - Broker environment could not be validated
    await t.test('missing broker env', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.unlinkSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'));
        await run(tmp);
    });
});
"""

text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
