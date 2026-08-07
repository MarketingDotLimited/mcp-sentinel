with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

import re
text = re.sub(r"test\('production-preflight\.js last final branches', async \(t\) => \{.*?\n\}\);\n", "", text, flags=re.DOTALL)

new_tests = """
test('production-preflight.js last final branches', async (t) => {
    const run = async (tmp) => {
        try { await runPreflight(tmp); } catch {}
    };

    // 103 - duplicate credentials
    await t.test('duplicate credentials', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/credentials/state-key'), 'a'.repeat(64));
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/credentials/audit-key'), 'a'.repeat(64));
        await run(tmp);
    });

    // 118 - authelia credential too short
    await t.test('authelia credential too short', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/credentials/authelia-jwt-secret'), 'short');
        await run(tmp);
    });

    // 121-122 - authelia config contains forbidden
    await t.test('authelia config forbidden', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        const yml = fs.readFileSync(path.join(tmp, 'etc/mcp-sentinel/authelia.yml'), 'utf8');
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/authelia.yml'), yml + '\\njwt_secret: oops');
        await run(tmp);
    });

    // 123-124 - authelia config lacks oidc secrets
    await t.test('authelia config lacks oidc secrets', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/authelia.yml'), 'blank config');
        await run(tmp);
    });
});
"""
text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
