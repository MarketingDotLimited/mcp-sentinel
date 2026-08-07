const fs = require('fs');
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');

// replace the last test with a looped test
code = code.replace(/test\('production-preflight\.js db edge cases', async \(t\) => \{[\s\S]*\}\);\n/, `
test('production-preflight.js db edge cases loop', async (t) => {
    const dbScenarios = [
        "INSERT INTO projects VALUES ('p-remote', '{\\"transportKind\\":\\"ssh-gateway\\"}');",
        "INSERT INTO oauth_mappings VALUES ('u1', '{\\"role\\":\\"user\\",\\"scopes\\":[\\"*\\"]}');",
        "INSERT INTO oauth_mappings VALUES ('u2', '{\\"role\\":\\"user\\",\\"projectIds\\":[\\"unknown\\"]}');",
        "INSERT INTO oauth_mappings VALUES ('u3', '{\\"role\\":\\"user\\",\\"clients\\":{\\"c1\\":{\\"role\\":\\"user\\",\\"scopes\\":[\\"*\\"]}}}');",
        "INSERT INTO oauth_mappings VALUES ('u4', '{\\"role\\":\\"user\\",\\"clients\\":{\\"c1\\":{\\"role\\":\\"user\\",\\"projectIds\\":[\\"unknown\\"]}}}');"
    ];

    for (const [i, query] of dbScenarios.entries()) {
        const tmp = fs.mkdtempSync('/tmp/preflight-dbedge-');
        setupBase(tmp);
        const DatabaseSync = require('node:sqlite').DatabaseSync;
        const db = new DatabaseSync(require('path').join(tmp, 'var/lib/mcp-sentinel/state.sqlite3'));
        db.exec(query);
        db.close();

        const originalEnv = { ...process.env };
        process.env.MCP_PREFLIGHT_ROOT = tmp;
        process.env.NODE_ENV = 'production';
        try {
            const mod = await import(SCRIPT_PATH + '?t=' + Date.now() + i);
            const result = mod.runPreflight();
            assert.equal(result.ready, false, "query failed to error: " + query);
        } finally {
            process.env = originalEnv;
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }
});
`);

fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
