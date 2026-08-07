import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/production-preflight.js', import.meta.url));

async function runPreflight(tmp) {
    const originalEnv = { ...process.env };
    process.env.MCP_PREFLIGHT_ROOT = tmp;
    process.env.NODE_ENV = 'production';
    process.env.MCP_PRECHECK_ALLOW_BROKER_OFFLINE = '1';
    try {
        const mod = await import(`${SCRIPT_PATH}?t=${Date.now()}`);
        return mod.runPreflight();
    } finally {
        process.env = originalEnv;
    }
}

function setupBase(tmp) {
    fs.mkdirSync(path.join(tmp, 'etc/mcp-sentinel/credentials'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'var/lib/mcp-sentinel'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'var/log/mcp-sentinel'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'opt/mcp-sentinel/releases/2.0.0-958127b38074'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'run/mcp-sentinel'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'etc/systemd/system'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'etc/passwd'), 'mcp-sentinel:x:999:999::/var/lib/mcp-sentinel:/usr/sbin/nologin\n');

    fs.chownSync(path.join(tmp, 'etc/mcp-sentinel'), 0, 0);
    fs.chmodSync(path.join(tmp, 'etc/mcp-sentinel'), 0o700);
    fs.chownSync(path.join(tmp, 'etc/mcp-sentinel/credentials'), 0, 0);
    fs.chmodSync(path.join(tmp, 'etc/mcp-sentinel/credentials'), 0o700);
    
    fs.chownSync(path.join(tmp, 'var/lib/mcp-sentinel'), 999, 999);
    fs.chmodSync(path.join(tmp, 'var/lib/mcp-sentinel'), 0o700);
    fs.chownSync(path.join(tmp, 'var/log/mcp-sentinel'), 999, 999);
    fs.chmodSync(path.join(tmp, 'var/log/mcp-sentinel'), 0o700);
    
    fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'NODE_ENV=production\nHOST=127.0.0.1\nTRUST_PROXY=true\nTRUSTED_PROXIES=127.0.0.1\nOAUTH_RESOURCE_URL=https://mcp.example.com\nAUTHELIA_ISSUER=https://auth.example.com\nAUTHELIA_JWKS_URL=https://auth.example.com/jwks\nALLOWED_ORIGINS=https://mcp.example.com\nPUBLIC_URL=https://mcp.example.com\n');
    fs.chownSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 0, 0);
    fs.chmodSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 0o600);

    fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 'BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\nBROKER_GIT_ALLOWED_REPOS=/tmp/repo\nBROKER_MANAGED_USERS=projuser\nBROKER_MANAGEMENT_PORTS=22,443\nMCP_STATE_DB=/var/lib/mcp-sentinel/state.sqlite3\n');
    fs.chownSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 0, 0);
    fs.chmodSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 0o600);

    let i = 0;
    for (const name of ['state-key', 'audit-key', 'jwt-key', 'state-backup-key']) {
        const val = crypto.createHash('sha256').update(name + i++).digest('hex');
        fs.writeFileSync(path.join(tmp, `etc/mcp-sentinel/credentials/${name}`), val);
        fs.chownSync(path.join(tmp, `etc/mcp-sentinel/credentials/${name}`), 0, 0);
        fs.chmodSync(path.join(tmp, `etc/mcp-sentinel/credentials/${name}`), 0o600);
    }
    const autheliaCredentials = ['authelia-jwt-secret','authelia-session-secret','authelia-storage-key','authelia-oidc-hmac','authelia-oidc-private-key','authelia-client-chatgpt-hash','authelia-client-rabeebserver-hash'];
    for (const name of autheliaCredentials) {
        fs.writeFileSync(path.join(tmp, `etc/mcp-sentinel/credentials/${name}`), 'a'.repeat(32));
        fs.chownSync(path.join(tmp, `etc/mcp-sentinel/credentials/${name}`), 0, 0);
        fs.chmodSync(path.join(tmp, `etc/mcp-sentinel/credentials/${name}`), 0o600);
    }
    fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/authelia.yml'), '{{ secret "/run/credentials/authelia.service/something" }}');

    const units = ['authelia.service','mcp-sentinel.service','mcp-sentinel-broker.service','mcp-sentinel-state-backup.service','mcp-sentinel-state-backup.timer','mcp-sentinel-audit-verify.service','mcp-sentinel-audit-verify.timer'];
    const repoDeployDir = path.dirname(fileURLToPath(import.meta.url)) + '/../../deploy';
    for (const unit of units) {
        fs.copyFileSync(path.join(repoDeployDir, unit), path.join(tmp, 'etc/systemd/system', unit));
    }

    const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE schema_migrations (version INTEGER); INSERT INTO schema_migrations VALUES (6);');
    db.exec('CREATE TABLE projects (id TEXT, payload TEXT);');
    db.exec(`INSERT INTO projects VALUES ('11111111-1111-1111-8111-111111111111', '{"runAsUser":"projuser","transportKind":"local","repoPath":"/tmp/repo","rootPath":"/tmp/repo"}');`);
    db.exec('CREATE TABLE oauth_mappings (username TEXT, payload TEXT);');
    db.exec(`INSERT INTO oauth_mappings VALUES ('admin', '{"role":"admin"}');`);
    db.exec('CREATE TABLE api_keys (payload TEXT);');
    db.exec(`INSERT INTO api_keys VALUES ('{"role":"admin","active":true}');`);
    db.close();
    fs.chownSync(dbPath, 999, 999);
    fs.chmodSync(dbPath, 0o600);

    const version = '2.0.0';
    const commit = '958127b38074958127b38074958127b380749581';
    const sha256 = 'a'.repeat(64);
    const signatureFingerprint = 'B'.repeat(40);
    const releaseId = `${version}-${commit.slice(0, 12)}`;
    
    fs.writeFileSync(path.join(tmp, 'var/lib/mcp-sentinel/deployment.json'), JSON.stringify({commit, sha256, signatureFingerprint, version, artifact: 'a'}));
    const releaseDir = path.join(tmp, 'opt/mcp-sentinel/releases', releaseId);
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'package.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(releaseDir, '.release-receipt.json'), JSON.stringify({commit, sha256, signatureFingerprint, version, artifact: 'a'}));
    fs.symlinkSync(releaseDir, path.join(tmp, 'opt/mcp-sentinel/current'));
    fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/release-signing-fingerprint'), signatureFingerprint);
    fs.chownSync(path.join(tmp, 'etc/mcp-sentinel/release-signing-fingerprint'), 0, 0);
    fs.chmodSync(path.join(tmp, 'etc/mcp-sentinel/release-signing-fingerprint'), 0o600);
}

test('production-preflight.js happy path', async (t) => {
    const tmp = fs.mkdtempSync('/tmp/preflight-test-');
    t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
    setupBase(tmp);
    const result = await runPreflight(tmp);
    assert.equal(result.failed, 0);
    assert.equal(result.ready, true);
});

test('production-preflight.js branches', async (t) => {
    const scenarios = [
        (tmp) => fs.unlinkSync(path.join(tmp, 'etc/mcp-sentinel/environment')),
        (tmp) => fs.unlinkSync(path.join(tmp, 'opt/mcp-sentinel/current'))
    ];
    for (const [i, scenario] of scenarios.entries()) {
        const tmp = fs.mkdtempSync('/tmp/preflight-branch-');
        setupBase(tmp);
        scenario(tmp);
        const result = await runPreflight(tmp);
        assert.equal(result.ready, false, `Scenario ${i} should fail`);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
