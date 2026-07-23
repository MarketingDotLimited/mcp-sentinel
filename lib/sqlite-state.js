import { DatabaseSync } from 'node:sqlite';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DOMAINS = {
  approvals: 'approvals',
  projects: 'projects',
  organizations: 'organizations',
  teams: 'teams',
  hosts: 'hosts',
  sshConnections: 'ssh_connections',
  sshPolicies: 'ssh_policies',
  identitySshPreferences: 'identity_ssh_preferences',
  oauthClientSshPolicies: 'oauth_client_ssh_policies',
  subjectClientSshPreferences: 'subject_client_ssh_preferences',
  sshPolicyHistory: 'ssh_policy_history',
};
const LEGACY_TABLES = {
  automations: 'automations',
  fleets: 'fleet',
  backupTargets: 'backup_targets',
  webhooks: 'webhooks',
};

function emptyState() {
  return Object.fromEntries(Object.keys(DOMAINS).map(key => [key, []]));
}

function normalizeLegacyProject(project) {
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(project.id || '');
  const rootPath = project.rootPath || project.repoPath || project.path;
  return {
    ...project,
    id: validId ? project.id : crypto.randomUUID(),
    ...(validId ? {} : { legacyIds: [...new Set([...(project.legacyIds || []), project.id].filter(Boolean))] }),
    rootPath,
    repoPath: project.repoPath || rootPath,
    hostId: project.hostId || 'local',
    transportKind: project.transportKind || 'local',
    sshAllowed: project.sshAllowed === true,
    sshEnabled: project.sshEnabled === true,
    transportPolicyVersion:
      Number.isSafeInteger(project.transportPolicyVersion) && project.transportPolicyVersion > 0
        ? project.transportPolicyVersion
        : 1,
  };
}

