import fs from 'fs/promises';
import path from 'path';
import { openSqliteState, loadSqliteState } from '../lib/sqlite-state.js';

const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run';
const legacyFile = process.env.CONTROL_PLANE_STATE_FILE;
const databaseFile = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
if (!legacyFile) throw new Error('CONTROL_PLANE_STATE_FILE must identify the legacy control-plane JSON');

let legacy;
try {
  legacy = JSON.parse(await fs.readFile(legacyFile, 'utf8'));
} catch (error) {
  throw new Error(`Cannot read legacy state: ${error.message}`);
}
if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy))
  throw new Error('Legacy state root must be an object');
const domains = [
  'approvals',
  'projects',
  'automations',
  'organizations',
  'teams',
  'fleets',
  'backupTargets',
  'webhooks',
];
const invalidDomains = domains.filter(name => legacy[name] !== undefined && !Array.isArray(legacy[name]));
if (invalidDomains.length) throw new Error(`Legacy state domains must be arrays: ${invalidDomains.join(', ')}`);
const malformedProjects = (legacy.projects || []).filter(
  project => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(project.id || '')
);
const missingProjectPaths = (legacy.projects || []).filter(
  project => !(project.rootPath || project.repoPath || project.path)
);
if (missingProjectPaths.length) throw new Error(`${missingProjectPaths.length} project record(s) have no root path`);

const report = {
  mode,
  source: path.resolve(legacyFile),
  destination: path.resolve(databaseFile),
  counts: Object.fromEntries(domains.map(name => [name, (legacy[name] || []).length])),
  malformedProjectIds: malformedProjects.map(project => project.id || null),
  legacyAliasesToCreate: malformedProjects.length,
  backup: `${legacyFile}.pre-sqlite-backup`,
  idempotenceMarker: 'legacy_migration',
};

if (mode === 'dry-run') {
  process.stdout.write(`${JSON.stringify({ ...report, valid: true }, null, 2)}\n`);
  process.exit(0);
}

const database = await openSqliteState(databaseFile, legacyFile);
try {
  const migrated = loadSqliteState(database);
  const actualCounts = Object.fromEntries(domains.map(name => [name, migrated[name].length]));
  for (const name of domains) {
    if (actualCounts[name] !== report.counts[name]) throw new Error(`Migration count mismatch for ${name}`);
  }
  const aliases = migrated.projects.filter(
    project => Array.isArray(project.legacyIds) && project.legacyIds.length
  ).length;
  if (aliases < report.legacyAliasesToCreate) throw new Error('Legacy project aliases were not preserved');
  const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') throw new Error('Migrated SQLite database failed integrity verification');
  process.stdout.write(`${JSON.stringify({ ...report, applied: true, actualCounts, integrity }, null, 2)}\n`);
} finally {
  database.close();
}
