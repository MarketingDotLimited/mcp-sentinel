import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let pg = null;
let mysql = null;

try { pg = require('pg'); } catch {}
try { mysql = require('mysql2/promise'); } catch {}

const DB_CONFIG_PATH = path.join(process.cwd(), 'db_connections.json');

async function getDbConfig(alias) {
  try {
    const configData = await fs.readFile(DB_CONFIG_PATH, 'utf8');
    const config = JSON.parse(configData);
    if (!config[alias]) {
      throw new Error(`Database alias '${alias}' not found in db_connections.json`);
    }
    return config[alias];
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error('db_connections.json not configured on server');
    }
    throw e;
  }
}

export async function executeQuery({ alias, query, params = [], confirm }, identity) {
  const config = await getDbConfig(alias);
  if (typeof query !== 'string' || !query.trim()) throw new Error('query is required');
  if (!Array.isArray(params)) throw new Error('params must be an array');
  const normalizedQuery = query.trim().replace(/;\s*$/, '');
  if (normalizedQuery.includes(';')) throw new Error('Only one SQL statement may be executed per request');

  const isWrite = !/^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(normalizedQuery);
  if (isWrite && !config.allowWrite) {
    throw new Error(`Database connection '${alias}' is read-only. Writes are not permitted.`);
  }
  if (isWrite && !confirm) {
    throw new Error('This is a write query. You must pass confirm: true to execute it.');
  }

  const maxRows = config.maxRows || 100;
  
  if (config.driver === 'pg') {
    if (!pg) throw new Error('pg module not installed. Run: npm install pg');
    const { Client } = pg;
    const client = new Client({
      connectionString: config.connectionString,
      statement_timeout: config.queryTimeout || 10000,
    });
    
    await client.connect();
    try {
      if (!isWrite) await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
      
      const res = await client.query({
        text: normalizedQuery,
        values: params,
        rowMode: 'array',
      });
      
      const rows = res.rows.slice(0, maxRows);
      return {
        alias,
        rowCount: res.rowCount,
        fields: res.fields?.map(f => f.name),
        rows,
        truncated: res.rows.length > maxRows,
      };
    } finally {
      await client.end();
    }
  } else if (config.driver === 'mysql') {
    if (!mysql) throw new Error('mysql2 module not installed. Run: npm install mysql2');
    const conn = await mysql.createConnection({
      uri: config.connectionString,
      connectTimeout: 5000,
    });
    
    try {
      if (!isWrite) await conn.query('SET SESSION TRANSACTION READ ONLY');
      
      const [rows, fields] = await conn.execute(normalizedQuery, params);
      
      if (Array.isArray(rows)) {
        const resultRows = rows.slice(0, maxRows);
        return {
          alias,
          rowCount: rows.length,
          fields: fields?.map(f => f.name),
          rows: resultRows,
          truncated: rows.length > maxRows,
        };
      } else {
        return { alias, rowCount: rows.affectedRows, insertId: rows.insertId };
      }
    } finally {
      await conn.end();
    }
  } else {
    throw new Error(`Unsupported database driver: ${config.driver}`);
  }
}
