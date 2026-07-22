import fs from 'fs/promises';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const STATE_DB = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
const MAPPINGS_FILE = process.env.AUTHELIA_MAPPINGS_FILE || '/etc/mcp-sentinel/user-mappings.json';
const USE_LEGACY_JSON = Boolean(
  !process.env.MCP_STATE_DB &&
  (process.env.AUTHELIA_MAPPINGS_FILE || process.env.KEYSTORE_FILE || process.env.CONTROL_PLANE_STATE_FILE)
);
let database;

async function openDatabase() {
  if (database) return database;
  await fs.mkdir(path.dirname(STATE_DB), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(STATE_DB);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS oauth_mappings (
      username TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  await fs.chmod(STATE_DB, 0o600);
  const migrated = database.prepare("SELECT value FROM state_meta WHERE key = 'oauth_mapping_json_migration'").get();
  if (!migrated) {
    try {
      const parsed = JSON.parse(await fs.readFile(MAPPINGS_FILE, 'utf8'));
      await writeRows(database, parsed);
      await fs.copyFile(MAPPINGS_FILE, `${MAPPINGS_FILE}.pre-sqlite-backup`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`OAuth mapping migration failed: ${error.message}`);
    }
    database
      .prepare("INSERT OR REPLACE INTO state_meta(key, value) VALUES ('oauth_mapping_json_migration', ?)")
      .run(new Date().toISOString());
  }
  return database;
}

function writeRows(db, mappings) {
  if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings))
    throw new Error('OAuth mappings must be an object');
  const insert = db.prepare('INSERT INTO oauth_mappings(username, payload, updated_at) VALUES (?, ?, ?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM oauth_mappings');
    for (const [username, mapping] of Object.entries(mappings)) {
      if (!/^[A-Za-z0-9_.@-]{1,254}$/.test(username)) throw new Error('Invalid OAuth mapping username');
      insert.run(username, JSON.stringify(mapping), new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function readOAuthMappings() {
  if (USE_LEGACY_JSON) {
    try {
      return JSON.parse(await fs.readFile(MAPPINGS_FILE, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }
  const db = await openDatabase();
  return Object.fromEntries(
    db
      .prepare('SELECT username, payload FROM oauth_mappings ORDER BY username')
      .all()
      .map(row => [row.username, JSON.parse(row.payload)])
  );
}

export async function writeOAuthMappings(mappings) {
  if (USE_LEGACY_JSON) {
    await fs.mkdir(path.dirname(MAPPINGS_FILE), { recursive: true, mode: 0o700 });
    const temporary = `${MAPPINGS_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(mappings, null, 2), { mode: 0o600 });
    await fs.rename(temporary, MAPPINGS_FILE);
    return;
  }
  writeRows(await openDatabase(), mappings);
}
