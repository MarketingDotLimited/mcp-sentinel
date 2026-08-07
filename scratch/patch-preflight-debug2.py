with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

import re

text = re.sub(r"test\('production-preflight\.js more branches', async \(t\) => \{.*?\n\}\);\n", "", text, flags=re.DOTALL)

new_tests = """
test('production-preflight.js more branches', async (t) => {
    const setupWithDb = async (tmp, query) => {
        setupBase(tmp);
        const { DatabaseSync } = await import('node:sqlite');
        const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
        const db = new DatabaseSync(dbPath);
        db.exec(query);
        db.close();
    };

    const validProject = `INSERT INTO projects (id, payload) VALUES ('550e8400-e29b-41d4-a716-446655440000', '{"runAsUser":"projuser","transportKind":"local","repoPath":"/tmp/repo","rootPath":"/tmp/repo"}');`;

    // 199 - Local project outside ceiling
    await t.test('project outside ceiling', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, `INSERT INTO projects (id, payload) VALUES ('550e8400-e29b-41d4-a716-446655440000', '{"runAsUser":"projuser","transportKind":"local","repoPath":"/tmp/badrepo","rootPath":"/tmp/repo"}');`);
        const result = await runPreflight(tmp);
        console.log("199 result:", JSON.stringify(result));
    });
});
"""

text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
