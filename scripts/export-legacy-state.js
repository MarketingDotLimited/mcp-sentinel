import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

if (process.env.MCP_LEGACY_EXPORT_OFFLINE !== 'true')
  throw new Error('Legacy export requires MCP_LEGACY_EXPORT_OFFLINE=true after stopping the API and broker services');

const databaseFile = path.resolve(process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3');
const legacyJsonFile = process.env.MCP_LEGACY_JSON_FILE ? path.resolve(process.env.MCP_LEGACY_JSON_FILE) : null;
const exportRoot = path.resolve(process.env.MCP_LEGACY_EXPORT_DIR || '/var/lib/mcp-sentinel/exports');
const requestedOutput = process.argv[2];
if (!requestedOutput) throw new Error('Usage: node scripts/export-legacy-state.js /absolute/path/to/export.json');
const output = path.resolve(requestedOutput);
if (!output.startsWith(`${exportRoot}${path.sep}`) || !output.endsWith('.json'))
  throw new Error('Legacy export must be a JSON file inside MCP_LEGACY_EXPORT_DIR');

const domains = {
  automations: 'automations',
  fleets: 'fleet',
  backupTargets: 'backup_targets',
  webhooks: 'webhooks',
};

function redact(value, key = '') {
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, redact(child, name)]));
  return /password|secret|token|credential|authorization|key/i.test(key) ? '[REDACTED]' : value;
}

await fs.mkdir(exportRoot, { recursive: true, mode: 0o700 });
const records = {};
const counts = {};
let database = null;
if (legacyJsonFile) {
  const legacy = JSON.parse(await fs.readFile(legacyJsonFile, 'utf8'));
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy))
    throw new Error('Legacy JSON state root must be an object');
  for (const domain of Object.keys(domains)) {
    if (legacy[domain] !== undefined && !Array.isArray(legacy[domain]))
      throw new Error(`Legacy JSON domain '${domain}' must be an array`);
    records[domain] = redact(legacy[domain] || []);
    counts[domain] = records[domain].length;
  }
} else {
  database = new DatabaseSync(databaseFile);
  try {
    for (const [domain, table] of Object.entries(domains)) {
      const exists = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      records[domain] = exists
        ? database
            .prepare(`SELECT payload FROM ${table} ORDER BY updated_at, id`)
            .all()
            .map(row => redact(JSON.parse(row.payload)))
        : [];
      counts[domain] = records[domain].length;
    }
  } catch (error) {
    database.close();
    throw error;
  }
}
try {
  const exportedAt = new Date().toISOString();
  const source = legacyJsonFile || databaseFile;
  const sourceType = legacyJsonFile ? 'json' : 'sqlite';
  const document = JSON.stringify({ version: 1, exportedAt, source, sourceType, counts, records }, null, 2);
  const sha256 = crypto.createHash('sha256').update(document).digest('hex');
  const temporary = `${output}.${process.pid}.tmp`;
  await fs.writeFile(temporary, document, { mode: 0o600, flag: 'wx' });
  await fs.rename(temporary, output);
  await fs.chmod(output, 0o600);
  const verified = crypto
    .createHash('sha256')
    .update(await fs.readFile(output))
    .digest('hex');
  if (verified !== sha256) throw new Error('Legacy export verification failed');
  const marker = JSON.stringify({ output, sha256, counts, exportedAt });
  if (legacyJsonFile) {
    const markerFile = `${legacyJsonFile}.legacy-export-verified.json`;
    const markerTemporary = `${markerFile}.${process.pid}.tmp`;
    await fs.writeFile(markerTemporary, marker, { mode: 0o600, flag: 'wx' });
    await fs.rename(markerTemporary, markerFile);
    await fs.chmod(markerFile, 0o600);
  } else {
    database.exec('CREATE TABLE IF NOT EXISTS state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT');
    database.prepare("INSERT OR REPLACE INTO state_meta(key, value) VALUES ('legacy_export_verified', ?)").run(marker);
  }
  process.stdout.write(`${JSON.stringify({ output, sourceType, sha256, counts, verified: true })}\n`);
} finally {
  database?.close();
}
