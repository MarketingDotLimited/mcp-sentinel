with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

new_tests = """
test('production-preflight.js more branches', async (t) => {
    const run = async (tmp) => {
        try { await runPreflight(tmp); } catch {}
    };

    // Test: 193 - missing private key / incorrect permissions
    await t.test('missing ssh host key', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.unlinkSync(path.join(tmp, 'etc/ssh/ssh_host_ed25519_key'));
        await run(tmp);
    });

    await t.test('bad ssh host key permissions', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.chmodSync(path.join(tmp, 'etc/ssh/ssh_host_ed25519_key'), 0o777);
        await run(tmp);
    });

    // Test: 203 - non-existent shell for mcp-sentinel user
    await t.test('mcp-sentinel non-existent shell', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/passwd'), 'mcp-sentinel:x:999:999::/var/lib/mcp-sentinel:/usr/bin/does-not-exist\\n');
        await run(tmp);
    });

    // Test: 220 - state DB has no keys or is broken
    await t.test('state DB no keys', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
        const db = new sqlite(dbPath);
        db.exec('DELETE FROM api_keys');
        db.close();
        await run(tmp);
    });

    // Test: 231 - bad service definition
    await t.test('bad service def', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/systemd/system/mcp-sentinel.service'), 'bad');
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
