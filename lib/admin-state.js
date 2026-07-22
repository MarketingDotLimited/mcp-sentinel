import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const databaseFile = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
let database;

function open() {
  if (database) return database;
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true, mode: 0o700 });
  database = new DatabaseSync(databaseFile);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  database.exec('CREATE TABLE IF NOT EXISTS state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;');
  fs.chmodSync(databaseFile, 0o600);
  return database;
}

export function getAdminState(key) {
  if (!/^[a-z0-9_.-]{1,80}$/.test(key)) throw new Error('Invalid state key');
  const row = open().prepare('SELECT value FROM state_meta WHERE key = ?').get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setAdminState(key, value) {
  if (!/^[a-z0-9_.-]{1,80}$/.test(key)) throw new Error('Invalid state key');
  open().prepare('INSERT OR REPLACE INTO state_meta(key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  return value;
}
