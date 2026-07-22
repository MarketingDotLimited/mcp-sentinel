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
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { AcmeManager } from './lib/acme.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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

import { getSystemInfo, getProcesses, killProcess } from './tools/system.js';
import { readFile, writeFile, deleteFile, listDirectory, moveFile, copyFile, getFileInfo, searchFiles } from './tools/files.js';
import { manageService, getServiceStatus, listServices, getJournalLogs, manageFirewall } from './tools/services.js';
import { listUsers, getUserInfo, createUser, deleteUser, setUserPassword, modifyUser, manageSshKeys } from './tools/users.js';
import { runSandboxedCode } from './tools/docker.js';
import { applyConfig, listConfigBackups, restoreConfig } from './tools/rollback.js';
import { gitOperation } from './tools/git.js';
import { executeQuery } from './tools/db.js';
import { monitor } from './lib/monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '4444');
const HOST = process.env.HOST || '0.0.0.0';
const USE_HTTPS = process.env.USE_HTTPS === 'true';

// ── Active SSE connections ─────────────────────────────────
const activeTransports = new Map(); // sessionId -> { transport, identity, ip }

// ── Express App ───────────────────────────────────────────

process.on('uncaughtException', (err) => {
  logError({ ip: 'internal', userId: 'system', tool: 'uncaughtException', error: err });
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  logError({ ip: 'internal', userId: 'system', tool: 'unhandledRejection', error: reason });
  console.error('Unhandled Rejection:', reason);
});

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
  hsts: USE_HTTPS ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

// Serve static Web UI files
app.use(express.static(path.join(__dirname, 'public')));

// CORS - origin policy (this is NOT IP access control)
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
  exposedHeaders: ['Mcp-Session-Id'],
  credentials: false,
}));

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

app.use(globalLimiter);

// Now parse bodies (AFTER rate limiting and IP checking)
app.use(express.json({ limit: '5mb' }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 auth attempts per 15 min
  skipSuccessfulRequests: true,
  keyGenerator: (req) => getClientIP(req),
  handler: (req, res) => {
    logSecurityEvent({ ip: getClientIP(req), event: 'AUTH_RATE_LIMIT', detail: {} });
    res.status(429).json({ error: 'Too many authentication attempts' });
  },
});

const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '5', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || '1800000', 10); // 30 min default

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeTransports.entries()) {
    if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
      logSecurityEvent({ ip: session.ip, event: 'SESSION_IDLE_TIMEOUT', detail: { sessionId: id, userId: session.identity?.userId } });
      if (session.mcpServer) {
        session.mcpServer.close().catch(() => {});
      }
      activeTransports.delete(id);
    }
  }
}, 60000);

// ── Health Check (unauthenticated) ─────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'mcp-sentinel',
    version: process.env.npm_package_version || JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version,
  });
});

// ── Auth Endpoints ─────────────────────────────────────────

// Exchange API key for JWT token
app.post('/auth/token', authLimiter, authenticate, issueToken);

// ── Admin Key Management (admin only) ─────────────────────

app.post('/admin/keys', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { key, userId, role, allowedIPs, scopes, label } = req.body;
  if (!key || !userId) return res.status(400).json({ error: 'key and userId required' });

  try {
    await addApiKey(key, { userId, role, allowedIPs, scopes, label });
    return res.json({ success: true, message: `Key added for user '${userId}'` });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.post('/admin/keys/revoke', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'key required in body' });
  
  const revoked = await revokeApiKey(key);
  return res.json({ success: revoked, message: revoked ? 'Key revoked' : 'Key not found' });
});

app.get('/admin/keys', authenticateJWT, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  return res.json({ keys: listApiKeys() });
});

