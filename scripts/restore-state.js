import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

if (process.env.MCP_RESTORE_OFFLINE !== 'true')
  throw new Error('Restore requires MCP_RESTORE_OFFLINE=true after stopping the API and broker services');
const requested = process.argv[2];
if (!requested) throw new Error('Usage: node scripts/restore-state.js /absolute/path/to/state-backup.sqlite3.enc');
const backupRoot = path.resolve(process.env.MCP_STATE_BACKUP_DIR || '/var/lib/mcp-sentinel/backups');
const backupFile = path.resolve(requested);
if (!backupFile.startsWith(`${backupRoot}${path.sep}`) || !backupFile.endsWith('.sqlite3.enc'))
  throw new Error('Backup must be an encrypted file inside MCP_STATE_BACKUP_DIR');
const databaseFile = path.resolve(process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3');
let keyHex = process.env.MCP_STATE_BACKUP_KEY || '';
if (!keyHex && process.env.CREDENTIALS_DIRECTORY) {
  try {
    keyHex = (await fs.readFile(path.join(process.env.CREDENTIALS_DIRECTORY, 'state-backup-key'), 'utf8')).trim();
  } catch {}
}
if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error('state-backup-key must contain 64 hexadecimal characters');

const payload = JSON.parse(await fs.readFile(backupFile, 'utf8'));
if (payload.version !== 1 || payload.algorithm !== 'aes-256-gcm') throw new Error('Unsupported backup format');
const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(payload.iv, 'base64'));
decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
if (crypto.createHash('sha256').update(plaintext).digest('hex') !== payload.sourceSha256)
  throw new Error('Backup plaintext checksum mismatch');

const temporary = `${databaseFile}.${process.pid}.restore`;
await fs.writeFile(temporary, plaintext, { mode: 0o600, flag: 'wx' });
try {
  const verification = new DatabaseSync(temporary, { readOnly: true });
  try {
    if (verification.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
      throw new Error('Restored SQLite image failed integrity verification');
  } finally {
    verification.close();
  }
  try {
    await fs.copyFile(databaseFile, `${databaseFile}.pre-restore-${Date.now()}`, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.rename(temporary, databaseFile);
  await fs.chmod(databaseFile, 0o600);
  for (const suffix of ['-wal', '-shm']) await fs.rm(`${databaseFile}${suffix}`, { force: true });
  process.stdout.write(`${JSON.stringify({ restored: databaseFile, keyId: payload.keyId, verified: true })}\n`);
} catch (error) {
  await fs.rm(temporary, { force: true });
  throw error;
}
