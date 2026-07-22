import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

if (process.env.MCP_ROTATE_OFFLINE !== 'true')
  throw new Error('State-key rotation requires MCP_ROTATE_OFFLINE=true after stopping the API and broker');
const databaseFile = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
const credentials = process.env.CREDENTIALS_DIRECTORY || '/etc/mcp-sentinel/credentials';
const newKeyId = process.env.CONTROL_PLANE_KEY_ID;
if (!/^[A-Za-z0-9_.-]{1,64}$/.test(newKeyId || '')) throw new Error('CONTROL_PLANE_KEY_ID must name the new key');
const newKeyHex = fs.readFileSync(path.join(credentials, 'state-key'), 'utf8').trim();
if (!/^[a-f0-9]{64}$/i.test(newKeyHex)) throw new Error('Current state-key credential is invalid');
const newKey = Buffer.from(newKeyHex, 'hex');

function keyFor(id) {
  if (id === newKeyId) return newKey;
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id || '')) throw new Error(`Invalid stored key ID '${id}'`);
  const value = fs.readFileSync(path.join(credentials, `state-key-${id}`), 'utf8').trim();
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`Archived state key '${id}' is invalid`);
  return Buffer.from(value, 'hex');
}

function rotate(value) {
  if (Array.isArray(value)) return value.map(rotate);
  if (!value || typeof value !== 'object') return value;
  if (value.v === 1 && value.keyId && value.iv && value.tag && value.ciphertext) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(value.keyId), Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', newKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      v: 1,
      keyId: newKeyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rotate(child)]));
}

const database = new DatabaseSync(databaseFile);
const tables = ['approvals', 'projects', 'organizations', 'teams'];
database.exec('BEGIN IMMEDIATE');
try {
  let records = 0;
  for (const table of tables) {
    const rows = database.prepare(`SELECT id, payload FROM ${table}`).all();
    const update = database.prepare(`UPDATE ${table} SET payload = ?, updated_at = ? WHERE id = ?`);
    for (const row of rows) {
      const before = JSON.parse(row.payload);
      const after = rotate(before);
      update.run(JSON.stringify(after), new Date().toISOString(), row.id);
      records++;
    }
  }
  database
    .prepare("INSERT OR REPLACE INTO state_meta(key, value) VALUES ('state_key_rotation', ?)")
    .run(JSON.stringify({ keyId: newKeyId, at: new Date().toISOString(), records }));
  database.exec('COMMIT');
  process.stdout.write(`${JSON.stringify({ rotated: true, keyId: newKeyId, records })}\n`);
} catch (error) {
  database.exec('ROLLBACK');
  throw error;
} finally {
  database.close();
}
