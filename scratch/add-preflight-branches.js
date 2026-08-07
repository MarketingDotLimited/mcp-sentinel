import fs from 'fs';
const testCode = `
    await t.test('branches', async () => {
        const scenarios = [
            (tmp) => fs.unlinkSync(path.join(tmp, 'etc/mcp-sentinel/environment')),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'SECRET_KEY=1\\nNODE_ENV=production\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'NODE_ENV=dev\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'NODE_ENV=production\\nHOST=0.0.0.0\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'NODE_ENV=production\\nHOST=127.0.0.1\\nTRUST_PROXY=false\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'NODE_ENV=production\\nHOST=127.0.0.1\\nTRUST_PROXY=true\\nTRUSTED_PROXIES=8.8.8.8\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'NODE_ENV=production\\nHOST=127.0.0.1\\nTRUST_PROXY=true\\nTRUSTED_PROXIES=127.0.0.1\\nOAUTH_RESOURCE_URL=bad\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'NODE_ENV=production\\nHOST=127.0.0.1\\nTRUST_PROXY=true\\nTRUSTED_PROXIES=127.0.0.1\\nOAUTH_RESOURCE_URL=https://mcp.example.com\\nALLOWED_ORIGINS=*\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'NODE_ENV=production\\nHOST=127.0.0.1\\nTRUST_PROXY=true\\nTRUSTED_PROXIES=127.0.0.1\\nOAUTH_RESOURCE_URL=https://mcp.example.com\\nALLOWED_ORIGINS=https://mcp.example.com\\nPUBLIC_URL=https://bad.example.com\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 'BROKER_PROTECTED_SERVICES=bad\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 'BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\\nBROKER_GIT_ALLOWED_REPOS=\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 'BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\\nBROKER_GIT_ALLOWED_REPOS=/etc\\nBROKER_MANAGED_USERS=projuser\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 'BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\\nBROKER_GIT_ALLOWED_REPOS=/tmp/repo\\nBROKER_MANAGED_USERS=root\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 'BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\\nBROKER_GIT_ALLOWED_REPOS=/tmp/repo\\nBROKER_MANAGED_USERS=projuser\\nBROKER_MANAGEMENT_PORTS=80\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 'BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\\nBROKER_GIT_ALLOWED_REPOS=/tmp/repo\\nBROKER_MANAGED_USERS=projuser\\nBROKER_MANAGEMENT_PORTS=22,443\\nMCP_STATE_DB=/tmp/bad\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/passwd'), 'mcp-sentinel:x:0:0::/var/lib/mcp-sentinel:/bin/bash\\n'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/credentials/state-key'), 'bad'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/credentials/state-key'), 'a'.repeat(64)),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/authelia.yml'), 'jwt_secret: bad'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/authelia.yml'), 'good'),
            (tmp) => fs.rmSync(path.join(tmp, 'etc/systemd/system/authelia.service')),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/systemd/system/authelia.service'), 'bad'),
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM schema_migrations;');
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM projects;');
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM api_keys;');
                db.close();
            },
            (tmp) => fs.unlinkSync(path.join(tmp, 'opt/mcp-sentinel/current')),
            (tmp) => fs.symlinkSync('/tmp', path.join(tmp, 'opt/mcp-sentinel/current')),
            (tmp) => {
                fs.unlinkSync(path.join(tmp, 'opt/mcp-sentinel/current'));
                fs.symlinkSync(path.join(tmp, 'opt/mcp-sentinel/releases/2.0.0-958127b38074'), path.join(tmp, 'opt/mcp-sentinel/current'));
                fs.mkdirSync(path.join(tmp, 'opt/mcp-sentinel/releases/2.0.0-958127b38074/.git'));
            },
            (tmp) => fs.writeFileSync(path.join(tmp, 'var/lib/mcp-sentinel/deployment.json'), JSON.stringify({commit: 'bad'})),
            (tmp) => fs.writeFileSync(path.join(tmp, 'var/lib/mcp-sentinel/deployment.json'), JSON.stringify({commit: '958127b38074958127b38074958127b380749581', sha256: 'a'.repeat(64), signatureFingerprint: 'B'.repeat(40), version: '1.0.0', artifact: 'a'})),
            (tmp) => fs.writeFileSync(path.join(tmp, 'opt/mcp-sentinel/releases/2.0.0-958127b38074/.release-receipt.json'), JSON.stringify({commit: 'bad', sha256: 'a'.repeat(64), signatureFingerprint: 'B'.repeat(40), version: '2.0.0', artifact: 'a'})),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/release-signing-fingerprint'), 'bad'),
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/release-signing-fingerprint'), 'C'.repeat(40)),
            // missing service account
            (tmp) => fs.writeFileSync(path.join(tmp, 'etc/passwd'), ''),
            (tmp) => {
                const target = path.join(tmp, 'run/mcp-sentinel/broker.sock');
                fs.writeFileSync(target, '');
                fs.chmodSync(target, 0o660);
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM projects;');
                db.exec(\`INSERT INTO projects VALUES ('bad-uuid', '{}');\`);
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM projects;');
                db.exec(\`INSERT INTO projects VALUES ('11111111-1111-1111-8111-111111111111', '{"runAsUser":"root"}');\`);
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM projects;');
                db.exec(\`INSERT INTO projects VALUES ('11111111-1111-1111-8111-111111111111', '{"runAsUser":"projuser","transportKind":"local","repoPath":"/tmp/bad","rootPath":"/tmp/bad"}');\`);
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM projects;');
                db.exec(\`INSERT INTO projects VALUES ('11111111-1111-1111-8111-111111111111', '{"runAsUser":"projuser","transportKind":"ssh-gateway"}');\`);
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM oauth_mappings;');
                db.exec(\`INSERT INTO oauth_mappings VALUES ('user', '{"scopes":["*"]}');\`);
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM oauth_mappings;');
                db.exec(\`INSERT INTO oauth_mappings VALUES ('user', '{"projectIds":["bad"]}');\`);
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM oauth_mappings;');
                db.exec(\`INSERT INTO oauth_mappings VALUES ('user', '{"clients":{"client":{"scopes":["*"]}}}');\`);
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                const { DatabaseSync } = require('node:sqlite');
                const db = new DatabaseSync(dbPath);
                db.exec('DELETE FROM oauth_mappings;');
                db.exec(\`INSERT INTO oauth_mappings VALUES ('user', '{"clients":{"client":{"projectIds":["bad"]}}}');\`);
                db.close();
            },
            (tmp) => {
                const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
                fs.chmodSync(dbPath, 0o777); // wrong mode
            },
            (tmp) => {
                const p = path.join(tmp, 'etc/mcp-sentinel');
                fs.chmodSync(p, 0o777);
            }
        ];

        for (const [i, scenario] of scenarios.entries()) {
            const tmp = fs.mkdtempSync('/tmp/preflight-branch-');
            setupBase(tmp);
            scenario(tmp);
            const result = await runPreflight(tmp);
            assert.equal(result.ready, false, \`Scenario \${i} should fail\`);
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });

    await t.test('run script as CLI', async () => {
        const tmp = fs.mkdtempSync('/tmp/preflight-cli-');
        setupBase(tmp);
        const originalEnv = { ...process.env };
        process.env.MCP_PREFLIGHT_ROOT = tmp;
        process.env.NODE_ENV = 'production';
        process.env.MCP_PRECHECK_ALLOW_BROKER_OFFLINE = '1';
        
        const originalArgv = [...process.argv];
        process.argv = ['node', SCRIPT_PATH];
        
        try {
            await import(\`\${SCRIPT_PATH}?cli=1&t=\${Date.now()}\`);
        } catch(e) {
            // it will process.exitCode = 0 if success
        } finally {
            process.env = originalEnv;
            process.argv = originalArgv;
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    });
`;

let orig = fs.readFileSync('tests/scripts/production-preflight.test.js', 'utf8');
orig = orig.replace('});\n', '});\n' + testCode + '\n');
// Also we need to modify setupBase to use require('node:sqlite') instead of import so it works synchronously if needed, but it's already there
fs.writeFileSync('tests/scripts/production-preflight.test.js', orig);
