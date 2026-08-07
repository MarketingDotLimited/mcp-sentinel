const fs = require('fs');

let oldCode = fs.readFileSync('scratch/old-preflight.js', 'utf8');

// replace the last two tests with the new tests
let testsStartIndex = oldCode.indexOf("test('production-preflight.js happy path'");

let baseSetup = oldCode.slice(0, testsStartIndex);
baseSetup = baseSetup.replace("import crypto from 'crypto';", "import crypto from 'crypto';\nimport net from 'net';");

let tests = `
async function createUnixSocket(socketPath) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.listen(socketPath, () => resolve(srv));
    });
}

test('production-preflight.js happy path', async (t) => {
    const tmp = fs.mkdtempSync('/tmp/preflight-test-');
    setupBase(tmp);
    const srv = await createUnixSocket(path.join(tmp, 'run/mcp-sentinel/broker.sock'));
    fs.chmodSync(path.join(tmp, 'run/mcp-sentinel/broker.sock'), 0o660);
    t.after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
    
    const result = await runPreflight(tmp);
    assert.equal(result.failed, 0);
    assert.equal(result.ready, true);
});

test('production-preflight.js socket is not a socket', async (t) => {
    const tmp = fs.mkdtempSync('/tmp/preflight-socknot-');
    setupBase(tmp);
    fs.writeFileSync(path.join(tmp, 'run/mcp-sentinel/broker.sock'), 'fake');
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    const result = await runPreflight(tmp);
    assert.equal(result.ready, false);
});

test('production-preflight.js socket bad mode', async (t) => {
    const tmp = fs.mkdtempSync('/tmp/preflight-sockmode-');
    setupBase(tmp);
    const srv = await createUnixSocket(path.join(tmp, 'run/mcp-sentinel/broker.sock'));
    fs.chmodSync(path.join(tmp, 'run/mcp-sentinel/broker.sock'), 0o777);
    t.after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
    const result = await runPreflight(tmp);
    assert.equal(result.ready, false);
});

test('production-preflight.js CLI success', async (t) => {
    const tmp = fs.mkdtempSync('/tmp/preflight-cli-');
    setupBase(tmp);
    const srv = await createUnixSocket(path.join(tmp, 'run/mcp-sentinel/broker.sock'));
    fs.chmodSync(path.join(tmp, 'run/mcp-sentinel/broker.sock'), 0o660);
    t.after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

    const originalArgv = process.argv;
    const originalEnv = { ...process.env };
    process.env.MCP_PREFLIGHT_ROOT = tmp;
    process.env.NODE_ENV = 'production';
    process.env.MCP_PRECHECK_ALLOW_BROKER_OFFLINE = '1';
    try {
        process.argv = ['node', SCRIPT_PATH];
        await import(SCRIPT_PATH + '?t=' + Date.now());
        assert.equal(process.exitCode, 0);
    } finally {
        process.argv = originalArgv;
        process.env = originalEnv;
        process.exitCode = 0;
    }
});

test('production-preflight.js CLI fail', async (t) => {
    const tmp = fs.mkdtempSync('/tmp/preflight-clifail-');
    setupBase(tmp);
    fs.unlinkSync(path.join(tmp, 'opt/mcp-sentinel/current'));
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const originalArgv = process.argv;
    const originalEnv = { ...process.env };
    process.env.MCP_PREFLIGHT_ROOT = tmp;
    process.env.NODE_ENV = 'production';
    process.env.MCP_PRECHECK_ALLOW_BROKER_OFFLINE = '1';
    try {
        process.argv = ['node', SCRIPT_PATH];
        await import(SCRIPT_PATH + '?t=' + Date.now());
        assert.equal(process.exitCode, 1);
    } finally {
        process.argv = originalArgv;
        process.env = originalEnv;
        process.exitCode = 0;
    }
});
`;

fs.writeFileSync('tests/scripts/production-preflight.test.js', baseSetup + tests);
