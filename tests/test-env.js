import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

process.env.USE_HTTPS = 'false';
process.env.TLS_CERT_PATH = '';
process.env.TLS_KEY_PATH = '';

const openDatabases = new Set();
const openServers = new Set();

// Monkeypatch DatabaseSync to track instances and prevent production path access
const originalDatabaseSync = DatabaseSync;
class SafeDatabaseSync extends originalDatabaseSync {
  constructor(dbPath, options) {
    if (
      typeof dbPath === 'string' &&
      (dbPath.startsWith('/var/lib') ||
        dbPath.startsWith('/etc') ||
        dbPath.startsWith('/home') ||
        dbPath.startsWith('/root'))
    ) {
      if (process.env.ALLOW_PROD_PATHS !== 'true') {
        throw new Error(`EACCES: test attempted to access production database path: ${dbPath}`);
      }
    }
    super(dbPath, options);
    openDatabases.add(this);
  }
  close() {
    openDatabases.delete(this);
    super.close();
  }
}
import sqlite from 'node:sqlite';
sqlite.DatabaseSync = SafeDatabaseSync;

// Monkeypatch fs to prevent production path access
const originalOpenSync = fs.openSync;
fs.openSync = function (p, flags, mode) {
  if (
    typeof p === 'string' &&
    (p.startsWith('/var/lib') || p.startsWith('/etc') || p.startsWith('/home') || p.startsWith('/root'))
  ) {
    if (process.env.ALLOW_PROD_PATHS !== 'true' && !p.startsWith('/tmp') && !p.startsWith(process.cwd())) {
      throw new Error(`EACCES: test attempted to access production path: ${p}`);
    }
  }
  return originalOpenSync.apply(this, arguments);
};

// 1. Check if we are already in an isolated environment.
if (!process.env.MCP_ISOLATED_TEST_ENV) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));

  const env = {
    MCP_STATE_DB: path.join(tmpDir, 'state.sqlite3'),
    MCP_STATE_DIR: path.join(tmpDir, 'state'),
    KEYSTORE_FILE: path.join(tmpDir, 'keystore.json'),
    KEYS_FILE: path.join(tmpDir, 'keys.json'),
    CONTROL_PLANE_STATE_FILE: path.join(tmpDir, 'control-plane.json'),
    MCP_CAPABILITIES_FILE: path.join(tmpDir, 'capabilities.json'),
    JWT_REVOCATION_FILE: path.join(tmpDir, 'revoked.json'),
    AUDIT_LOG_DIR: path.join(tmpDir, 'logs'),
    FIREWALL_SNAPSHOT_DIR: path.join(tmpDir, 'firewall'),
    BACKUP_DIR: path.join(tmpDir, 'backups'),
    RESTORE_DIR: path.join(tmpDir, 'restores'),
    HOME: tmpDir,
    NODE_ENV: 'test',
    TEST_NO_LISTEN: 'true',
    MCP_ISOLATED_TEST_ENV: 'true',
    AUTHELIA_USERS_FILE: path.join(tmpDir, 'users.yml'),
    AUTHELIA_CONFIG_FILE: path.join(tmpDir, 'configuration.yml'),
    BROKER_FIREWALL_SNAPSHOT_ROOT: path.join(tmpDir, 'firewall-snapshots'),
    JWT_SECRET: 'test-jwt-secret-that-is-at-least-64-characters-long-so-it-passes-validation-12345678901234567890',
    ADMIN_API_KEY: 'test-admin-api-key',
  };

  fs.mkdirSync(env.MCP_STATE_DIR, { recursive: true });
  fs.mkdirSync(env.AUDIT_LOG_DIR, { recursive: true });
  fs.mkdirSync(env.FIREWALL_SNAPSHOT_DIR, { recursive: true });
  fs.mkdirSync(env.BROKER_FIREWALL_SNAPSHOT_ROOT, { recursive: true });
  fs.mkdirSync(env.BACKUP_DIR, { recursive: true });
  fs.mkdirSync(env.RESTORE_DIR, { recursive: true });

  fs.writeFileSync(env.AUTHELIA_USERS_FILE, '', { mode: 0o600 });
  fs.writeFileSync(env.AUTHELIA_CONFIG_FILE, '', { mode: 0o600 });

  Object.assign(process.env, env);

  // Use process.on('exit') for sync cleanup
  process.on('exit', () => {
    // Close databases
    for (const db of openDatabases) {
      try {
        db.close();
      } catch (e) {}
    }

    // Attempt removal
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  process.testEnvDir = tmpDir;
}

export const testEnvDir = process.testEnvDir;

export async function teardownEnvironment() {
  // Clear any timers or event listeners if needed
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');

  for (const db of openDatabases) {
    try {
      db.close();
    } catch (e) {}
  }
}
