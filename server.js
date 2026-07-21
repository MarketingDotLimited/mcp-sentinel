// ============================================================
//  server.js - Main MCP Server with HTTP/SSE Transport
// ============================================================
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';

import {
  ipWhitelist,
  authenticate,
  authenticateJWT,
  issueToken,
  addApiKey,
  revokeApiKey,
  listApiKeys,
  getClientIP,
} from './security.js';

import { logAccess, logError, logServerStart, logSecurityEvent } from './audit.js';

import { runCommand, getSystemInfo, getProcesses, killProcess } from './tools/system.js';
import { readFile, writeFile, deleteFile, listDirectory, moveFile, copyFile, getFileInfo, searchFiles } from './tools/files.js';
import { manageService, getServiceStatus, listServices, getJournalLogs, manageFirewall } from './tools/services.js';
import { listUsers, getUserInfo, createUser, deleteUser, setUserPassword, modifyUser, manageSshKeys } from './tools/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '4444');
const HOST = process.env.HOST || '0.0.0.0';
const USE_HTTPS = process.env.USE_HTTPS === 'true';

// ── Active SSE connections ─────────────────────────────────
const activeTransports = new Map(); // sessionId -> { transport, identity, ip }

// ── Express App ───────────────────────────────────────────

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
    },
  },
  hsts: USE_HTTPS ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

// CORS - restrict to known AI cloud service IPs (or configure your own)
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (direct API calls) or from trusted origins
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Session-ID'],
  credentials: false,
}));

app.use(express.json({ limit: '5mb' }));

// IP extraction middleware
app.use(ipWhitelist);

// ── Rate Limiting ──────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getClientIP(req),
  handler: (req, res) => {
    logSecurityEvent({ ip: getClientIP(req), event: 'RATE_LIMIT_EXCEEDED', detail: {} });
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 auth attempts per 15 min
  keyGenerator: (req) => getClientIP(req),
  handler: (req, res) => {
    logSecurityEvent({ ip: getClientIP(req), event: 'AUTH_RATE_LIMIT', detail: {} });
    res.status(429).json({ error: 'Too many authentication attempts' });
  },
});

app.use(globalLimiter);

// ── Health Check (unauthenticated) ─────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'mcp-sentinel',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Auth Endpoints ─────────────────────────────────────────

// Exchange API key for JWT token
app.post('/auth/token', authLimiter, authenticate, issueToken);

// ── Admin Key Management (admin only) ─────────────────────

app.post('/admin/keys', authenticate, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { key, userId, role, allowedIPs, scopes, label } = req.body;
  if (!key || !userId) return res.status(400).json({ error: 'key and userId required' });

  addApiKey(key, { userId, role, allowedIPs, scopes, label });
  return res.json({ success: true, message: `Key added for user '${userId}'` });
});

app.delete('/admin/keys/:key', authenticate, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const revoked = revokeApiKey(req.params.key);
  return res.json({ success: revoked, message: revoked ? 'Key revoked' : 'Key not found' });
});

app.get('/admin/keys', authenticate, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  return res.json({ keys: listApiKeys() });
});

app.get('/admin/sessions', authenticate, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const sessions = Array.from(activeTransports.entries()).map(([id, s]) => ({
    sessionId: id,
    userId: s.identity?.userId,
    role: s.identity?.role,
    ip: s.ip,
    connectedAt: s.connectedAt,
  }));
  return res.json({ sessions, count: sessions.length });
});

// ── MCP SSE Endpoint ───────────────────────────────────────

app.get('/mcp', authenticateJWT, (req, res) => {
  const sessionId = randomUUID();
  const identity = req.identity;
  const ip = req.clientIP;

  // Enforce connection limit
  if (activeTransports.size >= MAX_SSE_CONNECTIONS) {
    return res.status(503).json({ error: 'Too many active connections' });
  }

  // Create a per-session MCP server instance
  const mcpServer = createMcpServer(identity, ip);

  const transport = new SSEServerTransport('/mcp/message', res);

  activeTransports.set(sessionId, {
    transport,
    identity,
    ip,
    connectedAt: new Date().toISOString(),
  });

  res.on('close', () => {
    activeTransports.delete(sessionId);
    mcpServer.close().catch(() => {});
  });

  // Pass sessionId to client via header
  res.setHeader('X-Session-ID', sessionId);

  mcpServer.connect(transport).catch(err => {
    logError({ ip, userId: identity.userId, tool: 'SSE_CONNECT', error: err });
  });
});

