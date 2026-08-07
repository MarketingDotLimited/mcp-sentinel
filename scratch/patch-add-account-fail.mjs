import fs from 'fs';
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');

const testToAdd = `
    await t.test('fails on missing service account', async () => {
        const tmp = fs.mkdtempSync('/tmp/preflight-account-fail-');
        setupBase(tmp);
        // Overwrite passwd without mcp-sentinel
        fs.writeFileSync(path.join(tmp, 'etc/passwd'), 'root:x:0:0::/root:/bin/bash\\n');
        const res = await runPreflight(tmp);
        assert.equal(res.ready, false);
        const saCheck = res.checks.find(c => c.id === 'service-account');
        assert.equal(saCheck.status, 'fail');
        assert.match(saCheck.detail, /does not exist/);
        
        // Check that state-directory and audit-directory failed with "unavailable"
        const stateCheck = res.checks.find(c => c.id === 'state-directory');
        assert.equal(stateCheck.status, 'fail');
        assert.match(stateCheck.detail, /Service account is unavailable/);
        fs.rmSync(tmp, { recursive: true, force: true });
    });
`;

code = code.replace(
  /await t\.test\('bad url', async \(\) => \{/,
  testToAdd + '\n    await t.test(\'bad url\', async () => {'
);

fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
