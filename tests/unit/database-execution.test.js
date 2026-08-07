import "../test-env.js";
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
    pg_no_ca: { ...base, driver: 'pg', mode: 'read', port: 5433, tls: { rejectUnauthorized: true } },
    pg_ca_root: { ...base, driver: 'pg', mode: 'read', tls: { rejectUnauthorized: true, caFile: caRoot } },
  })
);
process.env.NODE_ENV = 'test';
process.env.DB_CONFIG_FILE = registry;
process.env.DB_CA_ROOT = caRoot;
process.env.CREDENTIALS_DIRECTORY = credentials;
const database = await import(`../../tools/db.js?test=${Date.now()}`);
const pgQueries = [];
let pgRollbackThrow = false;
class FakePgClient {
  async connect() {}
  async query(input) {
    pgQueries.push(input);
    if (input === 'ROLLBACK' && pgRollbackThrow) {
      pgRollbackThrow = false;
      throw new Error('pg rollback error');
    }
    if (input.text?.includes('pg_error_trigger_safe')) {
      throw new Error('pg safe error');
    }
    if (input.text?.includes('pg_error_trigger')) {
      pgRollbackThrow = true;
      throw new Error('pg error');
    }
    if (input.text?.includes('pg_no_rows_trigger')) return { rowCount: 0 };
    if (input.text?.includes('pg_bytes_trigger'))
      return { rows: [{ value: 'a'.repeat(2000) }], rowCount: 1, fields: [{ name: 'value' }] };
    if (typeof input === 'object') return { rows: [[1], [2], [3]], rowCount: 3, fields: [{ name: 'value' }] };
    return { rows: [] };
  }
  async end() {}
}