app.get('/admin/sessions', authenticateJWT, (req, res) => {
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

// ── Admin Web UI API Endpoints ─────────────────────────────

app.get('/admin/stats', authenticateJWT, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const stats = monitor.getLatestStats();
  const sessions = activeTransports.size;
  const keys = listApiKeys();
  return res.json({
    ...stats,
    activeSessions: sessions,
    totalKeys: keys.length,
    serverUptime: process.uptime(),
  });
});

app.get('/admin/logs', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  const logDir = process.env.AUDIT_LOG_DIR || path.join(__dirname, 'logs');
  try {
    const files = (await fsPromises.readdir(logDir))
      .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
      .sort()
      .reverse();
    if (files.length === 0) return res.json({ logs: [] });
    const content = await fsPromises.readFile(path.join(logDir, files[0]), 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).reverse().slice(0, limit);
    const logs = lines.map(line => {
      try { return JSON.parse(line); } catch { return { raw: line }; }
    });
    return res.json({ logs });
  } catch (e) {
    return res.json({ logs: [], error: e.message });
  }
});

app.get('/admin/logs/stream', authenticateJWT, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('data: {"type":"connected"}\n\n');

  const logDir = process.env.AUDIT_LOG_DIR || path.join(__dirname, 'logs');
  let lastSize = 0;
  let currentFile = null;

  const pollInterval = setInterval(async () => {
    try {
      const files = (await fsPromises.readdir(logDir))
        .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
        .sort()
        .reverse();
      if (files.length === 0) return;
      const filePath = path.join(logDir, files[0]);
      if (currentFile !== filePath) {
        currentFile = filePath;
        const stat = await fsPromises.stat(filePath);
        lastSize = stat.size;
        return;
      }
      const stat = await fsPromises.stat(filePath);
      if (stat.size > lastSize) {
        const fd = await fsPromises.open(filePath, 'r');
        const buf = Buffer.alloc(stat.size - lastSize);
        await fd.read(buf, 0, buf.length, lastSize);
        await fd.close();
        const newLines = buf.toString('utf8').trim().split('\n').filter(Boolean);
        for (const line of newLines) {
          try {
            const parsed = JSON.parse(line);
            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          } catch {}
        }
        lastSize = stat.size;
      }
    } catch {}
  }, 2000);

  req.on('close', () => {
    clearInterval(pollInterval);
  });
});

