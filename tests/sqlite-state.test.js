import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { loadSqliteState, loadTaskRun, openSqliteState, saveSqliteState, upsertTaskRun } from '../lib/sqlite-state.js';

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
});
