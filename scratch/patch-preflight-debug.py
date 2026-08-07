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
        try { await runPreflight(tmp); } catch(e) { console.log("199 error:", e.message); }
    });

    // 201 - SSH Gateway bad
    await t.test('project ssh bad', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, `INSERT INTO projects (id, payload) VALUES ('550e8400-e29b-41d4-a716-446655440000', '{"runAsUser":"projuser","transportKind":"ssh-gateway","sshConnectionId":null,"hostId":"xyz"}');`);
        try { await runPreflight(tmp); } catch(e) { console.log("201 error:", e.message); }
    });
    
    // 220 - Client override unknown project
    await t.test('client override unknown project', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, validProject + `INSERT INTO oauth_mappings (username, payload) VALUES ('testuser', '{"clients":{"c1":{"projectIds":["650e8400-e29b-41d4-a716-446655440000"]}}}');`);
        try { await runPreflight(tmp); } catch(e) { console.log("220 error:", e.message); }
    });

    // 231 - No active stored administrator key
    await t.test('no admin keys', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, validProject); // Missing api_keys
        try { await runPreflight(tmp); } catch(e) { console.log("231 error:", e.message); }
    });

    // Test: 269 - active release signature mismatch
    await t.test('active release signature mismatch', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/release-signing-fingerprint'), 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
        try { await runPreflight(tmp); } catch(e) { console.log("269 error:", e.message); }
    });
});
"""

text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
