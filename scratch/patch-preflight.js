const fs = require('fs');
let code = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');

const newTest = `
test('production-preflight.js CLI success', async (t) => {
    const tmp = fs.mkdtempSync('/tmp/preflight-cli-');
    setupBase(tmp);
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
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('production-preflight.js CLI fail', async (t) => {
    const tmp = fs.mkdtempSync('/tmp/preflight-cli-fail-');
    setupBase(tmp);
    fs.unlinkSync(tmp + '/opt/mcp-sentinel/current');
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
        process.exitCode = 0; // reset
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
`;

// Insert the new CLI tests before the end
code += newTest;

// Add scenarios for broker socket ENOENT and EACCES
code = code.replace("const scenarios = [", "const scenarios = [\n        (tmp) => { fs.mkdirSync(tmp + '/run/mcp-sentinel/broker.sock'); fs.chmodSync(tmp + '/run/mcp-sentinel/broker.sock', 0); },\n        (tmp) => { fs.rmSync(tmp + '/run/mcp-sentinel', { recursive: true, force: true }); },\n");

fs.writeFileSync('tests/scripts/production-preflight.test.js', code);
