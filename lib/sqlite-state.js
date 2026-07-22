import { DatabaseSync } from 'node:sqlite';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DOMAINS = {
  approvals: 'approvals',
  projects: 'projects',
  automations: 'automations',
  organizations: 'organizations',
  teams: 'teams',
  fleets: 'fleet',
  backupTargets: 'backup_targets',
  webhooks: 'webhooks',
};

function emptyState() {
  return Object.fromEntries(Object.keys(DOMAINS).map(key => [key, []]));
}

function normalizeLegacyProject(project) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(project.id || ''))
    return project;
  const rootPath = project.rootPath || project.repoPath || project.path;
  return {
    ...project,
    id: crypto.randomUUID(),
    legacyIds: [...new Set([...(project.legacyIds || []), project.id].filter(Boolean))],
    rootPath,
    repoPath: project.repoPath || rootPath,
  };
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
  await fs.chmod(databaseFile, 0o600);

  const legacyMigration = database.prepare("SELECT value FROM state_meta WHERE key = 'legacy_migration'").get();
  if (!legacyMigration && legacyFile) {
    try {
      const legacy = JSON.parse(await fs.readFile(legacyFile, 'utf8'));
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
  return database;
}

export function loadSqliteState(database) {
  const state = { version: 2, ...emptyState() };
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
