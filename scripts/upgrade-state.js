#!/usr/bin/env node
import { openSqliteState } from '../lib/sqlite-state.js';

const databaseFile = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
const database = await openSqliteState(databaseFile);
try {
  const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') throw new Error('SQLite integrity verification failed after migration');
  const versions = database
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map(row => row.version);
  process.stdout.write(`${JSON.stringify({ upgraded: true, databaseFile, versions, integrity })}\n`);
} finally {
  database.close();
}
