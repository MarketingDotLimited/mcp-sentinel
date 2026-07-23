// ============================================================
//  audit.js - Comprehensive Audit Logging
// ============================================================
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import zlib from 'zlib';
import { loadCredentialSecret } from './lib/credentials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.AUDIT_LOG_DIR || path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
}

const CHECKPOINT_FILE = process.env.AUDIT_CHECKPOINT_FILE || '/var/lib/mcp-sentinel/audit-chain.json';
const auditCredentialExpected = Boolean(
  process.env.NODE_ENV === 'production' || process.env.AUDIT_HMAC_KEY || process.env.CREDENTIALS_DIRECTORY
);
const configuredHmacKey = auditCredentialExpected ? loadCredentialSecret('AUDIT_HMAC_KEY', 'audit-key') : '';
if (auditCredentialExpected && !/^[a-f0-9]{64}$/i.test(configuredHmacKey))
  throw new Error('Audit HMAC credential must contain exactly 32 bytes encoded as hexadecimal');
const auditHmacKey = /^[a-f0-9]{64}$/i.test(configuredHmacKey)
  ? Buffer.from(configuredHmacKey, 'hex')
  : crypto.randomBytes(32);
const persistentAuditChain = /^[a-f0-9]{64}$/i.test(configuredHmacKey);
let lastHash = crypto.createHmac('sha256', auditHmacKey).update('mcp-sentinel-audit-v1').digest('hex');
let seqNo = 0;
if (persistentAuditChain) {
  try {
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    if (Number.isSafeInteger(checkpoint.seqNo) && /^[a-f0-9]{64}$/i.test(checkpoint.hash)) {
      seqNo = checkpoint.seqNo;
      lastHash = checkpoint.hash;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Invalid audit checkpoint: ${error.message}`);
  }
}

function assertCheckpointMatchesLogTail() {
  if (!persistentAuditChain || seqNo === 0) return;
  const files = fs
    .readdirSync(LOG_DIR)
    .filter(name => /^audit-.*\.log(?:\.gz)?$/.test(name))
    .sort();
  if (!files.length) throw new Error('Audit checkpoint exists but the audit log is missing');
  const latest = files.at(-1);
  const raw = fs.readFileSync(path.join(LOG_DIR, latest));
  const contents = latest.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const line = contents.split(/\r?\n/).filter(Boolean).at(-1);
  const tail = JSON.parse(line || '{}');
  if (tail.seqNo !== seqNo || tail.hash !== lastHash)
    throw new Error('Audit checkpoint does not match the durable audit log tail');
}

assertCheckpointMatchesLogTail();

function persistCheckpoint() {
  if (!persistentAuditChain) return;
  fs.mkdirSync(path.dirname(CHECKPOINT_FILE), { recursive: true, mode: 0o700 });
  const temporary = `${CHECKPOINT_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, seqNo, hash: lastHash }), { mode: 0o600 });
  fs.renameSync(temporary, CHECKPOINT_FILE);
}

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

function writeAudit(level, message, metadata) {
  const info = {
    level,
    message,
    ...metadata,
    timestamp: new Date().toISOString(),
  };
  seqNo++;
  info.seqNo = seqNo;
  info.previousHash = lastHash;
  const data = `${lastHash}\n${JSON.stringify(canonicalize(info))}`;
  lastHash = crypto.createHmac('sha256', auditHmacKey).update(data).digest('hex');
  info.hash = lastHash;
  info.chainProtection = persistentAuditChain ? 'hmac-checkpointed' : 'ephemeral-unanchored';
  const filename = path.join(LOG_DIR, `audit-${new Date().toISOString().slice(0, 10)}.log`);
  const descriptor = fs.openSync(filename, fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeSync(descriptor, `${JSON.stringify(info)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  persistCheckpoint();
  if (process.env.AUDIT_CONSOLE !== 'false') console.error(`[${info.timestamp}] ${level}: ${message}`);
}

// Error logger
const errorLogger = winston.createLogger({
  level: 'error',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      zippedArchive: true,
      options: { mode: 0o600 },
    }),
  ],
});

// ── Public API ─────────────────────────────────────────────

export function logAccess({ ip, apiKey, userId, tool, args, result, duration }) {
  writeAudit('info', 'TOOL_CALL', {
    event: 'TOOL_CALL',
    ip,
    apiKey: apiKey ? maskKey(apiKey) : null,
    userId,
    tool,
    args: sanitizeArgs(args),
    result: result === 'success' ? 'success' : 'failure',
    duration_ms: duration,
  });
}

export function logAuth({ ip, apiKey, userId, event, reason }) {
  writeAudit('info', event, {
    event,
    ip,
    apiKey: apiKey ? maskKey(apiKey) : null,
    userId,
    reason,
  });
}

export function logSecurityEvent({ ip, event, detail }) {
  writeAudit('warn', 'SECURITY_EVENT', {
    event: 'SECURITY_EVENT',
    subEvent: event,
    ip,
    detail,
  });
}

export function logError({ ip, userId, tool, error }) {
  errorLogger.error('TOOL_ERROR', {
    event: 'TOOL_ERROR',
    ip,
    userId,
    tool,
    error: error?.message || String(error),
    stack: error?.stack,
  });
}

export function logServerStart({ port, host, https }) {
  writeAudit('info', 'SERVER_START', {
    event: 'SERVER_START',
    port,
    host,
    https,
    pid: process.pid,
  });
}

export function shutdownLoggers(cb) {
  errorLogger.on('finish', cb);
  errorLogger.end();
}

export function getAuditChainStatus() {
  return {
    sequence: seqNo,
    hash: lastHash,
    protection: persistentAuditChain ? 'hmac-checkpointed' : 'ephemeral-unanchored',
    externallyAnchored: false,
  };
}

// ── Helpers ────────────────────────────────────────────────

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}

export function sanitizeArgs(args) {
  if (!args) return {};

  function deepSanitize(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(deepSanitize);

    const safe = { ...obj };
    const sensitiveKeys = [
      'password',
      'publickey',
      'apikey',
      'key',
      'secret',
      'token',
      'authorization',
      'content',
      'newcontent',
      'code',
      'connectionstring',
    ];
    for (const k of Object.keys(safe)) {
      const normalizedKey = k.toLowerCase();
      if (
        sensitiveKeys.includes(normalizedKey) ||
        normalizedKey.includes('password') ||
        normalizedKey.includes('secret') ||
        normalizedKey.includes('token')
      ) {
        safe[k] = '[REDACTED]';
      } else if (typeof safe[k] === 'object') {
        safe[k] = deepSanitize(safe[k]);
      } else if (typeof safe[k] === 'string') {
        // Regex match common secret patterns
        safe[k] = safe[k].replace(/(-p|--password=)[\S]+/g, '$1[REDACTED]');
        safe[k] = safe[k].replace(/(mysql:\/\/[^:]+:)[^@]+(@)/g, '$1[REDACTED]$2');
        safe[k] = safe[k].replace(/(Bearer )[\w\.\-]+/g, '$1[REDACTED]');
      }
    }
    return safe;
  }

  const safe = deepSanitize(args);

  // Truncate large content
  if (safe.content && safe.content.length > 200) safe.content = safe.content.slice(0, 100) + '...[TRUNCATED]';
  if (safe.command && safe.command.length > 500) safe.command = safe.command.slice(0, 500) + '...[TRUNCATED]';
  return safe;
}

export default { info: (message, metadata) => writeAudit('info', message, metadata) };