app.delete('/admin/sessions/:id', authenticateJWT, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const sessionId = req.params.id;
  const session = activeTransports.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  try {
    if (session.mcpServer) session.mcpServer.close().catch(() => {});
    monitor.unsubscribeAll(sessionId);
    activeTransports.delete(sessionId);
    logSecurityEvent({ ip: req.clientIP, event: 'SESSION_FORCE_CLOSED', detail: { sessionId, by: req.identity.userId } });
    return res.json({ success: true, message: `Session ${sessionId} disconnected` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/admin/backups', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'filePath query param required' });
  try {
    const result = await listConfigBackups({ filePath }, req.identity);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/admin/backups/restore', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { filePath, timestamp, confirm } = req.body;
  if (!confirm) return res.status(400).json({ error: 'confirm: true required' });
  try {
    const result = await restoreConfig({ filePath, timestamp }, req.identity);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── MCP Endpoint (Streamable HTTP) ─────────────────────────

app.get('/mcp', authenticateJWT, (req, res) => {
  const sessionId = randomUUID();
  const identity = req.identity;
  const ip = req.clientIP;

  // Enforce global connection limit
  const maxConns = parseInt(process.env.MAX_SSE_CONNECTIONS || '100', 10);
  if (activeTransports.size >= maxConns) {
    return res.status(503).json({ error: 'Too many active connections globally' });
  }

  // Enforce per-user limit
  let userCount = 0;
  for (const s of activeTransports.values()) {
    if (s.identity?.userId === identity.userId) userCount++;
  }
  if (userCount >= MAX_SESSIONS_PER_USER) {
    return res.status(429).json({ error: 'Too many active connections for this user' });
  }

  // Create a per-session MCP server instance
  const mcpServer = createMcpServer(identity, ip);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
    enableDnsRebindingProtection: true
  });

  activeTransports.set(sessionId, {
    transport,
    identity,
    ip,
    connectedAt: new Date().toISOString(),
    lastActivity: Date.now(),
    mcpServer,
  });

  res.on('close', () => {
    activeTransports.delete(sessionId);
    monitor.unsubscribeAll(sessionId);
    mcpServer.close().catch(() => {});
  });

  mcpServer.connect(transport).catch(err => {
    logError({ ip, userId: identity.userId, tool: 'SSE_CONNECT', error: err });
  });

  // Handle the initial GET request to establish the SSE stream
  transport.handleRequest(req, res).catch(err => {
    logError({ ip, userId: identity.userId, tool: 'HANDLE_REQUEST_GET', error: err });
  });
});

// MCP message endpoint (POST from client)
app.post(['/mcp', '/mcp/message'], authenticateJWT, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] || req.headers['x-session-id'];
  const session = activeTransports.get(sessionId);

  if (!session) {
    return res.status(400).json({ error: 'Unknown session. Reconnect to /mcp first.' });
  }

  // Verify session ownership — prevent hijacking
  if (session.identity?.userId !== req.identity?.userId) {
    logSecurityEvent({ ip: req.clientIP, event: 'SESSION_HIJACK_ATTEMPT', detail: { sessionOwner: session.identity?.userId, requestUser: req.identity?.userId } });
    return res.status(403).json({ error: 'Session does not belong to you' });
  }

  session.lastActivity = Date.now();

  try {
    await session.transport.handleRequest(req, res);
  } catch (err) {
    logError({ ip: req.clientIP, userId: req.identity?.userId, tool: 'POST_MESSAGE', error: err });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── Centralized Error Handler ──────────────────────────────

app.use((err, req, res, next) => {
  const errorId = require('crypto').randomUUID();
  logError({ ip: req.clientIP || 'unknown', userId: req.identity?.userId || 'unknown', tool: 'HTTP_ERROR', errorId, error: err });
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: `Internal Server Error (ID: ${errorId})` });
  }
});

// ── MCP Server Factory ─────────────────────────────────────

function createMcpServer(identity, ip) {
  const server = new McpServer({
    name: 'server-control',
    version: process.env.npm_package_version || JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version,
  });

  server.onerror = (err) => {
    logError({ ip, userId: identity.userId, tool: 'MCP_SERVER_ERROR', error: err });
  };

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
      
      const destructiveTools = ['delete_file', 'delete_user', 'manage_firewall', 'kill_process'];
      if (destructiveTools.includes(name) && !args.confirm) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'This is a destructive action. You must include "confirm": true in your arguments to proceed.' }) }], isError: true };
      }
      
      try {
        const result = await handler(args, identity);
        logAccess({ ip, apiKey: null, userId: identity.userId, tool: name, args, result: 'success', duration: Date.now() - start });
        const textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text: textContent || 'Success' }] };
      } catch (err) {
        const errorId = require('crypto').randomUUID();
        logError({ ip, userId: identity.userId, tool: name, errorId, error: err });
        logAccess({ ip, userId: identity.userId, tool: name, args, errorId, result: 'failure', duration: Date.now() - start });
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Operation failed (Error ID: ${errorId})` }) }],
          isError: true,
        };
      }
    });
  }

  // ── System Tools ───────────────────────────────────────

  tool('get_system_info', 'Get comprehensive system information: CPU, memory, disk, network, uptime, logged-in users.', {}, getSystemInfo);

  tool('get_processes', 'List running processes. Admins see all processes; users see only their own.', {
    filter: z.string().max(4096).optional().describe('Filter processes by name/keyword'),
    asUser: z.string().max(4096).optional().describe('(Admin only) Show processes for specific user'),
  }, getProcesses);

  tool('kill_process', 'Send a signal to a process. Non-admin users can only kill their own processes.', {
    pid: z.number().int().positive().describe('Process ID to signal'),
    signal: z.enum(['TERM', 'KILL', 'HUP', 'INT', 'USR1', 'USR2']).optional().describe('Signal to send (default: TERM)'),
    confirm: z.boolean().optional().describe('Must be true to execute'),
  }, killProcess);

  // ── File Tools ─────────────────────────────────────────

  tool('read_file', 'Read the contents of a file. Paths are sandboxed per role.', {
    filePath: z.string().max(4096).describe('Absolute path to the file'),
    encoding: z.string().max(4096).optional().describe('File encoding (default: utf8)'),
    maxBytes: z.number().int().positive().optional().describe('Maximum bytes to read (default: 1MB)'),
  }, readFile);

  tool('write_file', 'Write content to a file (create or overwrite). Paths are sandboxed per role.', {
    filePath: z.string().max(4096).describe('Absolute path to the file'),
    content: z.string().max(5 * 1024 * 1024).describe('Content to write'),
    mode: z.enum(['overwrite', 'append']).optional().describe('Write mode (default: overwrite)'),
    encoding: z.string().max(4096).optional().describe('File encoding (default: utf8)'),
  }, writeFile);

  tool('delete_file', 'Delete a file or directory.', {
    filePath: z.string().max(4096).describe('Absolute path to delete'),
    recursive: z.boolean().optional().describe('Recursively delete directory contents (default: false)'),
    confirm: z.boolean().optional().describe('Must be true to execute'),
  }, deleteFile);

  tool('list_directory', 'List the contents of a directory.', {
    dirPath: z.string().max(4096).describe('Absolute path to directory'),
    showHidden: z.boolean().optional().describe('Include hidden files (default: false)'),
    detailed: z.boolean().optional().describe('Include file details like size, permissions (default: true)'),
  }, listDirectory);

  tool('move_file', 'Move or rename a file/directory.', {
    sourcePath: z.string().max(4096).describe('Source path'),
    destPath: z.string().max(4096).describe('Destination path'),
  }, moveFile);

  tool('copy_file', 'Copy a file or directory.', {
    sourcePath: z.string().max(4096).describe('Source path'),
    destPath: z.string().max(4096).describe('Destination path'),
  }, copyFile);

  tool('get_file_info', 'Get detailed metadata about a file including size, permissions, and SHA256 checksum.', {
    filePath: z.string().max(4096).describe('Absolute path to file'),
  }, getFileInfo);

  tool('search_files', 'Search for files by name pattern in a directory tree.', {
    searchPath: z.string().max(4096).describe('Root path to search from'),
    pattern: z.string().max(4096).describe('Filename pattern (supports wildcards, e.g. "*.log")'),
    maxResults: z.number().int().positive().optional().describe('Maximum results (default: 50)'),
    fileType: z.enum(['file', 'directory']).optional().describe('Filter by type'),
  }, searchFiles);

  // ── Service Tools (Admin only) ─────────────────────────

  tool('manage_service', 'Start, stop, restart, enable, or disable a systemd service. Admin only.', {
    service: z.string().max(4096).describe('Service name (e.g. nginx, mysql, sshd)'),
    action: z.enum(['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'status', 'is-active']).describe('Action to perform'),
  }, manageService);

  tool('get_service_status', 'Get detailed status and recent logs for a systemd service. Admin only.', {
    service: z.string().max(4096).describe('Service name'),
  }, getServiceStatus);

  tool('list_services', 'List all systemd services with their status. Admin only.', {
    filter: z.string().max(4096).optional().describe('Filter by service name keyword'),
    state: z.string().max(4096).optional().describe('Filter by state: active, inactive, failed, etc.'),
  }, listServices);

  tool('get_journal_logs', 'Read systemd journal logs. Admin only.', {
    service: z.string().max(4096).optional().describe('Service name to filter logs for'),
    lines: z.number().int().positive().max(500).optional().describe('Number of log lines to return (default: 50, max: 500)'),
    since: z.string().max(4096).optional().describe('Show logs since this time (e.g. "1 hour ago", "2024-01-01 00:00:00")'),
    priority: z.enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']).optional(),
  }, getJournalLogs);

  tool('manage_firewall', 'Manage UFW firewall rules. Admin only.', {
    action: z.enum(['status', 'enable', 'disable', 'allow', 'deny', 'delete', 'list']).describe('Firewall action'),
    port: z.number().int().positive().optional().describe('Port number for allow/deny/delete actions'),
    protocol: z.enum(['tcp', 'udp']).optional().describe('Protocol (default: tcp)'),
    rule: z.enum(['allow', 'deny']).optional().describe('Rule type for delete action'),
    confirm: z.boolean().optional().describe('Must be true to execute destructive actions'),
  }, manageFirewall);

  // ── User Management Tools (Admin only) ─────────────────

  tool('list_users', 'List all system users. Admin only.', {
    includeSystem: z.boolean().optional().describe('Include system users (uid < 1000). Default: false'),
  }, listUsers);

  tool('get_user_info', 'Get detailed info about a user including groups and SSH keys.', {
    username: z.string().max(4096).describe('Username to query'),
  }, getUserInfo);

  tool('create_user', 'Create a new system user. Admin only.', {
    username: z.string().max(4096).describe('New username'),
    password: z.string().max(4096).optional().describe('Initial password'),
    groups: z.string().max(4096).optional().describe('Comma-separated supplementary groups'),
    shell: z.string().max(4096).optional().describe('Login shell (default: /bin/bash)'),
    comment: z.string().max(4096).optional().describe('User comment/description'),
    createHome: z.boolean().optional().describe('Create home directory (default: true)'),
  }, createUser);

  tool('delete_user', 'Delete a system user. Admin only.', {
    username: z.string().max(4096).describe('Username to delete'),
    removeHome: z.boolean().optional().describe('Remove home directory (default: false)'),
    confirm: z.boolean().optional().describe('Must be true to execute'),
  }, deleteUser);

  tool('set_user_password', 'Set or change a user password. Admin only.', {
    username: z.string().max(4096).describe('Username'),
    password: z.string().max(4096).describe('New password'),
  }, setUserPassword);

  tool('modify_user', 'Modify user properties: groups, shell, lock/unlock, expiry. Admin only.', {
    username: z.string().max(4096).describe('Username to modify'),
    addGroups: z.string().max(4096).optional().describe('Comma-separated groups to add user to'),
    removeGroups: z.string().max(4096).optional().describe('Comma-separated groups to remove user from'),
    shell: z.string().max(4096).optional().describe('New login shell'),
    lockAccount: z.boolean().optional().describe('Lock the user account'),
    unlockAccount: z.boolean().optional().describe('Unlock the user account'),
    expireDate: z.string().max(4096).optional().describe('Account expiry date (YYYY-MM-DD), empty string to disable'),
  }, modifyUser);

  tool('manage_ssh_keys', 'Add, list, or remove SSH authorized keys for a user.', {
    username: z.string().max(4096).describe('Target username'),
    action: z.enum(['add', 'list', 'remove']).describe('Action to perform'),
    publicKey: z.string().max(4096).optional().describe('Full SSH public key string (for add action)'),
    keyIndex: z.number().int().nonnegative().optional().describe('Key index to remove (for remove action, use list first)'),
  }, manageSshKeys);

  // ── Docker Sandboxing ────────────────────────────────────

  tool('run_sandboxed_code', 'Run arbitrary code in an ephemeral, hardened Docker container.', {
    language: z.enum(['python', 'node', 'bash']).describe('Language to run'),
    code: z.string().max(102400).describe('Code to execute'),
    allowNetwork: z.boolean().optional().describe('Allow outbound network access (default: false)'),
    timeout: z.number().int().positive().max(120).optional().describe('Timeout in seconds (default: 30)'),
    files: z.record(z.string()).optional().describe('Optional key-value map of filename:content to inject into the workspace'),
  }, runSandboxedCode);

  // ── Rollback Tools (Admin only) ──────────────────────────

  tool('apply_config', 'Safely edit a configuration file, restart a service, and rollback if the service fails to start. Admin only.', {
    filePath: z.string().max(4096).describe('Absolute path to the config file'),
    newContent: z.string().max(5 * 1024 * 1024).describe('New file contents'),
    serviceName: z.string().max(4096).describe('systemd service to validate against'),
    syntaxCheckCmd: z.array(z.string()).optional().describe('Optional syntax check command (e.g. ["nginx", "-t", "-c", "%s"])'),
    healthCheckTimeout: z.number().int().positive().max(60).optional().describe('Seconds to wait for service health (default: 15)'),
    confirm: z.boolean().describe('Must be true to execute'),
  }, applyConfig);

  tool('list_config_backups', 'List available backups for a given file path. Admin only.', {
    filePath: z.string().max(4096).describe('Absolute path to the config file'),
  }, listConfigBackups);

  tool('restore_config', 'Manually restore a specific config backup by timestamp. Admin only.', {
    filePath: z.string().max(4096).describe('Absolute path to the config file'),
    timestamp: z.string().max(4096).describe('Timestamp of the backup to restore'),
    confirm: z.boolean().describe('Must be true to execute'),
  }, restoreConfig);

  // ── Git & DB Tools ───────────────────────────────────────

  tool('git_operation', 'Execute Git operations in allowed repositories.', {
    repoPath: z.string().max(4096).describe('Path to git repository'),
    action: z.enum(['status', 'diff', 'log', 'branch', 'checkout', 'add', 'commit', 'pull', 'push']).describe('Git action'),
    args: z.record(z.any()).optional().describe('Action-specific arguments (e.g. { message: "msg" })'),
  }, gitOperation);

  tool('execute_query', 'Execute a SQL query against a configured database alias.', {
    alias: z.string().max(4096).describe('Configured database alias (e.g. "production")'),
    query: z.string().max(102400).describe('SQL query string with ? placeholders for params'),
    params: z.array(z.any()).optional().describe('Parameters for the query placeholders'),
    confirm: z.boolean().optional().describe('Must be true for write queries'),
  }, executeQuery);

  // ── Pub/Sub Alert Tools ──────────────────────────────────

  tool('subscribe_to_alert', 'Subscribe to a system alert. Will send an MCP resource list_changed notification when triggered.', {
    alertType: z.enum(['cpu_threshold', 'memory_threshold', 'disk_threshold']).describe('Type of alert'),
    threshold: z.number().positive().max(100).describe('Threshold percentage (e.g. 90 for 90%)'),
    cooldownSeconds: z.number().int().positive().optional().describe('Minimum seconds between repeated alerts (default: 300)'),
  }, async ({ alertType, threshold, cooldownSeconds }, identity) => {
    // Find the current session id from activeTransports using identity
    const sessionEntry = Array.from(activeTransports.entries()).find(([_, s]) => s.identity?.userId === identity.userId && s.ip === ip);
    if (!sessionEntry) throw new Error('Session not found');
    const id = monitor.subscribe(sessionEntry[0], alertType, threshold, cooldownSeconds);
    return `Subscribed to ${alertType} at ${threshold}%. Alert ID: ${id}`;
  });

  tool('unsubscribe_from_alert', 'Unsubscribe from an active alert by ID.', {
    alertId: z.string().max(4096).describe('Alert ID returned from subscribe_to_alert'),
  }, async ({ alertId }, identity) => {
    const sessionEntry = Array.from(activeTransports.entries()).find(([_, s]) => s.identity?.userId === identity.userId && s.ip === ip);
    if (!sessionEntry) throw new Error('Session not found');
    monitor.unsubscribe(sessionEntry[0], alertId);
    return `Unsubscribed from ${alertId}`;
  });

  tool('list_active_alerts', 'List your active alert subscriptions.', {}, async (_, identity) => {
    const sessionEntry = Array.from(activeTransports.entries()).find(([_, s]) => s.identity?.userId === identity.userId && s.ip === ip);
    if (!sessionEntry) return { alerts: [] };
    return { alerts: monitor.getActiveAlerts(sessionEntry[0]) };
  });

  return server;
}

// ── TLS Setup ─────────────────────────────────────────────

function createHttpsServer() {
  const certPath = process.env.TLS_CERT_PATH || path.join(__dirname, 'certs', 'server.crt');
  const keyPath = process.env.TLS_KEY_PATH || path.join(__dirname, 'certs', 'server.key');

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error('\n⚠️  TLS cert/key not found. Set USE_HTTPS=false or generate certs with setup.js\n');
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

function validateConfig() {
  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret.length < 64 || jwtSecret.includes('CHANGE_ME')) {
    console.error('FATAL: JWT_SECRET must be at least 64 characters and not a placeholder.');
    process.exit(1);
  }
  const adminKey = process.env.ADMIN_API_KEY || '';
  if (!adminKey || adminKey.includes('CHANGE_ME')) {
    console.error('FATAL: ADMIN_API_KEY must be set and not a placeholder.');
    process.exit(1);
  }
  const port = parseInt(process.env.PORT || '4444', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error('FATAL: PORT must be a valid integer between 1 and 65535.');
    process.exit(1);
  }
  const jwtExpiry = process.env.JWT_EXPIRY || '8h';
  const expiryMatch = jwtExpiry.match(/^(\d+)([hmd])$/);
  if (expiryMatch) {
    const val = parseInt(expiryMatch[1], 10);
    const unit = expiryMatch[2];
    const maxHours = 24;
    let hours = val;
    if (unit === 'd') hours = val * 24;
    if (unit === 'm') hours = val / 60;
    if (hours > maxHours) {
      console.error('FATAL: JWT_EXPIRY cannot exceed 24 hours.');
      process.exit(1);
    }
  } else {
    console.error('FATAL: Invalid JWT_EXPIRY format. Use formats like 8h, 30m.');
    process.exit(1);
  }
  const rlMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10);
  const rlWindow = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
  if (isNaN(rlMax) || rlMax <= 0 || isNaN(rlWindow) || rlWindow <= 0) {
    console.error('FATAL: Rate limit values must be positive integers.');
    process.exit(1);
  }
}

validateConfig();

let acmeManager = null;
let server;

async function startServer() {
  if (USE_HTTPS && process.env.ACME_DOMAIN && process.env.ACME_EMAIL) {
    console.log(`[ACME] Initializing Let's Encrypt for ${process.env.ACME_DOMAIN}...`);
    acmeManager = new AcmeManager(process.env.ACME_DOMAIN, process.env.ACME_EMAIL);
    await acmeManager.init();
    
    const acmePort = parseInt(process.env.ACME_CHALLENGE_PORT || '80', 10);
    const acmeApp = express();
    acmeApp.get('/.well-known/acme-challenge/:token', (req, res) => {
      const response = acmeManager.getChallengeResponse(req.params.token);
      if (response) res.send(response);
      else res.status(404).send('Not found');
    });
    acmeApp.use((req, res) => {
      res.redirect(`https://${process.env.ACME_DOMAIN}${req.url}`);
    });
    
    http.createServer(acmeApp).listen(acmePort, HOST, () => {
      console.log(`[ACME] Challenge server listening on port ${acmePort}`);
    });

    try {
      await acmeManager.checkAndRenew();
      process.env.TLS_CERT_PATH = path.join(process.cwd(), 'certs', 'acme', 'server.crt');
      process.env.TLS_KEY_PATH = path.join(process.cwd(), 'certs', 'acme', 'server.key');
      
      setInterval(async () => {
        try {
          await acmeManager.checkAndRenew();
          if (server && typeof server.setSecureContext === 'function') {
            server.setSecureContext({
              cert: fs.readFileSync(process.env.TLS_CERT_PATH),
              key: fs.readFileSync(process.env.TLS_KEY_PATH),
              minVersion: 'TLSv1.2',
            });
            console.log('[ACME] TLS context hot-reloaded');
          }
        } catch (err) {
          console.error('[ACME] Auto-renew failed:', err);
        }
      }, 86400000);
    } catch (err) {
      console.error('[ACME] Provisioning failed, falling back to self-signed certs:', err);
    }
  }

  server = USE_HTTPS ? createHttpsServer() : http.createServer(app);

  server.listen(PORT, HOST, () => {
    const protocol = USE_HTTPS ? 'https' : 'http';
    logServerStart({ port: PORT, host: HOST, https: USE_HTTPS });

    const currentVersion = process.env.npm_package_version || JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;

    console.log(`
╔══════════════════════════════════════════════════════╗
║           MCP Sentinel - v${currentVersion.padEnd(27)}║
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

  // Start the background monitor
  monitor.start((sessionId, notification) => {
    const session = activeTransports.get(sessionId);
    if (session && session.mcpServer && typeof session.mcpServer.server.notification === 'function') {
      try {
        session.mcpServer.server.notification(notification);
      } catch (e) {
        console.error('[Monitor] Failed to send notification', e);
      }
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
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
  if (server) {
    server.close(() => {
      console.log('Server closed. Flushing logs...');
      import('./audit.js').then(({ shutdownLoggers }) => {
        shutdownLoggers(() => {
          console.log('Goodbye.');
          process.exit(0);
        });
      }).catch(() => process.exit(0));
    });
  } else {
    process.exit(0);
  }
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
