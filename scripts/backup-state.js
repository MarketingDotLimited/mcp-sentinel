import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync, backup } from 'node:sqlite';

const databaseFile = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
const backupRoot = process.env.MCP_STATE_BACKUP_DIR || '/var/lib/mcp-sentinel/backups';
const keyId = process.env.MCP_STATE_BACKUP_KEY_ID || 'state-backup-v1';
let keyHex = process.env.MCP_STATE_BACKUP_KEY || '';
if (!keyHex && process.env.CREDENTIALS_DIRECTORY) {
  try {
    keyHex = (await fs.readFile(path.join(process.env.CREDENTIALS_DIRECTORY, 'state-backup-key'), 'utf8')).trim();
  } catch {}
}
if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error('state-backup-key must contain 64 hexadecimal characters');

await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const temporaryDatabase = path.join(backupRoot, `.state-${process.pid}-${crypto.randomUUID()}.sqlite3`);
const source = new DatabaseSync(databaseFile, { readOnly: true });
try {
  await backup(source, temporaryDatabase);
} finally {
  source.close();
}

try {
  const verification = new DatabaseSync(temporaryDatabase, { readOnly: true });
  try {
    const result = verification.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') throw new Error('SQLite integrity verification failed');
  } finally {
    verification.close();
  }
  const plaintext = await fs.readFile(temporaryDatabase);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = {
    version: 1,
    algorithm: 'aes-256-gcm',
    keyId,
    createdAt: new Date().toISOString(),
    sourceSha256: crypto.createHash('sha256').update(plaintext).digest('hex'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  const output = path.join(backupRoot, `state-${timestamp}.sqlite3.enc`);
  const temporaryOutput = `${output}.${process.pid}.tmp`;
  await fs.writeFile(temporaryOutput, JSON.stringify(payload), { mode: 0o600, flag: 'wx' });
  await fs.rename(temporaryOutput, output);
  await fs.chmod(output, 0o600);

  const retentionDays = Math.min(Math.max(Number(process.env.MCP_STATE_BACKUP_RETENTION_DAYS || 30), 1), 3650);
  const cutoff = Date.now() - retentionDays * 86_400_000;
  for (const name of await fs.readdir(backupRoot)) {
    if (!/^state-.*\.sqlite3\.enc$/.test(name)) continue;
    const file = path.join(backupRoot, name);
    if ((await fs.stat(file)).mtimeMs < cutoff) await fs.rm(file);
  }
  process.stdout.write(`${JSON.stringify({ backup: output, keyId, bytes: ciphertext.length, verified: true })}\n`);
} finally {
  await fs.rm(temporaryDatabase, { force: true });
}
