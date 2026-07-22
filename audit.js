// ============================================================
//  audit.js - Comprehensive Audit Logging
// ============================================================
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.AUDIT_LOG_DIR || path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
}

let lastHash = crypto.createHash('sha256').update('init').digest('hex');
let seqNo = 0;
const tamperFormat = winston.format((info) => {
  seqNo++;
  info.seqNo = seqNo;
  const data = JSON.stringify(info) + lastHash;
  lastHash = crypto.createHash('sha256').update(data).digest('hex');
  info.hash = lastHash;
  return info;
});

// Audit logger - security events
const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    tamperFormat(),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: `${process.env.AUDIT_LOG_KEEP_DAYS || 30}d`,
      zippedArchive: true,
      level: 'info',
      options: { mode: 0o600 },
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
          return `[${timestamp}] ${level}: ${message}${metaStr}`;
        })
      ),
    }),
  ],
});

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
  auditLogger.info('TOOL_CALL', {
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
  auditLogger.info(event, {
    event,
    ip,
    apiKey: apiKey ? maskKey(apiKey) : null,
    userId,
    reason,
  });
}

export function logSecurityEvent({ ip, event, detail }) {
  auditLogger.warn('SECURITY_EVENT', {
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
  auditLogger.info('SERVER_START', {
    event: 'SERVER_START',
    port,
    host,
    https,
    pid: process.pid,
  });
}

export function shutdownLoggers(cb) {
  auditLogger.on('finish', () => {
    errorLogger.on('finish', cb);
    errorLogger.end();
  });
  auditLogger.end();
}

// ── Helpers ────────────────────────────────────────────────

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}

function sanitizeArgs(args) {
  if (!args) return {};
  
  function deepSanitize(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(deepSanitize);
    
    const safe = { ...obj };
    const sensitiveKeys = ['password', 'publicKey', 'apiKey', 'key', 'secret', 'token', 'authorization'];
    for (const k of Object.keys(safe)) {
      if (sensitiveKeys.includes(k) || k.toLowerCase().includes('password')) {
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

export default auditLogger;