const mysqlQueries = [];
let mysqlRollbackThrow = false;
const fakeMysqlConnection = {
  async query(value) {
    mysqlQueries.push(value);
  },
  async beginTransaction() {},
  async execute(input) {
    mysqlQueries.push(input);
    if (input.sql?.includes('mysql_error_trigger_safe')) {
      throw new Error('mysql safe error');
    }
    if (input.sql?.includes('mysql_error_trigger')) {
      mysqlRollbackThrow = true;
      throw new Error('mysql error');
    }
    if (input.sql?.includes('mysql_no_fields_trigger')) return [[{ value: 1 }], undefined];
    if (input.sql?.includes('mysql_object_trigger')) return [{ affectedRows: 5 }, undefined];
    return [[{ value: 1 }, { value: 2 }, { value: 3 }], [{ name: 'value' }]];
  },
  async rollback() {
    if (mysqlRollbackThrow) {
      mysqlRollbackThrow = false;
      throw new Error('mysql rollback error');
    }
  },
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
    await assert.rejects(database.executeQuery({ alias: 'unregistered', query: 'SELECT 1' }, {}), /is not registered/);
    await assert.rejects(
      database.executeQuery({ alias: 'pg_read', query: 'SELECT 1', params: 'bad' }, {}),
      /params must be an array/
    );
    assert.throws(() => database.classifyQuery("SELECT pg_read_file('/etc/passwd')"), /forbidden/);
    assert.throws(() => database.classifyQuery('SELECT 1; SELECT 2'), /Only one/);
  });

  it('rolls back on error and throws (pg)', async () => {
    await assert.rejects(database.executeQuery({ alias: 'pg_read', query: 'SELECT pg_error_trigger' }, {}), /pg error/);
  });

  it('rolls back on error and throws (mysql)', async () => {
    await assert.rejects(
      database.executeQuery({ alias: 'mysql_read', query: 'SELECT mysql_error_trigger' }, {}),
      /mysql error/
    );
  });

  it('handles non-array results for mysql', async () => {
    const result = await database.executeQuery(
      { alias: 'mysql_write', query: 'UPDATE mysql_object_trigger SET x=1', confirm: true },
      {}
    );
    assert.equal(result.rowCount, 5);
  });

  it('handles undefined rows for pg', async () => {
    const result = await database.executeQuery(
      { alias: 'pg_write', query: 'UPDATE pg_no_rows_trigger SET x=1', confirm: true },
      {}
    );
    assert.equal(result.rowCount, 0);
  });

  it('handles undefined fields for mysql', async () => {
    const result = await database.executeQuery({ alias: 'mysql_read', query: 'SELECT mysql_no_fields_trigger' }, {});
    assert.equal(result.rows.length, 1);
  });

  it('truncates by maxBytes', async () => {
    const result = await database.executeQuery({ alias: 'pg_read', query: 'SELECT pg_bytes_trigger' }, {});
    assert.equal(result.truncated, true);
    assert.equal(result.rows.length, 0);
  });

  it('handles query > 102400 bytes', async () => {
    await assert.rejects(
      database.executeQuery({ alias: 'pg_read', query: 'a'.repeat(102401) }, {}),
      /query is required/
    );
  });

  it('handles query with no verb', async () => {
    await assert.rejects(database.executeQuery({ alias: 'pg_read', query: '12345' }, {}), /Unable to classify/);
  });

  it('handles config with no caFile and custom port', async () => {
    const result = await database.executeQuery({ alias: 'pg_no_ca', query: 'SELECT 1' }, {});
    assert.equal(result.rowCount, 3);
  });

  it('handles config where caFile equals caRoot', async () => {
    await assert.rejects(database.executeQuery({ alias: 'pg_ca_root', query: 'SELECT 1' }, {}), /EISDIR/);
  });

  it('handles bad configurations', async () => {
    await fs.writeFile(
      registry,
      JSON.stringify({
        bad_host: { mode: 'read', driver: 'pg' },
        bad_user: { mode: 'read', driver: 'pg', host: 'h', database: 'd' },
        bad_tls: { mode: 'read', driver: 'pg', host: 'h', database: 'd', user: 'u' },
        bad_ca_file: {
          mode: 'read',
          driver: 'pg',
          host: 'h',
          database: 'd',
          user: 'u',
          tls: { rejectUnauthorized: true, caFile: '/tmp/outside' },
        },
        custom_bounds: {
          mode: 'read',
          driver: 'pg',
          host: 'h',
          database: 'd',
          user: 'u',
          passwordCredential: 'db-password',
          tls: { rejectUnauthorized: true },
          maxRows: 9999,
          maxBytes: 9999999,
          queryTimeout: 99999,
        },
        custom_bounds_low: {
          mode: 'read',
          driver: 'pg',
          host: 'h',
          database: 'd',
          user: 'u',
          passwordCredential: 'db-password',
          tls: { rejectUnauthorized: true },
          maxRows: 0,
          maxBytes: 0,
          queryTimeout: 0,
        },
        bad_driver: { mode: 'read', driver: 'oracle', host: 'h', database: 'd', user: 'u' },
        bad_mode: { mode: 'execute', driver: 'pg', host: 'h', database: 'd', user: 'u' },
      })
    );

    await assert.rejects(database.executeQuery({ alias: 'bad_host', query: 'SELECT 1' }, {}), /Database host/);
    await assert.rejects(database.executeQuery({ alias: 'bad_user', query: 'SELECT 1' }, {}), /Database user/);
    await assert.rejects(database.executeQuery({ alias: 'bad_tls', query: 'SELECT 1' }, {}), /require verified TLS/);
    await assert.rejects(database.executeQuery({ alias: 'bad_ca_file', query: 'SELECT 1' }, {}), /outside DB_CA_ROOT/);
    await assert.rejects(database.executeQuery({ alias: 'bad_driver', query: 'SELECT 1' }, {}), /driver must be/);
    await assert.rejects(database.executeQuery({ alias: 'bad_mode', query: 'SELECT 1' }, {}), /mode must be/);

    const res1 = await database.executeQuery({ alias: 'custom_bounds', query: 'SELECT 1' }, {});
    assert.ok(res1);
    const res2 = await database.executeQuery({ alias: 'custom_bounds_low', query: 'SELECT 1' }, {});
    assert.ok(res2);
  });

  it('handles empty DB_CA_ROOT', async () => {
    await fs.writeFile(
      registry,
      JSON.stringify({
        pg_ca_root: { ...base, driver: 'pg', mode: 'read', tls: { rejectUnauthorized: true, caFile: caRoot } },
      })
    );
    delete process.env.DB_CA_ROOT;
    try {
      await assert.rejects(database.executeQuery({ alias: 'pg_ca_root', query: 'SELECT 1' }, {}), /outside DB_CA_ROOT/);
    } finally {
      process.env.DB_CA_ROOT = caRoot;
    }
  });

  it('handles malformed registry JSON', async () => {
    await fs.writeFile(registry, 'not json');
    await assert.rejects(database.executeQuery({ alias: 'pg_read', query: 'SELECT 1' }, {}), /Unexpected token/);
  });

  it('handles missing registry', async () => {
    await fs.rm(registry, { force: true });
    await assert.rejects(
      database.executeQuery({ alias: 'pg_read', query: 'SELECT 1' }, {}),
      /registry is not configured/
    );
  });

  it('handles bad password credential format', async () => {
    await fs.writeFile(
      registry,
      JSON.stringify({ bad_cred: { ...base, driver: 'pg', mode: 'read', passwordCredential: 'bad' } })
    );
    await assert.rejects(database.executeQuery({ alias: 'bad_cred', query: 'SELECT 1' }, {}), /systemd credential/);
  });

  it('handles missing CREDENTIALS_DIRECTORY', async () => {
    await fs.writeFile(registry, JSON.stringify({ pg_read: { ...base, driver: 'pg', mode: 'read' } }));
    delete process.env.CREDENTIALS_DIRECTORY;
    try {
      await assert.rejects(
        database.executeQuery({ alias: 'pg_read', query: 'SELECT 1' }, {}),
        /Systemd credentials are unavailable/
      );
    } finally {
      process.env.CREDENTIALS_DIRECTORY = credentials;
    }
  });

  it('rolls back on error without throwing in rollback', async () => {
    await fs.writeFile(
      registry,
      JSON.stringify({
        pg_read: { ...base, driver: 'pg', mode: 'read' },
        mysql_read: { ...base, driver: 'mysql', mode: 'read' },
      })
    );
    await assert.rejects(
      database.executeQuery({ alias: 'pg_read', query: 'SELECT pg_error_trigger_safe' }, {}),
      /pg safe error/
    );
    await assert.rejects(
      database.executeQuery({ alias: 'mysql_read', query: 'SELECT mysql_error_trigger_safe' }, {}),
      /mysql safe error/
    );
  });

  it('handles module level branches', async () => {
    delete process.env.DB_CONFIG_FILE;
    process.env.NODE_ENV = 'production';
    try {
      const db2 = await import(`../../tools/db.js?test=${Date.now()}`);
      assert.throws(() => db2.setDatabaseAdaptersForTesting({}), /test-only/);
    } finally {
      process.env.DB_CONFIG_FILE = registry;
      process.env.NODE_ENV = 'test';
    }
  });
});
