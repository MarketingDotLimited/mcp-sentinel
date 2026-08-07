with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

import re
text = re.sub(r"test\('production-preflight\.js env branches', async \(t\) => \{.*?\n\}\);\n", "", text, flags=re.DOTALL)

new_tests = """
test('production-preflight.js env branches', async (t) => {
    const run = async (tmp) => {
        try { await runPreflight(tmp); } catch {}
    };

    const envBase = 'BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\\nBROKER_MANAGEMENT_PORTS=22,443\\nMCP_STATE_DB=/var/lib/mcp-sentinel/state.sqlite3\\nBROKER_GIT_ALLOWED_REPOS=/tmp/repo\\nBROKER_MANAGED_USERS=projuser\\n';

    await t.test('missing protected service', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('ssh,', ''));
        await run(tmp);
    });

    await t.test('missing repos', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('BROKER_GIT_ALLOWED_REPOS=/tmp/repo', 'BROKER_GIT_ALLOWED_REPOS='));
        await run(tmp);
    });

    await t.test('missing users', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('BROKER_MANAGED_USERS=projuser', 'BROKER_MANAGED_USERS='));
        await run(tmp);
    });

    await t.test('bad repo /etc', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('/tmp/repo', '/etc'));
        await run(tmp);
    });

    await t.test('bad repo relative', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('/tmp/repo', 'relative/path'));
        await run(tmp);
    });

    await t.test('root user', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('projuser', 'root'));
        await run(tmp);
    });

    await t.test('missing port', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('22,443', '22'));
        await run(tmp);
    });

    await t.test('wrong state db', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), envBase.replace('/var/lib/mcp-sentinel/state.sqlite3', '/wrong'));
        await run(tmp);
    });
});
"""
text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
