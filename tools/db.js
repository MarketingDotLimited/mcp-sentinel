import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
let pg = require('pg');
let mysql = require('mysql2/promise');
const DB_CONFIG_PATH = process.env.DB_CONFIG_FILE || '/etc/mcp-sentinel/databases.json';

export function setDatabaseAdaptersForTesting(adapters) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Database adapter injection is test-only');
  if (adapters.pg) pg = adapters.pg;
  if (adapters.mysql) mysql = adapters.mysql;
}

function safeAlias(alias) {
  if (typeof alias !== 'string' || !/^[a-z][a-z0-9_-]{1,63}$/.test(alias)) throw new Error('Invalid database alias');
  return alias;
}

async function credential(name) {
  if (typeof name !== 'string' || !/^db-[a-z0-9_-]{1,64}$/.test(name))
    throw new Error('Database password must reference a db-* systemd credential');
  if (!process.env.CREDENTIALS_DIRECTORY) throw new Error('Systemd credentials are unavailable');
  return (await fs.readFile(path.join(process.env.CREDENTIALS_DIRECTORY, name), 'utf8')).trimEnd();
}

async function getDbConfig(alias) {
  let config;
  try {
    config = JSON.parse(await fs.readFile(DB_CONFIG_PATH, 'utf8'))[safeAlias(alias)];
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Protected database registry is not configured');
    throw error;
  }
  if (!config) throw new Error(`Database alias '${alias}' is not registered`);
  if (!['pg', 'mysql'].includes(config.driver)) throw new Error('Database driver must be pg or mysql');
  if (!['read', 'write'].includes(config.mode)) throw new Error('Database alias mode must be read or write');
  if (typeof config.host !== 'string' || !config.host || typeof config.database !== 'string' || !config.database)
    throw new Error('Database host and database name are required');
  if (typeof config.user !== 'string' || !config.user) throw new Error('Database user is required');
  if (!config.tls || config.tls.rejectUnauthorized !== true)
    throw new Error('Database aliases must require verified TLS');
  let ca;
  if (config.tls.caFile) {
    const caFile = path.resolve(config.tls.caFile);
    const caRoot = path.resolve(process.env.DB_CA_ROOT || '/etc/mcp-sentinel/database-ca');
    if (!(caFile === caRoot || caFile.startsWith(`${caRoot}${path.sep}`)))
      throw new Error('Database CA file is outside DB_CA_ROOT');
    ca = await fs.readFile(caFile, 'utf8');
  }
  return {
    ...config,
    port: Number(config.port || (config.driver === 'pg' ? 5432 : 3306)),
    password: await credential(config.passwordCredential),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    maxRows: Math.min(Math.max(Number(config.maxRows) || 100, 1), 1000),
    maxBytes: Math.min(Math.max(Number(config.maxBytes) || 1_048_576, 1024), 5_242_880),
    queryTimeout: Math.min(Math.max(Number(config.queryTimeout) || 10_000, 1000), 30_000),
  };
}

export function classifyQuery(query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 102_400) throw new Error('query is required');
  const normalized = query.trim().replace(/;\s*$/, '');
  if (normalized.includes(';') || /^(?:--|\/\*)/.test(normalized))
    throw new Error('Only one uncommented SQL statement may be executed');
  const verb = normalized.match(/^([A-Za-z]+)/)?.[1]?.toUpperCase();
  if (!verb) throw new Error('Unable to classify SQL statement');
  if (/\b(?:COPY\s+.*PROGRAM|LOAD_FILE|INTO\s+OUTFILE|INTO\s+DUMPFILE|PG_READ_FILE|PG_LS_DIR)\b/i.test(normalized))
    throw new Error('SQL statement uses a forbidden server-side file or program operation');
  return { normalized, verb, readOnly: ['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'].includes(verb) };
}

export function boundedRows(rows, maxRows, maxBytes) {
  const output = [];
  let bytes = 2;
  let truncated = false;
  for (const row of rows) {
    if (output.length >= maxRows) {
      truncated = true;
      break;
    }
    const encoded = JSON.stringify(row);
    if (bytes + Buffer.byteLength(encoded) + 1 > maxBytes) {
      truncated = true;
      break;
    }
    output.push(row);
    bytes += Buffer.byteLength(encoded) + 1;
  }
  return { rows: output, bytes, truncated: truncated || output.length < rows.length };
}

export async function executeQuery({ alias, query, params = [], confirm }, identity) {
  const config = await getDbConfig(alias);
  if (!Array.isArray(params) || params.length > 1000) throw new Error('params must be an array of at most 1000 values');
  const statement = classifyQuery(query);
  if (!statement.readOnly && config.mode !== 'write') throw new Error(`Database alias '${alias}' is read-only`);
  if (!statement.readOnly && confirm !== true) throw new Error('confirm: true is required for a write query');

  if (config.driver === 'pg') {
    const client = new pg.Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl,
      statement_timeout: config.queryTimeout,
      query_timeout: config.queryTimeout,
      connectionTimeoutMillis: 5000,
      application_name: 'mcp-sentinel',
    });
    await client.connect();
    try {
      await client.query('BEGIN');
      if (config.mode === 'read') await client.query('SET TRANSACTION READ ONLY');
      const result = await client.query({ text: statement.normalized, values: params, rowMode: 'array' });
      await client.query(statement.readOnly ? 'ROLLBACK' : 'COMMIT');
      const bounded = boundedRows(result.rows || [], config.maxRows, config.maxBytes);
      return {
        alias,
        mode: config.mode,
        rowCount: result.rowCount,
        fields: result.fields?.map(field => field.name),
        ...bounded,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      await client.end();
    }
  }

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    connectTimeout: 5000,
    multipleStatements: false,
  });
  try {
    if (config.mode === 'read') await connection.query('SET TRANSACTION READ ONLY');
    await connection.beginTransaction();
    const [rows, fields] = await connection.execute(
      { sql: statement.normalized, timeout: config.queryTimeout },
      params
    );
    if (statement.readOnly) await connection.rollback();
    else await connection.commit();
    if (Array.isArray(rows)) {
      const bounded = boundedRows(rows, config.maxRows, config.maxBytes);
      return { alias, mode: config.mode, rowCount: rows.length, fields: fields?.map(field => field.name), ...bounded };
    }
    return { alias, mode: config.mode, rowCount: rows.affectedRows };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await connection.end();
  }
}
