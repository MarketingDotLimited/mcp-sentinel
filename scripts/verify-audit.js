import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';

const logDirectory = process.env.AUDIT_LOG_DIR || '/var/log/mcp-sentinel';
const checkpointFile = process.env.AUDIT_CHECKPOINT_FILE || '/var/lib/mcp-sentinel/audit-chain.json';
let key = process.env.AUDIT_HMAC_KEY || '';
if (!key && process.env.CREDENTIALS_DIRECTORY) {
  try {
    key = fs.readFileSync(path.join(process.env.CREDENTIALS_DIRECTORY, 'audit-key'), 'utf8').trim();
  } catch {}
}
if (!/^[a-f0-9]{64}$/i.test(key))
  throw new Error('AUDIT_HMAC_KEY or audit-key credential must contain 64 hex characters');
const keyBuffer = Buffer.from(key, 'hex');
let expectedPrevious = crypto.createHmac('sha256', keyBuffer).update('mcp-sentinel-audit-v1').digest('hex');
let expectedSequence = 1;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  return value;
}

const files = fs
  .readdirSync(logDirectory)
  .filter(name => /^audit-.*\.log(?:\.gz)?$/.test(name))
  .sort();
for (const name of files) {
  const file = fs.readFileSync(path.join(logDirectory, name));
  const contents = name.endsWith('.gz') ? zlib.gunzipSync(file).toString('utf8') : file.toString('utf8');
  for (const line of contents.split(/\r?\n/).filter(Boolean)) {
    const entry = JSON.parse(line);
    const hash = entry.hash;
    delete entry.hash;
    delete entry.chainProtection;
    if (entry.seqNo !== expectedSequence)
      throw new Error(`Audit sequence break in ${name}: expected ${expectedSequence}`);
    if (entry.previousHash !== expectedPrevious) throw new Error(`Audit previous-hash mismatch in ${name}`);
    const calculated = crypto
      .createHmac('sha256', keyBuffer)
      .update(`${expectedPrevious}\n${JSON.stringify(canonicalize(entry))}`)
      .digest('hex');
    if (hash !== calculated) throw new Error(`Audit HMAC mismatch in ${name}`);
    expectedPrevious = hash;
    expectedSequence++;
  }
}

const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
if (checkpoint.seqNo !== expectedSequence - 1 || checkpoint.hash !== expectedPrevious)
  throw new Error('Audit checkpoint does not match the verified log tail');
const result = {
  verified: true,
  entries: checkpoint.seqNo,
  hash: checkpoint.hash,
  verifiedAt: new Date().toISOString(),
};
if (process.env.AUDIT_VERIFICATION_STATUS_FILE) {
  const statusFile = process.env.AUDIT_VERIFICATION_STATUS_FILE;
  fs.mkdirSync(path.dirname(statusFile), { recursive: true, mode: 0o700 });
  const temporary = `${statusFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(result), { mode: 0o600 });
  fs.renameSync(temporary, statusFile);
}
process.stdout.write(`${JSON.stringify(result)}\n`);
