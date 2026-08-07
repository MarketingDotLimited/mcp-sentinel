import '../test-env.js';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  loadSqliteState,
  loadTaskRun,
  openSqliteState,
  saveSqliteState,
  upsertTaskRun,
} from '../../lib/sqlite-state.js';
import { encryptStateValue } from '../../lib/state-crypto.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('SQLite state migrations', () => {
  it('migrates malformed legacy project IDs once and uses protected WAL state', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sqlite-state-'));
    temporaryDirectories.push(directory);
    const legacyFile = path.join(directory, 'control-plane.json');
    const databaseFile = path.join(directory, 'state.sqlite3');
    await fs.writeFile(
      legacyFile,
      JSON.stringify({
        version: 1,
        approvals: [],
        projects: [{ id: 'rabeeb-main', name: 'Rabeeb', path: '/srv/rabeeb' }],
      })
    );

    const database = await openSqliteState(databaseFile, legacyFile);
    const state = loadSqliteState(database);
    assert.match(state.projects[0].id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(state.projects[0].legacyIds, ['rabeeb-main']);
    assert.equal(state.projects[0].rootPath, '/srv/rabeeb');
    assert.equal(state.projects[0].hostId, 'local');
    assert.equal(state.projects[0].transportKind, 'local');
    assert.equal(state.projects[0].sshAllowed, false);
    assert.equal(state.projects[0].sshEnabled, false);
    assert.equal(state.projects[0].transportPolicyVersion, 1);
    assert.equal(state.hosts.find(host => host.id === 'local').enabled, true);
    assert.equal(state.sshPolicies.find(policy => policy.id === 'global').sshAllowed, false);
    assert.deepEqual(state.sshConnections, []);
    assert.deepEqual(state.identitySshPreferences, []);
    assert.equal(database.prepare('SELECT version FROM schema_migrations WHERE version = 5').get().version, 5);
    assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal((await fs.stat(databaseFile)).mode & 0o777, 0o600);
    await fs.access(`${legacyFile}.pre-sqlite-backup`);

    state.approvals.push({ id: 'approval-1', status: 'pending' });
    saveSqliteState(database, state);
    assert.equal(loadSqliteState(database).approvals[0].id, 'approval-1');
    database.close();

    const reopened = await openSqliteState(databaseFile, legacyFile);
    assert.equal(loadSqliteState(reopened).projects.length, 1);
    reopened.close();
  });

  it('upgrades existing version 4 projects with local transport defaults idempotently', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sqlite-state-v4-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const projectId = '436b432a-206b-43cd-abfa-6291dbef0c50';

    const initialized = await openSqliteState(databaseFile);
    initialized.close();

    const version4 = new DatabaseSync(databaseFile);
    version4.prepare('DELETE FROM schema_migrations WHERE version = 5').run();
    version4.prepare('DELETE FROM schema_migrations WHERE version = 6').run();
    version4.prepare('DELETE FROM hosts').run();
    version4.prepare('DELETE FROM ssh_policies').run();
    version4
      .prepare('INSERT INTO projects(id, payload, updated_at) VALUES (?, ?, ?)')
      .run(
        projectId,
        JSON.stringify({ id: projectId, name: 'Existing project', rootPath: '/srv/existing' }),
        '2026-01-01'
      );
    version4.close();

    const migrated = await openSqliteState(databaseFile);
    const migratedState = loadSqliteState(migrated);
    assert.deepEqual(
      migratedState.projects.map(project => ({
        id: project.id,
        hostId: project.hostId,
        transportKind: project.transportKind,
        sshAllowed: project.sshAllowed,
        sshEnabled: project.sshEnabled,
        transportPolicyVersion: project.transportPolicyVersion,
      })),
      [
        {
          id: projectId,
          hostId: 'local',
          transportKind: 'local',
          sshAllowed: false,
          sshEnabled: false,
          transportPolicyVersion: 1,
        },
      ]
    );
    assert.equal(migratedState.hosts.filter(host => host.id === 'local').length, 1);
    assert.equal(migratedState.sshPolicies.filter(policy => policy.id === 'global').length, 1);
    migrated.close();

    const reopened = await openSqliteState(databaseFile);
    const reopenedState = loadSqliteState(reopened);
    assert.equal(reopenedState.projects.length, 1);
    assert.equal(reopenedState.hosts.filter(host => host.id === 'local').length, 1);
    assert.equal(reopenedState.sshPolicies.filter(policy => policy.id === 'global').length, 1);
    reopened.close();
  });

  it('encrypts secret-bearing fields and complete task results before SQLite persistence', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sqlite-encryption-'));
    temporaryDirectories.push(directory);
    const credentials = path.join(directory, 'credentials');
    const databaseFile = path.join(directory, 'state.sqlite3');
    await fs.mkdir(credentials, { mode: 0o700 });
    await fs.writeFile(path.join(credentials, 'state-key'), 'ab'.repeat(32), { mode: 0o600 });
    const previousDirectory = process.env.CREDENTIALS_DIRECTORY;
    const previousKeyId = process.env.CONTROL_PLANE_KEY_ID;
    process.env.CREDENTIALS_DIRECTORY = credentials;
    process.env.CONTROL_PLANE_KEY_ID = 'test-state-v1';
    try {
      const database = await openSqliteState(databaseFile);
      const state = loadSqliteState(database);
      state.projects.push({
        id: '436b432a-206b-43cd-abfa-6291dbef0c50',
        name: 'Encrypted project',
        rootPath: '/srv/encrypted',
        password: 'database-password-plaintext',
        nested: { refreshToken: 'refresh-token-plaintext' },
      });
      saveSqliteState(database, state);
      upsertTaskRun(database, {
        runId: '4b3c767a-07ae-4591-b8cf-900e35028375',
        projectId: state.projects[0].id,
        owner: 'developer',
        state: 'failed',
        startedAt: Date.now(),
        stdout: 'sensitive-test-output-plaintext',
      });

      const rawProject = database.prepare('SELECT payload FROM projects WHERE id = ?').get(state.projects[0].id);
      const rawRun = database
        .prepare('SELECT payload FROM task_runs WHERE id = ?')
        .get('4b3c767a-07ae-4591-b8cf-900e35028375');
      assert.doesNotMatch(rawProject.payload, /database-password-plaintext|refresh-token-plaintext/);
      assert.doesNotMatch(rawRun.payload, /sensitive-test-output-plaintext/);
      assert.equal(loadSqliteState(database).projects[0].password, 'database-password-plaintext');
      assert.equal(
        loadTaskRun(database, '4b3c767a-07ae-4591-b8cf-900e35028375').stdout,
        'sensitive-test-output-plaintext'
      );
      assert.equal(database.prepare('SELECT version FROM schema_migrations WHERE version = 6').get().version, 6);
      database.close();
    } finally {
      if (previousDirectory === undefined) delete process.env.CREDENTIALS_DIRECTORY;
      else process.env.CREDENTIALS_DIRECTORY = previousDirectory;
      if (previousKeyId === undefined) delete process.env.CONTROL_PLANE_KEY_ID;
      else process.env.CONTROL_PLANE_KEY_ID = previousKeyId;
    }
  });

  it('rolls back transactions when save fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sqlite-rollback-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const database = await openSqliteState(databaseFile);
    const originalExec = database.exec;
    database.exec = sql => {
      if (sql.startsWith('DELETE FROM projects')) throw new Error('Simulated DELETE failure');
      return originalExec.call(database, sql);
    };

    const state = loadSqliteState(database);
    state.projects.push({ id: 'dummy' });
    assert.throws(() => saveSqliteState(database, state), /Simulated DELETE failure/);
    database.exec = originalExec;
    database.close();
  });

  it('rolls back migration 6 if update fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sqlite-rollback-mig6-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const initialized = await openSqliteState(databaseFile);
    initialized.close();

    const version5 = new DatabaseSync(databaseFile);
    version5.prepare('DELETE FROM schema_migrations WHERE version = 6').run();
    version5
      .prepare(
        'INSERT INTO task_runs(id, project_id, owner, state, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('tr1', 'p1', 'me', 'failed', 'INVALID JSON', '2026-01-01', '2026-01-01');
    version5.close();

    const previousDirectory = process.env.CREDENTIALS_DIRECTORY;
    const previousKeyId = process.env.CONTROL_PLANE_KEY_ID;
    process.env.CREDENTIALS_DIRECTORY = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-creds-'));
    temporaryDirectories.push(process.env.CREDENTIALS_DIRECTORY);
    await fs.writeFile(path.join(process.env.CREDENTIALS_DIRECTORY, 'state-key'), 'ab'.repeat(32), { mode: 0o600 });
    process.env.CONTROL_PLANE_KEY_ID = 'test-state-v1';

    try {
      await assert.rejects(openSqliteState(databaseFile), /Unexpected token/i);
    } finally {
      if (previousDirectory === undefined) delete process.env.CREDENTIALS_DIRECTORY;
      else process.env.CREDENTIALS_DIRECTORY = previousDirectory;
      if (previousKeyId === undefined) delete process.env.CONTROL_PLANE_KEY_ID;
      else process.env.CONTROL_PLANE_KEY_ID = previousKeyId;
    }
  });

  it('covers verifyLegacyExport error paths', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-errors-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const legacyFile = path.join(directory, 'control-plane.json');
    const markerFile = `${legacyFile}.legacy-export-verified.json`;
    const fullCounts = { automations: 1, fleets: 0, backupTargets: 0, webhooks: 0 };

    // 1. Missing verified export
    await fs.writeFile(legacyFile, JSON.stringify({ automations: [{ id: '1' }] }));
    await assert.rejects(openSqliteState(databaseFile, legacyFile), /has no verified export/);

    // 2. Invalid marker JSON
    await fs.writeFile(markerFile, 'NOT JSON');
    await assert.rejects(openSqliteState(databaseFile, legacyFile), /marker is invalid/);

    // 3. Missing sha256 or counts mismatch
    await fs.writeFile(markerFile, JSON.stringify({ output: '/var/lib/mcp-sentinel/exports/a.json' }));
    await assert.rejects(openSqliteState(databaseFile, legacyFile), /does not match the records pending removal/);

    // 4. Unsafe export path
    process.env.MCP_LEGACY_EXPORT_DIR = directory;
    await fs.writeFile(markerFile, JSON.stringify({ sha256: 'a', counts: fullCounts, output: '/etc/passwd' }));
    await assert.rejects(openSqliteState(databaseFile, legacyFile), /unsafe export path/);

    // 5. Unavailable export
    await fs.writeFile(
      markerFile,
      JSON.stringify({ sha256: 'a', counts: fullCounts, output: path.join(directory, 'a.json') })
    );
    await assert.rejects(openSqliteState(databaseFile, legacyFile), /unavailable/);

    // 6. Checksum mismatch
    const exportFile = path.join(directory, 'a.json');
    await fs.writeFile(exportFile, '{}');
    await assert.rejects(openSqliteState(databaseFile, legacyFile), /checksum no longer matches/);

    // 7. Export not valid JSON
    const exportBytes = 'NOT JSON';
    const sha256 = crypto.createHash('sha256').update(exportBytes).digest('hex');
    await fs.writeFile(exportFile, exportBytes);
    await fs.writeFile(markerFile, JSON.stringify({ sha256, counts: fullCounts, output: exportFile }));
    await assert.rejects(openSqliteState(databaseFile, legacyFile), /not valid JSON/);

    // 8. Export counts mismatch
    const exportBytes2 = JSON.stringify({ counts: { automations: 0 } });
    const sha256_2 = crypto.createHash('sha256').update(exportBytes2).digest('hex');
    await fs.writeFile(exportFile, exportBytes2);
    await fs.writeFile(markerFile, JSON.stringify({ sha256: sha256_2, counts: fullCounts, output: exportFile }));
    await assert.rejects(openSqliteState(databaseFile, legacyFile), /contents do not match/);

    // 9. Legacy state migration fails (ENOENT is ignored, but other errors throw)
    await fs.mkdir(path.join(directory, 'dir.json'));
    await assert.rejects(
      openSqliteState(path.join(directory, 'new.db'), path.join(directory, 'dir.json')),
      /Legacy state migration failed/
    );

    // 10. Success path
    const successExport = JSON.stringify({ counts: fullCounts });
    const successSha = crypto.createHash('sha256').update(successExport).digest('hex');
    await fs.writeFile(exportFile, successExport);
    await fs.writeFile(markerFile, JSON.stringify({ sha256: successSha, counts: fullCounts, output: exportFile }));
    await fs.writeFile(
      legacyFile,
      JSON.stringify({
        automations: [{ id: '1' }],
        projects: [
          { name: 'no-id', path: '/foo' },
          { id: '', path: '/bar' },
        ],
      })
    );
    const successDb = await openSqliteState(path.join(directory, 'success.db'), legacyFile);
    successDb.close();
  });

  it('covers SQLite legacy tables missing and success marker', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-sqlite-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const database = new DatabaseSync(databaseFile);
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      CREATE TABLE state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE automations(id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      INSERT INTO automations VALUES ('1', '{}', '2026');
      INSERT INTO schema_migrations VALUES (1, '2026'), (2, '2026'), (3, '2026');
    `);
    database.close();

    await assert.rejects(openSqliteState(databaseFile), /offline legacy exporter before starting/);

    const exportFile = path.join(directory, 'a.json');
    const fullCounts = { automations: 1, fleets: 0, backupTargets: 0, webhooks: 0 };
    const successExport = JSON.stringify({ counts: fullCounts });
    const successSha = crypto.createHash('sha256').update(successExport).digest('hex');
    await fs.writeFile(exportFile, successExport);

    const db2 = new DatabaseSync(databaseFile);
    db2
      .prepare("INSERT INTO state_meta(key, value) VALUES ('legacy_export_verified', ?)")
      .run(JSON.stringify({ sha256: successSha, counts: fullCounts, output: exportFile }));
    db2.close();

    process.env.MCP_LEGACY_EXPORT_DIR = directory;
    const opened = await openSqliteState(databaseFile);
    opened.close();
  });

  it('rolls back legacy tables drop', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-drop-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const database = new DatabaseSync(databaseFile);
    database.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
      CREATE TABLE state_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE automations(id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      INSERT INTO schema_migrations VALUES (1, '2026'), (2, '2026'), (3, '2026');
    `);
    database.close();

    const originalExec = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function (sql) {
      if (sql.includes('DROP TABLE automations')) throw new Error('Simulated drop failure');
      return originalExec.call(this, sql);
    };
    try {
      await assert.rejects(openSqliteState(databaseFile), /Simulated drop failure/);
    } finally {
      DatabaseSync.prototype.exec = originalExec;
    }
  });

  it('migration 5 replaces malformed project IDs', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-mig5-id-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const initialized = await openSqliteState(databaseFile);
    initialized.close();

    const version4 = new DatabaseSync(databaseFile);
    version4.prepare('DELETE FROM schema_migrations WHERE version = 5').run();
    version4.prepare('DELETE FROM schema_migrations WHERE version = 6').run();
    version4
      .prepare('INSERT INTO projects(id, payload, updated_at) VALUES (?, ?, ?)')
      .run('invalid', JSON.stringify({ id: 'invalid', rootPath: '/' }), '2026-01-01');
    version4.close();

    const migrated = await openSqliteState(databaseFile);
    const state = loadSqliteState(migrated);
    assert.equal(state.projects.length, 1);
    assert.notEqual(state.projects[0].id, 'invalid');
    migrated.close();
  });

  it('rolls back migration 5 on error', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-mig5-rollback-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const initialized = await openSqliteState(databaseFile);
    initialized.close();

    const version4 = new DatabaseSync(databaseFile);
    version4.prepare('DELETE FROM schema_migrations WHERE version = 5').run();
    version4.prepare('DELETE FROM schema_migrations WHERE version = 6').run();
    version4
      .prepare('INSERT INTO projects(id, payload, updated_at) VALUES (?, ?, ?)')
      .run('p1', 'INVALID JSON', '2026-01-01');
    version4.close();

    await assert.rejects(openSqliteState(databaseFile), /Unexpected token/i);
  });

  it('verifyLegacyExport falls back to default export root', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-fallback-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const legacyFile = path.join(directory, 'control-plane.json');
    const markerFile = `${legacyFile}.legacy-export-verified.json`;

    await fs.writeFile(
      legacyFile,
      JSON.stringify({
        automations: [{ id: '1' }],
        projects: [
          { name: 'no-id', path: '/foo' },
          { id: '', path: '/bar' },
        ],
      })
    );
    await fs.writeFile(
      markerFile,
      JSON.stringify({ sha256: 'a', counts: { automations: 1, fleets: 0, backupTargets: 0, webhooks: 0 } })
    );

    const previous = process.env.MCP_LEGACY_EXPORT_DIR;
    delete process.env.MCP_LEGACY_EXPORT_DIR;

    try {
      await assert.rejects(openSqliteState(databaseFile, legacyFile), /unsafe export path/);
    } finally {
      if (previous !== undefined) process.env.MCP_LEGACY_EXPORT_DIR = previous;
    }
  });

  it('migration 6 handles already encrypted task runs', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-mig6-encrypted-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const initialized = await openSqliteState(databaseFile);
    initialized.close();

    const previousDirectory = process.env.CREDENTIALS_DIRECTORY;
    const previousKeyId = process.env.CONTROL_PLANE_KEY_ID;
    process.env.CREDENTIALS_DIRECTORY = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-creds-'));
    temporaryDirectories.push(process.env.CREDENTIALS_DIRECTORY);
    await fs.writeFile(path.join(process.env.CREDENTIALS_DIRECTORY, 'state-key'), 'ab'.repeat(32), { mode: 0o600 });
    process.env.CONTROL_PLANE_KEY_ID = 'test-state-v1';

    const encryptedPayload = encryptStateValue({ stdout: 'hello' });
    const version5 = new DatabaseSync(databaseFile);
    version5.prepare('DELETE FROM schema_migrations WHERE version = 6').run();
    version5
      .prepare(
        'INSERT INTO task_runs(id, project_id, owner, state, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('tr1', 'p1', 'me', 'failed', JSON.stringify(encryptedPayload), '2026-01-01', '2026-01-01');
    version5
      .prepare(
        'INSERT INTO task_runs(id, project_id, owner, state, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('tr2', 'p1', 'me', 'failed', JSON.stringify({ runId: 'tr2', stdout: 'hello' }), '2026-01-01', '2026-01-01');
    version5.close();

    try {
      const db = await openSqliteState(databaseFile);
      db.close();
    } finally {
      if (previousDirectory === undefined) delete process.env.CREDENTIALS_DIRECTORY;
      else process.env.CREDENTIALS_DIRECTORY = previousDirectory;
      if (previousKeyId === undefined) delete process.env.CONTROL_PLANE_KEY_ID;
      else process.env.CONTROL_PLANE_KEY_ID = previousKeyId;
    }
  });

  it('saveSqliteState handles missing domains in state', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-save-missing-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const database = await openSqliteState(databaseFile);
    const state = loadSqliteState(database);
    delete state.projects;
    saveSqliteState(database, state);
    database.close();
  });

  it('loadTaskRun returns null for unknown task', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-loadtask-null-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const database = await openSqliteState(databaseFile);
    const result = loadTaskRun(database, 'unknown');
    assert.equal(result, null);
    database.close();
  });

  it('handles legacy state missing projects array', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-legacy-no-projects-'));
    temporaryDirectories.push(directory);
    const databaseFile = path.join(directory, 'state.sqlite3');
    const legacyFile = path.join(directory, 'control-plane.json');
    const markerFile = `${legacyFile}.legacy-export-verified.json`;
    const fullCounts = { automations: 0, fleets: 0, backupTargets: 0, webhooks: 0 };

    await fs.writeFile(legacyFile, JSON.stringify({ version: 1 }));

    const successExport = JSON.stringify({ counts: fullCounts });
    const successSha = crypto.createHash('sha256').update(successExport).digest('hex');
    await fs.writeFile(path.join(directory, 'a.json'), successExport);
    await fs.writeFile(
      markerFile,
      JSON.stringify({ sha256: successSha, counts: fullCounts, output: path.join(directory, 'a.json') })
    );

    const db = await openSqliteState(databaseFile, legacyFile);
    db.close();
  });
});