// MCP message endpoint (POST from client)
app.post('/mcp/message', authenticateJWT, async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  const session = activeTransports.get(sessionId);

  if (!session) {
    return res.status(400).json({ error: 'Unknown session. Reconnect to /mcp first.' });
  }

  // Verify session ownership — prevent hijacking
  if (session.identity?.userId !== req.identity?.userId) {
    logSecurityEvent({ ip: req.clientIP, event: 'SESSION_HIJACK_ATTEMPT', detail: { sessionOwner: session.identity?.userId, requestUser: req.identity?.userId } });
    return res.status(403).json({ error: 'Session does not belong to you' });
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (err) {
    logError({ ip: req.clientIP, userId: req.identity?.userId, tool: 'POST_MESSAGE', error: err });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── MCP Server Factory ─────────────────────────────────────

function createMcpServer(identity, ip) {
  const server = new McpServer({
    name: 'server-control',
    version: '1.0.0',
  });

  // ── Helper: wrap tool calls with audit logging ───────────
  function tool(name, description, schema, handler) {
    server.tool(name, description, schema, async (args) => {
      const start = Date.now();
      // Enforce scope authorization
      const scopes = identity.scopes || [];
      if (!scopes.includes('*') && !scopes.includes(name)) {
        logSecurityEvent({ ip, event: 'SCOPE_DENIED', detail: { userId: identity.userId, tool: name } });
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Access to tool '${name}' is not permitted by your API key scopes` }) }], isError: true };
      }
      try {
        const result = await handler(args, identity);
        logAccess({ ip, apiKey: null, userId: identity.userId, tool: name, args, result: 'success', duration: Date.now() - start });
        const textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text: textContent || 'Success' }] };
      } catch (err) {
        logError({ ip, userId: identity.userId, tool: name, error: err });
        logAccess({ ip, userId: identity.userId, tool: name, args, result: 'failure', duration: Date.now() - start });
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
          isError: true,
        };
      }
    });
  }

  // ── System Tools ───────────────────────────────────────

  tool('run_command', 'Execute a shell command on the server. Supports working directory and running as a specific user (admin only).', {
    command: z.string().describe('The shell command to execute'),
    workingDir: z.string().optional().describe('Working directory for the command'),
    timeout: z.number().optional().describe('Timeout in seconds (max 300 for admin, 60 for users)'),
    asUser: z.string().optional().describe('(Admin only) Run command as this user'),
  }, runCommand);

  tool('get_system_info', 'Get comprehensive system information: CPU, memory, disk, network, uptime, logged-in users.', {}, getSystemInfo);

  tool('get_processes', 'List running processes. Admins see all processes; users see only their own.', {
    filter: z.string().optional().describe('Filter processes by name/keyword'),
    asUser: z.string().optional().describe('(Admin only) Show processes for specific user'),
  }, getProcesses);

  tool('kill_process', 'Send a signal to a process. Non-admin users can only kill their own processes.', {
    pid: z.number().describe('Process ID to signal'),
    signal: z.enum(['TERM', 'KILL', 'HUP', 'INT', 'USR1', 'USR2']).optional().describe('Signal to send (default: TERM)'),
  }, killProcess);

  // ── File Tools ─────────────────────────────────────────

  tool('read_file', 'Read the contents of a file. Paths are sandboxed per role.', {
    filePath: z.string().describe('Absolute path to the file'),
    encoding: z.string().optional().describe('File encoding (default: utf8)'),
    maxBytes: z.number().optional().describe('Maximum bytes to read (default: 1MB)'),
  }, readFile);

  tool('write_file', 'Write content to a file (create or overwrite). Paths are sandboxed per role.', {
    filePath: z.string().describe('Absolute path to the file'),
    content: z.string().describe('Content to write'),
    mode: z.enum(['overwrite', 'append']).optional().describe('Write mode (default: overwrite)'),
    encoding: z.string().optional().describe('File encoding (default: utf8)'),
  }, writeFile);

  tool('delete_file', 'Delete a file or directory.', {
    filePath: z.string().describe('Absolute path to delete'),
    recursive: z.boolean().optional().describe('Recursively delete directory contents (default: false)'),
  }, deleteFile);

  tool('list_directory', 'List the contents of a directory.', {
    dirPath: z.string().describe('Absolute path to directory'),
    showHidden: z.boolean().optional().describe('Include hidden files (default: false)'),
    detailed: z.boolean().optional().describe('Include file details like size, permissions (default: true)'),
  }, listDirectory);

  tool('move_file', 'Move or rename a file/directory.', {
    sourcePath: z.string().describe('Source path'),
    destPath: z.string().describe('Destination path'),
  }, moveFile);

  tool('copy_file', 'Copy a file or directory.', {
    sourcePath: z.string().describe('Source path'),
    destPath: z.string().describe('Destination path'),
  }, copyFile);

  tool('get_file_info', 'Get detailed metadata about a file including size, permissions, and SHA256 checksum.', {
    filePath: z.string().describe('Absolute path to file'),
  }, getFileInfo);

  tool('search_files', 'Search for files by name pattern in a directory tree.', {
    searchPath: z.string().describe('Root path to search from'),
    pattern: z.string().describe('Filename pattern (supports wildcards, e.g. "*.log")'),
    maxResults: z.number().optional().describe('Maximum results (default: 50)'),
    fileType: z.enum(['file', 'directory']).optional().describe('Filter by type'),
  }, searchFiles);

  // ── Service Tools (Admin only) ─────────────────────────

  tool('manage_service', 'Start, stop, restart, enable, or disable a systemd service. Admin only.', {
    service: z.string().describe('Service name (e.g. nginx, mysql, sshd)'),
    action: z.enum(['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'status', 'is-active']).describe('Action to perform'),
  }, manageService);

  tool('get_service_status', 'Get detailed status and recent logs for a systemd service. Admin only.', {
    service: z.string().describe('Service name'),
  }, getServiceStatus);

  tool('list_services', 'List all systemd services with their status. Admin only.', {
    filter: z.string().optional().describe('Filter by service name keyword'),
    state: z.string().optional().describe('Filter by state: active, inactive, failed, etc.'),
  }, listServices);

  tool('get_journal_logs', 'Read systemd journal logs. Admin only.', {
    service: z.string().optional().describe('Service name to filter logs for'),
    lines: z.number().optional().describe('Number of log lines to return (default: 50, max: 500)'),
    since: z.string().optional().describe('Show logs since this time (e.g. "1 hour ago", "2024-01-01 00:00:00")'),
    priority: z.enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']).optional(),
  }, getJournalLogs);

  tool('manage_firewall', 'Manage UFW firewall rules. Admin only.', {
    action: z.enum(['status', 'enable', 'disable', 'allow', 'deny', 'delete', 'list']).describe('Firewall action'),
    port: z.number().optional().describe('Port number for allow/deny/delete actions'),
    protocol: z.enum(['tcp', 'udp']).optional().describe('Protocol (default: tcp)'),
  }, manageFirewall);

  // ── User Management Tools (Admin only) ─────────────────

  tool('list_users', 'List all system users. Admin only.', {
    includeSystem: z.boolean().optional().describe('Include system users (uid < 1000). Default: false'),
  }, listUsers);

  tool('get_user_info', 'Get detailed info about a user including groups and SSH keys.', {
    username: z.string().describe('Username to query'),
  }, getUserInfo);

  tool('create_user', 'Create a new system user. Admin only.', {
    username: z.string().describe('New username'),
    password: z.string().optional().describe('Initial password'),
    groups: z.string().optional().describe('Comma-separated supplementary groups'),
    shell: z.string().optional().describe('Login shell (default: /bin/bash)'),
    comment: z.string().optional().describe('User comment/description'),
    createHome: z.boolean().optional().describe('Create home directory (default: true)'),
  }, createUser);

  tool('delete_user', 'Delete a system user. Admin only.', {
    username: z.string().describe('Username to delete'),
    removeHome: z.boolean().optional().describe('Remove home directory (default: false)'),
  }, deleteUser);

  tool('set_user_password', 'Set or change a user password. Admin only.', {
    username: z.string().describe('Username'),
    password: z.string().describe('New password'),
  }, setUserPassword);

  tool('modify_user', 'Modify user properties: groups, shell, lock/unlock, expiry. Admin only.', {
    username: z.string().describe('Username to modify'),
    addGroups: z.string().optional().describe('Comma-separated groups to add user to'),
    removeGroups: z.string().optional().describe('Comma-separated groups to remove user from'),
    shell: z.string().optional().describe('New login shell'),
    lockAccount: z.boolean().optional().describe('Lock the user account'),
    unlockAccount: z.boolean().optional().describe('Unlock the user account'),
    expireDate: z.string().optional().describe('Account expiry date (YYYY-MM-DD), empty string to disable'),
  }, modifyUser);

  tool('manage_ssh_keys', 'Add, list, or remove SSH authorized keys for a user.', {
    username: z.string().describe('Target username'),
    action: z.enum(['add', 'list', 'remove']).describe('Action to perform'),
    publicKey: z.string().optional().describe('Full SSH public key string (for add action)'),
    keyIndex: z.number().optional().describe('Key index to remove (for remove action, use list first)'),
  }, manageSshKeys);

  return server;
}

// ── TLS Setup ─────────────────────────────────────────────

function createHttpsServer() {
  const certPath = process.env.TLS_CERT_PATH || path.join(__dirname, 'certs', 'server.crt');
  const keyPath = process.env.TLS_KEY_PATH || path.join(__dirname, 'certs', 'server.key');

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error('\n⚠️  TLS cert/key not found. Set USE_HTTPS=false or generate certs with setup.sh\n');
    process.exit(1);
  }

  return https.createServer({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    minVersion: 'TLSv1.2',
    ciphers: [
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_GCM_SHA256',
      'ECDHE-RSA-AES256-GCM-SHA384',
      'ECDHE-RSA-AES128-GCM-SHA256',
    ].join(':'),
  }, app);
}

// ── Start Server ───────────────────────────────────────────

const server = USE_HTTPS ? createHttpsServer() : http.createServer(app);

server.listen(PORT, HOST, () => {
  const protocol = USE_HTTPS ? 'https' : 'http';
  logServerStart({ port: PORT, host: HOST, https: USE_HTTPS });

  console.log(`
╔══════════════════════════════════════════════════════╗
║           MCP Sentinel - v1.0.0                      ║
╠══════════════════════════════════════════════════════╣
║  Status  : ✅ Running                                ║
║  Protocol: ${protocol.toUpperCase().padEnd(43)}║
║  Address : ${`${protocol}://${HOST}:${PORT}`.padEnd(43)}║
║  MCP SSE : ${`${protocol}://${HOST}:${PORT}/mcp`.padEnd(43)}║
║  Health  : ${`${protocol}://${HOST}:${PORT}/health`.padEnd(43)}║
╠══════════════════════════════════════════════════════╣
║  Security: IP Whitelist + API Key + JWT + Rate Limit ║
║  Logs    : ./logs/                                   ║
╚══════════════════════════════════════════════════════╝
  `);
});

// ── Graceful Shutdown ──────────────────────────────────────

const MAX_SSE_CONNECTIONS = parseInt(process.env.MAX_SSE_CONNECTIONS || '100');

function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  // Close all active SSE connections
  for (const [id, session] of activeTransports) {
    try { session.transport.close?.(); } catch {}
    activeTransports.delete(id);
  }
  server.close(() => {
    console.log('Server closed. Goodbye.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logError({ tool: 'UNCAUGHT_EXCEPTION', error: err });
  console.error('Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logError({ tool: 'UNHANDLED_REJECTION', error: new Error(String(reason)) });
});
