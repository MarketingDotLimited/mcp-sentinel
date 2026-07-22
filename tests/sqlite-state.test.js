import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadSqliteState, openSqliteState, saveSqliteState } from '../lib/sqlite-state.js';

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
});
