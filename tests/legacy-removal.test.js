import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { openSqliteState } from '../lib/sqlite-state.js';

const execute = promisify(execFile);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(item => fs.rm(item, { recursive: true, force: true })));
});

function createLegacyDatabase(databaseFile) {
  const database = new DatabaseSync(databaseFile);
  database.exec(`
    CREATE TABLE state_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE automations(id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE fleet(id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE backup_targets(id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE webhooks(id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
  `);
  database
    .prepare('INSERT INTO webhooks VALUES (?, ?, ?)')
    .run(
      'hook-1',
      JSON.stringify({ id: 'hook-1', url: 'https://example.test', secret: 'live-secret' }),
      new Date().toISOString()
    );
  database.close();
}

describe('Sentinel 2.0 legacy removal gate', () => {
  it('refuses to drop non-empty legacy tables without a verified export', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-gate-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    createLegacyDatabase(databaseFile);
    await assert.rejects(openSqliteState(databaseFile), /offline legacy exporter/);
  });

  it('exports redacted records, records the hash, and transactionally removes legacy tables', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-export-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const exportDirectory = path.join(directory, 'exports');
    const output = path.join(exportDirectory, 'legacy.json');
    createLegacyDatabase(databaseFile);
    const environment = {
      ...process.env,
      MCP_STATE_DB: databaseFile,
      MCP_LEGACY_EXPORT_DIR: exportDirectory,
      MCP_LEGACY_EXPORT_OFFLINE: 'true',
    };
    const exported = JSON.parse(
      (
        await execute(process.execPath, ['scripts/export-legacy-state.js', output], {
          cwd: process.cwd(),
          env: environment,
        })
      ).stdout
    );
    assert.equal(exported.verified, true);
    assert.equal(exported.counts.webhooks, 1);
    assert.equal((await fs.stat(output)).mode & 0o777, 0o600);
    const document = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(document.records.webhooks[0].secret, '[REDACTED]');

    const previousExportRoot = process.env.MCP_LEGACY_EXPORT_DIR;
    process.env.MCP_LEGACY_EXPORT_DIR = exportDirectory;
    const database = await openSqliteState(databaseFile);
    assert.equal(database.prepare('SELECT version FROM schema_migrations WHERE version = 4').get().version, 4);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'webhooks'").get()
        .count,
      0
    );
    database.close();
    if (previousExportRoot === undefined) delete process.env.MCP_LEGACY_EXPORT_DIR;
    else process.env.MCP_LEGACY_EXPORT_DIR = previousExportRoot;
  });

  it('refuses removal when the previously verified export is missing or modified', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-export-tamper-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const exportDirectory = path.join(directory, 'exports');
    const output = path.join(exportDirectory, 'legacy.json');
    createLegacyDatabase(databaseFile);
    const environment = {
      ...process.env,
      MCP_STATE_DB: databaseFile,
      MCP_LEGACY_EXPORT_DIR: exportDirectory,
      MCP_LEGACY_EXPORT_OFFLINE: 'true',
    };
    await execute(process.execPath, ['scripts/export-legacy-state.js', output], {
      cwd: process.cwd(),
      env: environment,
    });
    await fs.appendFile(output, '\n');
    const previousExportRoot = process.env.MCP_LEGACY_EXPORT_DIR;
    process.env.MCP_LEGACY_EXPORT_DIR = exportDirectory;
    try {
      await assert.rejects(openSqliteState(databaseFile), /checksum no longer matches/);
    } finally {
      if (previousExportRoot === undefined) delete process.env.MCP_LEGACY_EXPORT_DIR;
      else process.env.MCP_LEGACY_EXPORT_DIR = previousExportRoot;
    }
  });

  it('requires offline mode and a bounded export destination', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-export-errors-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const exportDirectory = path.join(directory, 'exports');
    createLegacyDatabase(databaseFile);
    await assert.rejects(
      execute(process.execPath, ['scripts/export-legacy-state.js', path.join(exportDirectory, 'legacy.json')], {
        cwd: process.cwd(),
        env: { ...process.env, MCP_STATE_DB: databaseFile, MCP_LEGACY_EXPORT_DIR: exportDirectory },
      }),
      /MCP_LEGACY_EXPORT_OFFLINE/
    );
    await assert.rejects(
      execute(process.execPath, ['scripts/export-legacy-state.js', path.join(directory, 'outside.json')], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          MCP_STATE_DB: databaseFile,
          MCP_LEGACY_EXPORT_DIR: exportDirectory,
          MCP_LEGACY_EXPORT_OFFLINE: 'true',
        },
      }),
      /inside MCP_LEGACY_EXPORT_DIR/
    );
  });

  it('reports removed JSON domains during dry-run and migrates only supported 2.0 domains', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-json-'));
    temporaryDirectories.push(directory);
    const legacyFile = path.join(directory, 'state.json');
    const databaseFile = path.join(directory, 'state.sqlite3');
    const environment = {
      ...process.env,
      CONTROL_PLANE_STATE_FILE: legacyFile,
      MCP_STATE_DB: databaseFile,
    };
    await fs.writeFile(
      legacyFile,
      JSON.stringify({
        approvals: [],
        projects: [{ id: 'old-project', name: 'Migrated', path: '/srv/migrated' }],
        organizations: [],
        teams: [],
        webhooks: [{ id: 'old-hook' }],
      })
    );
    await assert.rejects(
      execute(process.execPath, ['scripts/migrate-state.js', '--dry-run'], { cwd: process.cwd(), env: environment }),
      error => {
        const report = JSON.parse(error.stdout);
        assert.equal(report.valid, false);
        assert.equal(report.removedDomainCounts.webhooks, 1);
        assert.match(report.blockingReason, /before applying the 2\.0 migration/);
        return true;
      }
    );

    const exportDirectory = path.join(directory, 'exports');
    const exportFile = path.join(exportDirectory, 'legacy.json');
    await execute(process.execPath, ['scripts/export-legacy-state.js', exportFile], {
      cwd: process.cwd(),
      env: {
        ...environment,
        MCP_LEGACY_JSON_FILE: legacyFile,
        MCP_LEGACY_EXPORT_DIR: exportDirectory,
        MCP_LEGACY_EXPORT_OFFLINE: 'true',
      },
    });
    environment.MCP_LEGACY_EXPORT_DIR = exportDirectory;
    const verifiedReport = JSON.parse(
      (
        await execute(process.execPath, ['scripts/migrate-state.js', '--dry-run'], {
          cwd: process.cwd(),
          env: environment,
        })
      ).stdout
    );
    assert.equal(verifiedReport.valid, true);
    assert.equal(verifiedReport.exportVerified, true);
    const applied = JSON.parse(
      (
        await execute(process.execPath, ['scripts/migrate-state.js', '--apply'], {
          cwd: process.cwd(),
          env: environment,
        })
      ).stdout
    );
    assert.equal(applied.applied, true);
    assert.equal(applied.integrity, 'ok');
    assert.equal(applied.actualCounts.projects, 1);
  });
});