function initialLocalHost(now) {
  return {
    id: 'local',
    name: 'Local Sentinel Host',
    transportKind: 'local',
    enabled: true,
    sshAllowed: false,
    sshEnabled: false,
    policyVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function initialGlobalSshPolicy(now) {
  return {
    id: 'global',
    sshAllowed: false,
    sshEnabled: false,
    policyVersion: 1,
    updatedAt: now,
    updatedBy: 'migration',
  };
}

async function verifyLegacyExport(markerValue, counts) {
  let verification;
  try {
    verification = JSON.parse(markerValue);
  } catch {
    throw new Error('Legacy export verification marker is invalid');
  }
  if (
    !verification.sha256 ||
    Object.entries(counts).some(([domain, count]) => Number(verification.counts?.[domain]) !== count)
  )
    throw new Error('Legacy export verification does not match the records pending removal');
  const exportRoot = path.resolve(process.env.MCP_LEGACY_EXPORT_DIR || '/var/lib/mcp-sentinel/exports');
  const exportFile = path.resolve(String(verification.output || ''));
  if (!exportFile.startsWith(`${exportRoot}${path.sep}`) || !exportFile.endsWith('.json'))
    throw new Error('Legacy export verification references an unsafe export path');
  let exportBytes;
  try {
    exportBytes = await fs.readFile(exportFile);
  } catch (error) {
    throw new Error(`Verified legacy export is unavailable: ${error.message}`);
  }
  if (crypto.createHash('sha256').update(exportBytes).digest('hex') !== verification.sha256)
    throw new Error('Verified legacy export checksum no longer matches');
  let exported;
  try {
    exported = JSON.parse(exportBytes);
  } catch {
    throw new Error('Verified legacy export is not valid JSON');
  }
  if (Object.entries(counts).some(([domain, count]) => Number(exported.counts?.[domain]) !== count))
    throw new Error('Verified legacy export contents do not match the records pending removal');
}

export async function openSqliteState(databaseFile, legacyFile) {
  await fs.mkdir(path.dirname(databaseFile), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(databaseFile);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS state_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `);
  for (const table of Object.values(DOMAINS)) {
    database.exec(`CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;`);
  }
  database.exec(`CREATE TABLE IF NOT EXISTS task_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    state TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  database.exec(`CREATE TABLE IF NOT EXISTS alert_subscriptions (
    id TEXT PRIMARY KEY,
    owner_key TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  database.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key_hash TEXT PRIMARY KEY,
      key_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS capabilities (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS oauth_mappings (
      username TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS jwt_revocations (
      jti TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      revoked_at TEXT NOT NULL
    ) STRICT;
  `);
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(1, new Date().toISOString());
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(2, new Date().toISOString());
  database
    .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
    .run(3, new Date().toISOString());

  const migration4 = database.prepare('SELECT version FROM schema_migrations WHERE version = 4').get();
  if (!migration4) {
    const existingLegacyTables = Object.entries(LEGACY_TABLES).filter(([, table]) =>
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
    );
    const counts = Object.fromEntries(
      existingLegacyTables.map(([domain, table]) => [
        domain,
        database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
      ])
    );
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const marker = database.prepare("SELECT value FROM state_meta WHERE key = 'legacy_export_verified'").get();
    if (total > 0) {
      if (!marker)
        throw new Error(
          'Legacy state contains records; run the 2.0 offline legacy exporter before starting the service'
        );
      await verifyLegacyExport(marker.value, counts);
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const [, table] of existingLegacyTables) database.exec(`DROP TABLE ${table}`);
      database
        .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(4, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  await fs.chmod(databaseFile, 0o600);

  const legacyMigration = database.prepare("SELECT value FROM state_meta WHERE key = 'legacy_migration'").get();
  if (!legacyMigration && legacyFile) {
    try {
      const legacy = JSON.parse(await fs.readFile(legacyFile, 'utf8'));
      const legacyCount = Object.keys(LEGACY_TABLES).reduce(
        (sum, domain) => sum + (Array.isArray(legacy[domain]) ? legacy[domain].length : 0),
        0
      );
      if (legacyCount) {
        const counts = Object.fromEntries(
          Object.keys(LEGACY_TABLES).map(domain => [domain, Array.isArray(legacy[domain]) ? legacy[domain].length : 0])
        );
        let marker;
        try {
          marker = await fs.readFile(`${legacyFile}.legacy-export-verified.json`, 'utf8');
        } catch (error) {
          throw new Error(`Legacy JSON contains removed 1.x domains and has no verified export: ${error.message}`);
        }
        await verifyLegacyExport(marker, counts);
      }
      legacy.projects = (legacy.projects || []).map(normalizeLegacyProject);
      await fs.copyFile(legacyFile, `${legacyFile}.pre-sqlite-backup`);
      saveSqliteState(database, { ...emptyState(), ...legacy });
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Legacy state migration failed: ${error.message}`);
    }
    database
      .prepare("INSERT OR REPLACE INTO state_meta(key, value) VALUES ('legacy_migration', ?)")
      .run(new Date().toISOString());
  }

  const migration5 = database.prepare('SELECT version FROM schema_migrations WHERE version = 5').get();
  if (!migration5) {
    const now = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      const projectRows = database.prepare('SELECT id, payload FROM projects').all();
      const updateProject = database.prepare('UPDATE projects SET payload = ?, updated_at = ? WHERE id = ?');
      const deleteProject = database.prepare('DELETE FROM projects WHERE id = ?');
      const insertProject = database.prepare('INSERT INTO projects(id, payload, updated_at) VALUES (?, ?, ?)');
      for (const row of projectRows) {
        const project = normalizeLegacyProject(JSON.parse(row.payload));
        if (project.id === row.id) updateProject.run(JSON.stringify(project), now, row.id);
        else {
          deleteProject.run(row.id);
          insertProject.run(project.id, JSON.stringify(project), now);
        }
      }
      database
        .prepare('INSERT OR IGNORE INTO hosts(id, payload, updated_at) VALUES (?, ?, ?)')
        .run('local', JSON.stringify(initialLocalHost(now)), now);
      database
        .prepare('INSERT OR IGNORE INTO ssh_policies(id, payload, updated_at) VALUES (?, ?, ?)')
        .run('global', JSON.stringify(initialGlobalSshPolicy(now)), now);
      database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(5, now);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return database;
}

export function loadSqliteState(database) {
  const state = { version: 5, ...emptyState() };
  for (const [key, table] of Object.entries(DOMAINS)) {
    state[key] = database
      .prepare(`SELECT payload FROM ${table} ORDER BY updated_at, id`)
      .all()
      .map(row => JSON.parse(row.payload));
  }
  return state;
}

export function saveSqliteState(database, state) {
  const now = new Date().toISOString();
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const [key, table] of Object.entries(DOMAINS)) {
      database.exec(`DELETE FROM ${table}`);
      const insert = database.prepare(`INSERT INTO ${table}(id, payload, updated_at) VALUES (?, ?, ?)`);
      for (const item of state[key] || []) insert.run(item.id, JSON.stringify(item), now);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function upsertTaskRun(database, run) {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO task_runs(id, project_id, owner, state, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state=excluded.state, payload=excluded.payload, updated_at=excluded.updated_at`
    )
    .run(
      run.runId,
      run.projectId,
      run.owner,
      run.state,
      JSON.stringify(run),
      new Date(run.startedAt).toISOString(),
      now
    );
}

export function loadTaskRun(database, runId) {
  const row = database.prepare('SELECT payload FROM task_runs WHERE id = ?').get(runId);
  return row ? JSON.parse(row.payload) : null;
}
