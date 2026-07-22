import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-database-execution-'));
const credentials = path.join(directory, 'credentials');
const caRoot = path.join(directory, 'ca');
const registry = path.join(directory, 'databases.json');
await fs.mkdir(credentials);
await fs.mkdir(caRoot);
await fs.writeFile(path.join(credentials, 'db-password'), 'secret\n', { mode: 0o600 });
await fs.writeFile(path.join(caRoot, 'root.pem'), 'test-ca', { mode: 0o600 });
const base = {
  host: 'database.example.test',
  database: 'application',
  user: 'sentinel',
  passwordCredential: 'db-password',
  tls: { rejectUnauthorized: true, caFile: path.join(caRoot, 'root.pem') },
  maxRows: 2,
  maxBytes: 1024,
  queryTimeout: 1000,
};
await fs.writeFile(
  registry,
  JSON.stringify({
    pg_read: { ...base, driver: 'pg', mode: 'read' },
    pg_write: { ...base, driver: 'pg', mode: 'write' },
    mysql_read: { ...base, driver: 'mysql', mode: 'read' },
    mysql_write: { ...base, driver: 'mysql', mode: 'write' },
  })
);
process.env.NODE_ENV = 'test';
process.env.DB_CONFIG_FILE = registry;
process.env.DB_CA_ROOT = caRoot;
process.env.CREDENTIALS_DIRECTORY = credentials;
const database = await import(`../tools/db.js?test=${Date.now()}`);
const pgQueries = [];
class FakePgClient {
  async connect() {}
  async query(input) {
    pgQueries.push(input);
    if (typeof input === 'object') return { rows: [[1], [2], [3]], rowCount: 3, fields: [{ name: 'value' }] };
    return { rows: [] };
  }
  async end() {}
}
const mysqlQueries = [];
const fakeMysqlConnection = {
  async query(value) {
    mysqlQueries.push(value);
  },
  async beginTransaction() {},
  async execute(input) {
    mysqlQueries.push(input);
    return [[{ value: 1 }, { value: 2 }, { value: 3 }], [{ name: 'value' }]];
  },
  async rollback() {},
  async commit() {},
  async end() {},
};
database.setDatabaseAdaptersForTesting({
  pg: { Client: FakePgClient },
  mysql: { createConnection: async () => fakeMysqlConnection },
});

after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('registered TLS database execution', () => {
  it('runs PostgreSQL reads in read-only transactions and bounds results', async () => {
    const result = await database.executeQuery({ alias: 'pg_read', query: 'SELECT value FROM example' }, {});
    assert.equal(result.mode, 'read');
    assert.equal(result.rows.length, 2);
    assert.equal(result.truncated, true);
    assert.ok(pgQueries.includes('SET TRANSACTION READ ONLY'));
    assert.ok(pgQueries.includes('ROLLBACK'));
  });

  it('requires write aliases and explicit confirmation for mutations', async () => {
    await assert.rejects(
      database.executeQuery({ alias: 'pg_read', query: 'UPDATE example SET value = 1', confirm: true }, {}),
      /read-only/
    );
    await assert.rejects(
      database.executeQuery({ alias: 'pg_write', query: 'UPDATE example SET value = 1' }, {}),
      /confirm/
    );
    const result = await database.executeQuery(
      { alias: 'pg_write', query: 'UPDATE example SET value = 1', confirm: true },
      {}
    );
    assert.equal(result.rowCount, 3);
    assert.ok(pgQueries.includes('COMMIT'));
  });

  it('runs MySQL reads and writes through separate aliases', async () => {
    const read = await database.executeQuery({ alias: 'mysql_read', query: 'SHOW TABLES' }, {});
    assert.equal(read.rows.length, 2);
    assert.ok(mysqlQueries.includes('SET TRANSACTION READ ONLY'));
    const write = await database.executeQuery(
      { alias: 'mysql_write', query: 'DELETE FROM example', confirm: true },
      {}
    );
    assert.equal(write.rowCount, 3);
  });

  it('rejects invalid aliases, params, and server-side file operations', async () => {
    await assert.rejects(database.executeQuery({ alias: '../bad', query: 'SELECT 1' }, {}), /Invalid database alias/);
    await assert.rejects(
      database.executeQuery({ alias: 'pg_read', query: 'SELECT 1', params: 'bad' }, {}),
      /params must be an array/
    );
    assert.throws(() => database.classifyQuery("SELECT pg_read_file('/etc/passwd')"), /forbidden/);
    assert.throws(() => database.classifyQuery('SELECT 1; SELECT 2'), /Only one/);
  });
});
