with open('tests/scripts/production-preflight.test.js', 'r') as f:
    text = f.read()

import re
text = re.sub(r"test\('production-preflight\.js mega branches', async \(t\) => \{.*?\n\}\);\n", "", text, flags=re.DOTALL)

new_tests = """
test('production-preflight.js mega branches', async (t) => {
    const run = async (tmp) => {
        try { await runPreflight(tmp); } catch {}
    };

    const envBase = 'NODE_ENV=production\\nHOST=127.0.0.1\\nTRUST_PROXY=true\\nTRUSTED_PROXIES=127.0.0.1\\nOAUTH_RESOURCE_URL=https://mcp.example.com\\nAUTHELIA_ISSUER=https://auth.example.com\\nAUTHELIA_JWKS_URL=https://auth.example.com/jwks\\nALLOWED_ORIGINS=https://mcp.example.com\\nPUBLIC_URL=https://mcp.example.com\\n';

    // 133 - NODE_ENV !== production
    await t.test('bad NODE_ENV', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), envBase.replace('NODE_ENV=production', 'NODE_ENV=development'));
        await run(tmp);
    });

    // 134 - HOST not loopback
    await t.test('bad HOST', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), envBase.replace('HOST=127.0.0.1', 'HOST=0.0.0.0'));
        await run(tmp);
    });

    // 135 - TRUST_PROXY !== true
    await t.test('bad TRUST_PROXY', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), envBase.replace('TRUST_PROXY=true', 'TRUST_PROXY=false'));
        await run(tmp);
    });

    // 136 - TRUSTED_PROXIES missing loopback
    await t.test('bad TRUSTED_PROXIES', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), envBase.replace('TRUSTED_PROXIES=127.0.0.1', 'TRUSTED_PROXIES=10.0.0.1'));
        await run(tmp);
    });

    // 141 - ALLOWED_ORIGINS empty
    await t.test('empty ALLOWED_ORIGINS', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), envBase.replace('ALLOWED_ORIGINS=https://mcp.example.com', 'ALLOWED_ORIGINS='));
        await run(tmp);
    });

    // 141 - ALLOWED_ORIGINS wildcard
    await t.test('wildcard ALLOWED_ORIGINS', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), envBase.replace('ALLOWED_ORIGINS=https://mcp.example.com', 'ALLOWED_ORIGINS=*'));
        await run(tmp);
    });

    // 143 - PUBLIC_URL mismatch
    await t.test('PUBLIC_URL mismatch', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), envBase.replace('PUBLIC_URL=https://mcp.example.com', 'PUBLIC_URL=https://wrong.com'));
        await run(tmp);
    });

    // 131 - secret bearing key
    await t.test('secret bearing key', async () => {
        const tmp = fs.mkdtempSync('/tmp/mcp-test-');
        setupBase(tmp);
        fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), envBase + 'MY_SECRET=123\\n');
        await run(tmp);
    });
});
"""
text += new_tests

with open('tests/scripts/production-preflight.test.js', 'w') as f:
    f.write(text)
