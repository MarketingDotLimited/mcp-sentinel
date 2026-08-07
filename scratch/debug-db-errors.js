import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/production-preflight.js', import.meta.url));

async function run() {
    const tmp = fs.mkdtempSync('/tmp/preflight-debug-');
    
    fs.mkdirSync(path.join(tmp, 'etc/mcp-sentinel/credentials'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'var/lib/mcp-sentinel'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'var/log/mcp-sentinel'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'opt/mcp-sentinel/releases/2.0.0-958127b38074'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'run/mcp-sentinel'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'etc/systemd/system'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'etc/passwd'), 'mcp-sentinel:x:999:999::/var/lib/mcp-sentinel:/usr/sbin/nologin\n');
    fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/environment'), 'NODE_ENV=production\nHOST=127.0.0.1\nTRUST_PROXY=true\nTRUSTED_PROXIES=127.0.0.1\nOAUTH_RESOURCE_URL=https://mcp.example.com\nAUTHELIA_ISSUER=https://auth.example.com\nAUTHELIA_JWKS_URL=https://auth.example.com/jwks\nALLOWED_ORIGINS=https://mcp.example.com\nPUBLIC_URL=https://mcp.example.com\n');
    fs.writeFileSync(path.join(tmp, 'etc/mcp-sentinel/broker-environment'), 'BROKER_PROTECTED_SERVICES=mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia\nBROKER_GIT_ALLOWED_REPOS=/tmp/repo\nBROKER_MANAGED_USERS=projuser\nBROKER_MANAGEMENT_PORTS=22,443\nMCP_STATE_DB=/var/lib/mcp-sentinel/state.sqlite3\n');
    
    const dbPath = path.join(tmp, 'var/lib/mcp-sentinel/state.sqlite3');
    const db = new DatabaseSync(dbPath);
    db.exec('CREATE TABLE schema_migrations (version INTEGER); INSERT INTO schema_migrations VALUES (6);');
    db.exec('CREATE TABLE projects (id TEXT, payload TEXT);');
    db.exec('CREATE TABLE oauth_mappings (username TEXT, payload TEXT);');
    db.exec('CREATE TABLE api_keys (payload TEXT);');
    db.exec("INSERT INTO api_keys VALUES ('{\"role\":\"admin\",\"active\":true}');");
    db.exec("INSERT INTO projects VALUES ('p-remote2', '{\"runAsUser\":\"projuser\",\"transportKind\":\"ssh-gateway\"}');");
    db.close();
    fs.chownSync(dbPath, 999, 999);
    fs.chmodSync(dbPath, 0o600);

    const originalEnv = { ...process.env };
    process.env.MCP_PREFLIGHT_ROOT = tmp;
    process.env.NODE_ENV = 'production';
    process.env.MCP_PRECHECK_ALLOW_BROKER_OFFLINE = '1';

    try {
        const mod = await import(SCRIPT_PATH + '?t=' + Date.now());
        const result = mod.runPreflight();
        console.log("DB DETAIL:", result.checks.find(c => c.id === 'durable-state').detail);
    } finally {
        process.env = originalEnv;
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}
run();
