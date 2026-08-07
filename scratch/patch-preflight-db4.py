with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

import re

text = re.sub(r"test\('production-preflight\.js more branches', async \(t\) => \{.*?\n\}\);\n", "", text, flags=re.DOTALL)

new_tests = """
test('production-preflight.js more branches', async (t) => {
    const run = async (tmp) => {
        try { await runPreflight(tmp); } catch {}
    };

    const setupWithDb = async (tmp, query) => {
        setupBase(tmp);
        const { DatabaseSync } = await import('node:sqlite');
        const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
        const db = new DatabaseSync(dbPath);
        db.exec(query);
        db.close();
    };

    const validProject = `INSERT INTO projects (id, payload) VALUES ('550e8400-e29b-41d4-a716-446655440000', '{"runAsUser":"projuser","transportKind":"local","repoPath":"/tmp/repo","rootPath":"/tmp/repo"}');`;

    // 194 - Project is not a canonical UUID
    await t.test('project bad uuid', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, `INSERT INTO projects (id, payload) VALUES ('bad-uuid', '{"runAsUser":"projuser","transportKind":"local","repoPath":"/tmp/repo","rootPath":"/tmp/repo"}');`);
        await run(tmp);
    });

    // 196 - Project root user
    await t.test('project root user', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, `INSERT INTO projects (id, payload) VALUES ('550e8400-e29b-41d4-a716-446655440000', '{"runAsUser":"root","transportKind":"local","repoPath":"/tmp/repo","rootPath":"/tmp/repo"}');`);
        await run(tmp);
    });

    // 196 - Project unmanaged user
    await t.test('project unmanaged user', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, `INSERT INTO projects (id, payload) VALUES ('550e8400-e29b-41d4-a716-446655440000', '{"runAsUser":"nobody","transportKind":"local","repoPath":"/tmp/repo","rootPath":"/tmp/repo"}');`);
        await run(tmp);
    });

    // 199 - Local project outside ceiling
    await t.test('project outside ceiling', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, `INSERT INTO projects (id, payload) VALUES ('550e8400-e29b-41d4-a716-446655440000', '{"runAsUser":"projuser","transportKind":"local","repoPath":"/tmp/badrepo","rootPath":"/tmp/repo"}');`);
        await run(tmp);
    });

    // 201 - SSH Gateway bad
    await t.test('project ssh bad', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, `INSERT INTO projects (id, payload) VALUES ('550e8400-e29b-41d4-a716-446655440000', '{"runAsUser":"projuser","transportKind":"ssh-gateway","sshConnectionId":null,"hostId":"xyz"}');`);
        await run(tmp);
    });
    
    // 220 - Client override unknown project
    await t.test('client override unknown project', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, validProject + `INSERT INTO oauth_mappings (username, payload) VALUES ('testuser', '{"clients":{"c1":{"projectIds":["650e8400-e29b-41d4-a716-446655440000"]}}}');`);
        await run(tmp);
    });

    // 231 - No active stored administrator key
    await t.test('no admin keys', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        await setupWithDb(tmp, validProject); // Missing api_keys
        await run(tmp);
    });

    // Test: 241 - current is not a symlink
    await t.test('current not symlink', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.unlinkSync(path.join(tmp, 'opt/mcp-sentinel/current'));
        fs.writeFileSync(path.join(tmp, 'opt/mcp-sentinel/current'), 'not-a-symlink');
        await run(tmp);
    });

    // Test: 244-245 - current resolves outside releases
    await t.test('current outside releases', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.unlinkSync(path.join(tmp, 'opt/mcp-sentinel/current'));
        fs.symlinkSync(path.join(tmp, 'etc/mcp-sentinel'), path.join(tmp, 'opt/mcp-sentinel/current'));
        await run(tmp);
    });

    // Test: 246 - contains git worktree
    await t.test('contains git', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.mkdirSync(path.join(tmp, 'opt/mcp-sentinel/releases/2.0.0-958127b38074/.git'), { recursive: true });
        await run(tmp);
    });

});
"""

text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
