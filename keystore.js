import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const KEYS_FILE = process.env.KEYSTORE_FILE || '/var/lib/mcp-sentinel/api-keys.json';
const STATE_DB = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
const USE_LEGACY_JSON = Boolean(process.env.KEYSTORE_FILE && !process.env.MCP_STATE_DB);

let keyStore = {};
let database;

async function openDatabase() {
  if (database) return database;
  await fs.mkdir(path.dirname(STATE_DB), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(STATE_DB);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS api_keys (
      key_hash TEXT PRIMARY KEY,
      key_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  await fs.chmod(STATE_DB, 0o600);
  return database;
}

export async function loadKeystore() {
  if (USE_LEGACY_JSON) {
    try {
      const parsed = JSON.parse(await fs.readFile(KEYS_FILE, 'utf8'));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
        throw new Error('keys.json must contain an object');
      keyStore = parsed;
    } catch (error) {
      if (error.code === 'ENOENT') keyStore = {};
      else throw new Error(`Unable to load keystore: ${error.message}`);
    }
    return;
  }

  const db = await openDatabase();
  const migrated = db.prepare("SELECT value FROM state_meta WHERE key = 'api_key_json_migration'").get();
  if (!migrated) {
    try {
      const parsed = JSON.parse(await fs.readFile(KEYS_FILE, 'utf8'));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
        throw new Error('keys.json must contain an object');
      const insert = db.prepare(
        'INSERT OR IGNORE INTO api_keys(key_hash, key_id, payload, updated_at) VALUES (?, ?, ?, ?)'
      );
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const [hash, entry] of Object.entries(parsed))
          insert.run(hash, entry.keyId || crypto.randomUUID(), JSON.stringify(entry), new Date().toISOString());
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      await fs.copyFile(KEYS_FILE, `${KEYS_FILE}.pre-sqlite-backup`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`API key migration failed: ${error.message}`);
    }
    db.prepare("INSERT OR REPLACE INTO state_meta(key, value) VALUES ('api_key_json_migration', ?)").run(
      new Date().toISOString()
    );
  }
  keyStore = Object.fromEntries(
    db
      .prepare('SELECT key_hash, payload FROM api_keys')
      .all()
      .map(row => [row.key_hash, JSON.parse(row.payload)])
  );
}

async function saveKeystore() {
  if (USE_LEGACY_JSON) {
    await fs.mkdir(path.dirname(KEYS_FILE), { recursive: true, mode: 0o700 });
    const temporary = `${KEYS_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(keyStore, null, 2), { mode: 0o600 });
    await fs.rename(temporary, KEYS_FILE);
    await fs.chmod(KEYS_FILE, 0o600);
    return;
  }
  const db = await openDatabase();
  const insert = db.prepare('INSERT INTO api_keys(key_hash, key_id, payload, updated_at) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DELETE FROM api_keys');
    for (const [hash, entry] of Object.entries(keyStore))
      insert.run(hash, entry.keyId, JSON.stringify(entry), new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function addKeyEntry(key, entryData) {
  const hash = hashKey(key);
  if (keyStore[hash]) throw new Error('An entry for this API key already exists');
  keyStore[hash] = { keyId: crypto.randomUUID(), version: 1, createdAt: new Date().toISOString(), ...entryData };
  await saveKeystore();
  return keyStore[hash];
}

export async function revokeKeyEntry(key) {
  const hash = hashKey(key);
  if (!keyStore[hash] || keyStore[hash].active === false) return false;
  keyStore[hash].active = false;
  keyStore[hash].version++;
  await saveKeystore();
  return true;
}

export async function revokeKeyEntryById(keyId) {
  const entry = Object.values(keyStore).find(candidate => candidate.keyId === keyId);
  if (!entry || entry.active === false) return false;
  entry.active = false;
  entry.version++;
  await saveKeystore();
  return true;
}

export function getKeyEntry(key) {
  return keyStore[hashKey(key)];
}
export function getKeyById(keyId) {
  return Object.values(keyStore).find(entry => entry.keyId === keyId);
}
export function getKeys() {
  return Object.values(keyStore).map(
    ({
      active,
      createdAt,
      role,
      userId,
      scopes,
      label,
      keyId,
      requireApproval,
      projectIds,
      organizationId,
      teamId,
    }) => ({
      keyId,
      active,
      createdAt,
      role,
      userId,
      scopes,
      label,
      requireApproval: requireApproval === true,
      projectIds: Array.isArray(projectIds) ? projectIds : [],
      organizationId: organizationId || null,
      teamId: teamId || null,
    })
  );
}

export async function updateKeyEntry(keyId, updates) {
  const entry = Object.values(keyStore).find(candidate => candidate.keyId === keyId);
  if (!entry) throw new Error('Key not found');
  if (entry.active === false) throw new Error('Cannot update a revoked key');
  for (const field of ['scopes', 'label', 'allowedIPs', 'requireApproval', 'role'])
    if (updates[field] !== undefined) entry[field] = updates[field];
  entry.version++;
  await saveKeystore();
  return entry;
}
