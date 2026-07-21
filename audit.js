// ============================================================
//  audit.js - Comprehensive Audit Logging
// ============================================================
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.AUDIT_LOG_DIR || path.join(__dirname, 'logs');

// Audit logger - security events
const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.json()
  ),
  transports: [
    new DailyRotateFile({
      filename: path.join(LOG_DIR, 'audit-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: `${process.env.AUDIT_LOG_KEEP_DAYS || 30}d`,
      zippedArchive: true,
      level: 'info',
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

// ── Helpers ────────────────────────────────────────────────

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}

function sanitizeArgs(args) {
  if (!args) return {};
  // Don't log file contents or sensitive data in args
  const safe = { ...args };
  if (safe.content && safe.content.length > 200) safe.content = '[truncated]';
  if (safe.password) safe.password = '***';
  return safe;
}

export default auditLogger;
