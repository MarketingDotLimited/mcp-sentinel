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
import { createHash, randomUUID } from 'crypto';
import { AcmeManager } from './lib/acme.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import authRouter from './routes/auth.js';
import coreRouter from './routes/core.js';

import {
  ipWhitelist,
  authenticate,
  authenticateJWT,
  issueToken,
  addApiKey,
  revokeApiKey,
  revokeApiKeyById,
  listApiKeys,
  getRoleTemplates,
  scopeAllows,
  getClientIP,
  updateApiKey,
  SCOPE_GROUPS,
  jwtSecretIsConfigured,
} from './security.js';

import { getAuditChainStatus, logAccess, logError, logServerStart, logSecurityEvent } from './audit.js';

import {
  getSystemInfo,
  getProcesses,
  killProcess,
  runProjectTests,
  getProjectTestRun,
  cancelProjectTestRun,
} from './tools/system.js';
import {
  readFile,
  writeFile,
  deleteFile,
  listDirectory,
  moveFile,
  copyFile,
  getFileInfo,
  searchFiles,
} from './tools/files.js';
import { manageService, getServiceStatus, listServices, getJournalLogs, manageFirewall } from './tools/services.js';
import {
  listUsers,
  getUserInfo,
  createUser,
  deleteUser,
  setUserPassword,
  modifyUser,
  manageSshKeys,
} from './tools/users.js';
import { runSandboxedCode } from './tools/docker.js';
import { applyConfig, listConfigBackups, restoreConfig } from './tools/rollback.js';
import { gitOperation } from './tools/git.js';
import { executeQuery } from './tools/db.js';
import { monitor } from './lib/monitor.js';
import { brokerCall } from './lib/broker-client.js';
import { getAdminState, setAdminState } from './lib/admin-state.js';
import { evaluatePolicy, getPolicyStatus } from './lib/policy.js';
import { getCapabilities, isDeprecatedTool, setCapability, toolAvailability } from './lib/capabilities.js';
import { toolResultSchema } from './lib/tool-result-schemas.js';
import {
  assertProjectHealthUrlAllowed,
  assertRepositoryPermitted,
  consumeApproval,
  createOrganization,
  createProject,
  createTeam,
  decideApproval,
  getDeploymentPlan,
  getProject,
  getWorkflowCatalog,
  listApprovals,
  listOrganizations,
  listProjects,
  requestApproval,
  validateKeyAssignment,
} from './lib/control-plane.js';
import {
  getOAuthUsers,
  addOAuthUser,
  updateOAuthUser,
  deleteOAuthUser,
  getOAuthClients,
  addOAuthClient,
  deleteOAuthClient,
  getAutheliaHealth,
} from './lib/authelia-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '4444');
const HOST = process.env.HOST || '0.0.0.0';
const USE_HTTPS = process.env.USE_HTTPS === 'true';

function summarizeHealth(stats) {
  const checks = [
    ['CPU', stats.cpu],
    ['Memory', stats.memory],
    ['Disk', stats.disk],
  ].filter(([, value]) => typeof value === 'number');
  const concerns = checks
    .filter(([, value]) => value >= 85)
    .map(([name, value]) => `${name} usage is ${Math.round(value)}%`);
  const warnings = checks
    .filter(([, value]) => value >= 70 && value < 85)
    .map(([name, value]) => `${name} usage is ${Math.round(value)}%`);
  if (concerns.length) return { status: 'needs-attention', message: concerns.join('. '), concerns, warnings };
  if (warnings.length)
    return {
      status: 'watch',
      message: `${warnings.join('. ')}. Your server is working, but keep an eye on it.`,
      concerns,
      warnings,
    };
  return {
    status: 'healthy',
    message: 'Your server is healthy. CPU, memory, and disk usage are within normal limits.',
    concerns,
    warnings,
  };
}

async function buildSecurityPosture() {
  const checks = [];
  const add = (id, status, message) => checks.push({ id, status, message });
  add(
    'transport',
    USE_HTTPS ? 'pass' : 'warning',
    USE_HTTPS ? 'HTTPS is enabled.' : 'HTTPS is disabled. Do not expose this server publicly until TLS is enabled.'
  );
  add(
    'jwt-secret',
    jwtSecretIsConfigured() ? 'pass' : 'fail',
    jwtSecretIsConfigured()
      ? 'JWT signing secret meets the minimum length.'
      : 'JWT signing secret is missing or too short.'
  );
  const allowedIps = (process.env.ALLOWED_IPS || '').trim();
  add(
    'ip-access',
    allowedIps ? 'pass' : 'warning',
    allowedIps
      ? 'A global IP allow-list is configured.'
      : 'No global IP allow-list is configured; use per-key restrictions or configure ALLOWED_IPS.'
  );
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const trustedProxies = (process.env.TRUSTED_PROXIES || '').trim();
  add(
    'proxy',
    !trustProxy || trustedProxies ? 'pass' : 'warning',
    trustProxy && !trustedProxies
      ? 'Proxy trust is enabled without a trusted-proxy allow-list; forwarded headers will be ignored.'
      : 'Proxy trust configuration is explicit.'
  );
  const policy = await getPolicyStatus().catch(err => ({ enabled: false, error: err.message }));
  add(
    'policy',
    policy.error ? 'fail' : policy.enabled ? 'pass' : 'warning',
    policy.error
      ? `Policy configuration error: ${policy.error}`
      : policy.enabled
        ? `Policy-as-code is active with ${policy.rules} rules.`
        : 'No policy-as-code file is configured.'
  );
  const keys = listApiKeys();
  const approvalKeys = keys.filter(key => key.requireApproval).length;
  add(
    'approvals',
    approvalKeys > 0 ? 'pass' : 'warning',
    approvalKeys > 0
      ? `${approvalKeys} API key(s) require approval for risky actions.`
      : 'No API keys currently require approval for risky actions.'
  );
  const oauthResource = (process.env.OAUTH_RESOURCE_URL || '').replace(/\/$/, '');
  add(
    'oauth-resource',
    oauthResource.startsWith('https://') ? 'pass' : 'fail',
    oauthResource.startsWith('https://')
      ? `OAuth access tokens must target the canonical resource ${oauthResource}.`
      : 'OAUTH_RESOURCE_URL must be an explicit HTTPS URL.'
  );
  const audit = getAuditChainStatus();
  add(
    'audit-chain',
    audit.protection === 'hmac-checkpointed' ? 'pass' : 'warning',
    audit.protection === 'hmac-checkpointed'
      ? 'Audit entries use a persistent HMAC chain. No external append-only anchor is configured.'
      : 'Audit entries are chained only for this process lifetime; configure AUDIT_HMAC_KEY and a protected checkpoint path.'
  );
  const broker = await brokerCall('broker.health', {}, { timeoutMs: 5000 }).catch(error => ({ error: error.message }));
  add(
    'privilege-broker',
    broker.error || !broker.healthy ? 'fail' : 'pass',
    broker.error
      ? `Typed privilege broker is unavailable: ${broker.error}`
      : broker.healthy
        ? `Broker is healthy; SQLite schema and ${broker.projectCount} project execution identity record(s) passed.`
        : `Broker reported invalid project users or migrations: ${broker.invalidProjectUsers?.join(', ') || 'unknown'}`
  );
  const protectedFiles = [
    process.env.AUTHELIA_CONFIG_FILE || '/etc/mcp-sentinel/authelia.yml',
    process.env.AUTHELIA_USERS_FILE || '/etc/mcp-sentinel/users.yml',
    process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3',
  ];
  const unsafeFiles = protectedFiles.filter(file => {
    try {
      return (fs.statSync(file).mode & 0o077) !== 0;
    } catch {
      return true;
    }
  });
  add(
    'protected-file-permissions',
    unsafeFiles.length ? 'fail' : 'pass',
    unsafeFiles.length
      ? `Missing or over-permissive protected files: ${unsafeFiles.join(', ')}`
      : 'Protected state files are mode 0600.'
  );
  const issuer = (process.env.AUTHELIA_ISSUER || '').replace(/\/$/, '');
  let discovery = null;
  if (issuer) {
    discovery = await fetch(`${issuer}/.well-known/openid-configuration`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
  }
  add(
    'oauth-discovery',
    discovery?.ok ? 'pass' : 'fail',
    discovery?.ok ? 'OAuth discovery is reachable over the configured issuer.' : 'OAuth discovery is unavailable.'
  );
  const manifests = [...manifestSnapshots.values()];
  const manifestComplete = manifests.some(snapshot =>
    snapshot.tools?.every(tool => tool.title && tool.inputSchema && tool.outputSchema && tool.annotations)
  );
  add(
    'action-manifest',
    manifestComplete ? 'pass' : 'warning',
    manifestComplete
      ? 'The live action manifest contains titles, schemas, and annotations.'
      : 'Generate the live action manifest and complete the ChatGPT refresh.'
  );
  const failed = checks.filter(check => check.status === 'fail').length;
  const warnings = checks.filter(check => check.status === 'warning').length;
  return {
    status: failed ? 'needs-attention' : warnings ? 'review-recommended' : 'strong',
    checks,
    generatedAt: new Date().toISOString(),
  };
}

// ── Active SSE connections ─────────────────────────────────
const activeTransports = new Map(); // sessionId -> { transport, identity, ip }

function alertOwnerKey(identity) {
  if (identity.oauthSubject && identity.oauthClient)
    return `oauth:${identity.oauthSubject}:${identity.oauthClient}:${identity.authorizationVersion || 1}`;
  if (identity.keyId) return `key:${identity.keyId}:${identity.keyVersion || 1}`;
  return `user:${identity.userId}:${identity.authorizationVersion || 1}`;
}
// Short-lived state for administrator-initiated OAuth diagnostics. Secrets and
// access tokens remain in memory only and are never returned to the browser.
const oauthDiagnostics = new Map();
const manifestSnapshots = new Map();

function manifestIdentityKey(identity) {
  return [identity.authType, identity.oauthSubject || identity.userId, identity.oauthClient || identity.keyId].join(
    ':'
  );
}

async function refreshActiveToolLists() {
  for (const session of activeTransports.values()) {
    for (const item of session.mcpServer?._sentinelRegistrations || []) {
      const availability = await toolAvailability(item.name);
      const policyDecision = await evaluatePolicy({ tool: item.name, identity: session.identity }).catch(() => ({
        allowed: false,
      }));
      if (availability.available && policyDecision.allowed) item.registration.enable();
      else item.registration.disable();
    }
    await session.mcpServer?.sendToolListChanged();
  }
}

// ── Express App ───────────────────────────────────────────

process.on('uncaughtException', err => {
  logError({ ip: 'internal', userId: 'system', tool: 'uncaughtException', error: err });
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', reason => {
  logError({ ip: 'internal', userId: 'system', tool: 'unhandledRejection', error: reason });
  console.error('Unhandled Rejection:', reason);
});

const app = express();

// Redirect legacy port 2053 to the new subdomain
app.use((req, res, next) => {
  if (req.get('host') === 'begin.shopping:2053') {
    return res.redirect(301, 'https://mcp.begin.shopping' + req.originalUrl);
  }
  next();
});

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://static.cloudflareinsights.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'https://cloudflareinsights.com'],
      },
    },
    hsts: USE_HTTPS ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

import compression from 'compression';

// Streaming MCP responses must not be buffered by compression middleware.
app.use(
  compression({
    filter: (req, res) => !['/mcp', '/mcp/message'].includes(req.path) && compression.filter(req, res),
  })
);

// The dashboard's HTML, JS, and CSS filenames are not content-hashed, so they
// must be revalidated after an update. Other static assets may use the short cache.
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      if (/\.(?:html|js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  })
);
// Prevent Cloudflare from aggressively caching CORS preflight responses
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
  next();
});

// CORS - origin policy (this is NOT IP access control)
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (direct API calls) or from trusted origins
      const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        (allowedOrigins.length === 0 && process.env.NODE_ENV !== 'production')
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Session-ID', 'Mcp-Session-Id'],
    exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
    credentials: false,
  })
);

// IP extraction middleware
app.use(ipWhitelist);

// ── Rate Limiting ──────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60'),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => getClientIP(req),
  handler: (req, res) => {
    logSecurityEvent({ ip: getClientIP(req), event: 'RATE_LIMIT_EXCEEDED', detail: {} });
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
  },
});

app.use(globalLimiter);

const authenticatedLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || '120', 10),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req =>
    [
      req.identity?.authType || 'unknown',
      req.identity?.oauthSubject || req.identity?.userId || 'unknown',
      req.identity?.oauthClient || req.identity?.keyId || 'unknown',
    ].join(':'),
});

// Parse JSON after rate limiting and IP checks. Both MCP transports accept the
// parsed body explicitly, which also lets us identify Streamable HTTP initialize requests.
app.use(express.json({ limit: '5mb' }));

// authLimiter moved to routes/auth.js

const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '5', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || '1800000', 10); // 30 min default

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeTransports.entries()) {
    if (now - session.lastActivity > IDLE_TIMEOUT_MS) {
      logSecurityEvent({
        ip: session.ip,
        event: 'SESSION_IDLE_TIMEOUT',
        detail: { sessionId: id, userId: session.identity?.userId },
      });
      if (session.mcpServer) {
        session.mcpServer.close().catch(() => {});
      }
      activeTransports.delete(id);
    }
  }
}, 60000);

// ── Health Check (unauthenticated) ─────────────────────────
app.use('/', coreRouter);

// ── Auth Endpoints ─────────────────────────────────────────

app.use('/auth', authRouter);

// ── Admin Key Management (admin only) ─────────────────────

app.post('/admin/keys', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { key, userId, role, allowedIPs, scopes, label, requireApproval, projectIds, organizationId, teamId } =
    req.body;
  if (!key || !userId) return res.status(400).json({ error: 'key and userId required' });

  try {
    await validateKeyAssignment({ organizationId, teamId });
    await addApiKey(key, {
      userId,
      role,
      allowedIPs,
      scopes,
      label,
      requireApproval,
      projectIds,
      organizationId,
      teamId,
    });
    return res.json({ success: true, message: `Key added for user '${userId}'` });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.post('/admin/keys/revoke', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { key, keyId } = req.body;
  if (!key && !keyId) return res.status(400).json({ error: 'keyId required in body' });

  const revoked = keyId ? await revokeApiKeyById(keyId) : await revokeApiKey(key);
  return res.json({ success: revoked, message: revoked ? 'Key revoked' : 'Key not found' });
});

app.get('/admin/keys', authenticateJWT, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  return res.json({ keys: listApiKeys() });
});

app.put('/admin/keys/:id', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  try {
    const updated = await updateApiKey(req.params.id, req.body);
    res.json({ success: true, key: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/admin/access-templates', authenticateJWT, (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  return res.json({ templates: getRoleTemplates() });
});

app.get('/admin/scope-registry', authenticateJWT, (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  return res.json({
    groups: SCOPE_GROUPS,
    templates: getRoleTemplates(),
  });
});

app.get('/admin/capabilities', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  return res.json({ capabilities: await getCapabilities() });
});

app.put('/admin/capabilities/:id', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  try {
    const capabilities = await setCapability(req.params.id, req.body?.enabled);
    logSecurityEvent({
      ip: req.clientIP,
      event: 'CAPABILITY_UPDATED',
      detail: { capability: req.params.id, enabled: req.body?.enabled, by: req.identity.userId },
    });
    await refreshActiveToolLists();
    return res.json({ capabilities });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.get('/admin/connection-info', authenticateJWT, async (req, res) => {
  const baseUrl = process.env.PUBLIC_URL || `${USE_HTTPS ? 'https' : 'http'}://${req.get('host')}`;
  const publicUrl = baseUrl.replace(/\/$/, '');
  const publicHttps = publicUrl.startsWith('https://');
  const oidcEnabled = Boolean(process.env.AUTHELIA_ISSUER && process.env.AUTHELIA_JWKS_URL);
  return res.json({
    transport: 'streamable-http',
    mcpUrl: `${publicUrl}/mcp`,
    authorization:
      'Use a scoped API key in X-API-Key, or as a Bearer token for clients that only support bearer credentials. Never use the owner key.',
    capabilities: await getCapabilities(),
    readiness: {
      publicHttps,
      oidcEnabled,
      cloudConnectorReady: publicHttps && oidcEnabled,
      cloudConnectorMessage:
        publicHttps && oidcEnabled
          ? 'Cloud connector prerequisites are configured. Complete the platform-specific OAuth setup before enabling write tools.'
          : 'Cloud apps such as ChatGPT and Claude need a public HTTPS URL and OAuth/OIDC. CLI clients can use a scoped API key now.',
    },
    platforms: [
      {
        id: 'chatgpt',
        name: 'ChatGPT (web)',
        auth: 'OAuth/OIDC',
        hint: 'A public HTTPS URL and OAuth/OIDC are required for cloud connectors.',
      },
      {
        id: 'claude-web',
        name: 'Claude (web)',
        auth: 'OAuth/OIDC',
        hint: 'Add a remote custom connector from Claude settings.',
      },
      {
        id: 'claude-desktop',
        name: 'Claude Desktop',
        auth: 'OAuth/OIDC',
        hint: 'Use Settings → Connectors for remote MCP; do not edit the legacy desktop JSON for remote servers.',
      },
      {
        id: 'claude-code',
        name: 'Claude Code CLI',
        auth: 'X-API-Key header',
        hint: 'Add the remote HTTP server with a scoped key header.',
      },
      {
        id: 'codex',
        name: 'Codex CLI',
        auth: 'Bearer API key',
        hint: 'Store a scoped key in an environment variable and register the remote endpoint.',
      },
      {
        id: 'antigravity',
        name: 'Antigravity CLI / IDE',
        auth: 'X-API-Key header',
        hint: 'Use serverUrl and headers in its MCP JSON configuration.',
      },
      {
        id: 'custom',
        name: 'Other MCP clients',
        auth: 'Header or bearer key',
        hint: 'Use the standard Streamable HTTP endpoint and the client’s secure credential store.',
      },
    ],
  });
});

app.get('/admin/policy-status', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  try {
    return res.json(await getPolicyStatus());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/admin/security-posture', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  return res.json(await buildSecurityPosture());
});

app.get('/admin/action-manifest', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  await createMcpServer(req.identity, req.clientIP);
  const manifest = manifestSnapshots.get(manifestIdentityKey(req.identity));
  return res.json({
    manifest,
    refreshChecklist: [
      'Refresh the connector action snapshot in ChatGPT.',
      'Review and approve the reported schema and annotation changes.',
      'Explicitly enable run_project_tests, get_project_test_run, and cancel_project_test_run.',
      'Reauthorize OAuth after the credential rotation.',
      'Open a new chat and run one small assigned-project test target.',
    ],
  });
});

app.get('/admin/remediation-status', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const broker = await brokerCall('broker.health', {}, { timeoutMs: 5000 }).catch(error => ({ error: error.message }));
  let auditVerification = null;
  try {
    auditVerification = JSON.parse(
      fs.readFileSync(
        process.env.AUDIT_VERIFICATION_STATUS_FILE || '/var/lib/mcp-sentinel/audit-verification.json',
        'utf8'
      )
    );
  } catch {}
  return res.json({
    broker,
    migrations: broker.migrations || [],
    audit: { ...getAuditChainStatus(), lastVerification: auditVerification },
    credentialRotation: getAdminState('credential_rotation_status'),
    stateKeyRotation: broker.stateKeyRotation ? JSON.parse(broker.stateKeyRotation) : null,
    actionRefresh: getAdminState('action_refresh_status'),
    manifest: manifestSnapshots.get(manifestIdentityKey(req.identity)) || null,
  });
});

app.post('/admin/credential-rotation-status', authenticateJWT, (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  const allowed = new Set([
    'authelia-signing-key',
    'authelia-session-secret',
    'authelia-storage-secret',
    'oauth-client-secrets',
    'sentinel-jwt-secret',
    'api-keys',
    'user-passwords',
    'webhook-s3-credentials',
    'state-encryption-key',
    'backup-encryption-key',
  ]);
  if (
    req.body?.confirm !== true ||
    !Array.isArray(req.body.components) ||
    !req.body.components.every(item => allowed.has(item))
  )
    return res.status(400).json({ error: 'confirm=true and a valid components array are required' });
  const status = setAdminState('credential_rotation_status', {
    components: [...new Set(req.body.components)],
    recordedAt: new Date().toISOString(),
    recordedBy: req.identity.userId,
  });
  logSecurityEvent({ ip: req.clientIP, event: 'CREDENTIAL_ROTATION_RECORDED', detail: status });
  return res.json(status);
});

app.post('/admin/action-refresh-status', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  await createMcpServer(req.identity, req.clientIP);
  const manifest = manifestSnapshots.get(manifestIdentityKey(req.identity));
  const companions = ['run_project_tests', 'get_project_test_run', 'cancel_project_test_run'];
  if (
    req.body?.confirm !== true ||
    req.body.manifestHash !== manifest.hash ||
    req.body.oauthReauthorized !== true ||
    req.body.newChatTested !== true ||
    !Array.isArray(req.body.enabledTools) ||
    !companions.every(tool => req.body.enabledTools.includes(tool))
  )
    return res
      .status(400)
      .json({ error: 'Manifest hash, OAuth reauthorization, enabled test tools, and new-chat test must be confirmed' });
  const status = setAdminState('action_refresh_status', {
    manifestHash: manifest.hash,
    enabledTools: companions,
    oauthReauthorized: true,
    newChatTested: true,
    recordedAt: new Date().toISOString(),
    recordedBy: req.identity.userId,
  });
  return res.json(status);
});

app.get('/admin/sessions', authenticateJWT, (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const sessions = Array.from(activeTransports.entries()).map(([id, s]) => ({
    sessionId: id,
    userId: s.identity?.userId,
    role: s.identity?.role,
    authType: s.identity?.type || 'unknown',
    scopes: s.identity?.scopes || [],
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
    healthSummary: summarizeHealth(stats),
    activeSessions: sessions,
    totalKeys: keys.length,
    serverUptime: process.uptime(),
  });
});

// ── Control Plane: approvals and guided workflows ─────────

app.get('/admin/workflows', authenticateJWT, (req, res) => {
  return res.json({ workflows: getWorkflowCatalog() });
});

app.get('/admin/approvals', authenticateJWT, async (req, res) => {
  try {
    const approvals = await listApprovals(req.identity, { includeResolved: req.query.includeResolved === 'true' });
    return res.json({ approvals, count: approvals.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/admin/approvals/:id', authenticateJWT, async (req, res) => {
  try {
    const approval = await decideApproval({
      id: req.params.id,
      decision: req.body?.decision,
      note: req.body?.note,
      identity: req.identity,
    });
    logSecurityEvent({
      ip: req.clientIP,
      event: 'APPROVAL_DECIDED',
      detail: { approvalId: approval.id, decision: approval.status, by: req.identity.userId },
    });
    return res.json({ approval });
  } catch (err) {
    return res.status(err.message.includes('Only administrators') ? 403 : 400).json({ error: err.message });
  }
});

app.get('/admin/projects', authenticateJWT, async (req, res) => {
  try {
    return res.json({ projects: await listProjects(req.identity) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/admin/projects', authenticateJWT, async (req, res) => {
  try {
    const project = await createProject(req.body || {}, req.identity);
    logSecurityEvent({
      ip: req.clientIP,
      event: 'PROJECT_CREATED',
      detail: { projectId: project.id, name: project.name, by: req.identity.userId },
    });
    return res.status(201).json({ project });
  } catch (err) {
    return res.status(err.message.includes('Only administrators') ? 403 : 400).json({ error: err.message });
  }
});

app.get('/admin/organizations', authenticateJWT, async (req, res) => {
  try {
    return res.json(await listOrganizations(req.identity));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/admin/organizations', authenticateJWT, async (req, res) => {
  try {
    const organization = await createOrganization(req.body || {}, req.identity);
    logSecurityEvent({
      ip: req.clientIP,
      event: 'ORGANIZATION_CREATED',
      detail: { organizationId: organization.id, by: req.identity.userId },
    });
    return res.status(201).json({ organization });
  } catch (err) {
    return res.status(err.message.includes('Only administrators') ? 403 : 400).json({ error: err.message });
  }
});

app.post('/admin/teams', authenticateJWT, async (req, res) => {
  try {
    const team = await createTeam(req.body || {}, req.identity);
    logSecurityEvent({
      ip: req.clientIP,
      event: 'TEAM_CREATED',
      detail: { teamId: team.id, organizationId: team.organizationId, by: req.identity.userId },
    });
    return res.status(201).json({ team });
  } catch (err) {
    return res.status(err.message.includes('Only administrators') ? 403 : 400).json({ error: err.message });
  }
});

app.get('/admin/os-users', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  try {
    const { listUsers } = await import('./tools/users.js');
    const result = await listUsers({ includeSystem: false }, req.identity);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
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
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
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
    Connection: 'keep-alive',
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
    logSecurityEvent({
      ip: req.clientIP,
      event: 'SESSION_FORCE_CLOSED',
      detail: { sessionId, by: req.identity.userId },
    });
    return res.json({ success: true, message: `Session ${sessionId} disconnected` });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get('/admin/backups', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { configId } = req.query;
  if (!configId) return res.status(400).json({ error: 'configId query param required' });
  try {
    const result = await listConfigBackups({ configId }, req.identity);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/admin/backups/restore', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  const { configId, timestamp, confirm } = req.body;
  if (!confirm) return res.status(400).json({ error: 'confirm: true required' });
  try {
    const result = await restoreConfig({ configId, timestamp }, req.identity);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ── OAuth Metadata (RFC 9728) ──────────────────────────────

app.get('/.well-known/oauth-protected-resource', (req, res) => {
  const resource = process.env.OAUTH_RESOURCE_URL || `${req.protocol}://${req.get('host')}`;
  const authorizationServer = process.env.AUTHELIA_ISSUER;
  res.json({
    resource,
    ...(authorizationServer ? { authorization_servers: [authorizationServer] } : {}),
    // Authelia advertises offline_access and refresh_token support. Include it
    // here so cloud MCP clients such as ChatGPT can request a renewable grant
    // instead of requiring the user to authenticate again after token expiry.
    scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/MarketingDotLimited/mcp-sentinel',
  });
});

// ── OAuth User Management ──────────────────────────────────

app.get('/admin/oauth-users', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const users = await getOAuthUsers();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/oauth-users', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const user = await addOAuthUser(req.body);
    logSecurityEvent({ ip: req.clientIP, event: 'OAUTH_USER_CREATED', detail: { username: req.body.username } });
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/admin/oauth-users/:username', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    await updateOAuthUser(req.params.username, req.body);
    logSecurityEvent({ ip: req.clientIP, event: 'OAUTH_USER_UPDATED', detail: { username: req.params.username } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/admin/oauth-users/:username', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    await deleteOAuthUser(req.params.username);
    logSecurityEvent({ ip: req.clientIP, event: 'OAUTH_USER_DELETED', detail: { username: req.params.username } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── OAuth Client Management ────────────────────────────────

app.get('/admin/oauth-clients', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const clients = await getOAuthClients();
    res.json(clients);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/oauth-clients', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const client = await addOAuthClient(req.body);
    logSecurityEvent({ ip: req.clientIP, event: 'OAUTH_CLIENT_CREATED', detail: { clientId: req.body.clientId } });
    res.json(client);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/admin/oauth-clients/:clientId', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    await deleteOAuthClient(req.params.clientId);
    logSecurityEvent({ ip: req.clientIP, event: 'OAUTH_CLIENT_DELETED', detail: { clientId: req.params.clientId } });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Starts a real authorization-code flow, then tests MCP initialize with the
// issued access token. It is restricted to admins and removes its temporary
// OAuth client as soon as the callback completes.
app.post('/admin/oauth-diagnostic/start', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const issuer = (process.env.AUTHELIA_ISSUER || '').replace(/\/$/, '');
  const resource = (
    process.env.OAUTH_RESOURCE_URL ||
    process.env.PUBLIC_URL ||
    `${req.protocol}://${req.get('host')}`
  ).replace(/\/$/, '');
  if (!issuer) return res.status(400).json({ error: 'Authelia issuer is not configured' });
  const state = randomUUID();
  const codeVerifier = Buffer.from(`${randomUUID()}${randomUUID()}`).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const clientId = `mcp-diagnostic-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const redirectUri = `${resource}/oauth-diagnostic/callback`;
  try {
    const client = await addOAuthClient({
      clientId,
      clientName: 'Temporary MCP OAuth diagnostic',
      redirectUris: [redirectUri],
    });
    const expiresAt = Date.now() + 10 * 60 * 1000;
    oauthDiagnostics.set(state, {
      clientId: client.client_id,
      clientSecret: client.client_secret,
      redirectUri,
      resource,
      codeVerifier,
      expiresAt,
    });
    const cleanupTimer = setTimeout(
      () => {
        const pending = oauthDiagnostics.get(state);
        if (!pending || pending.clientId !== client.client_id) return;
        oauthDiagnostics.delete(state);
        deleteOAuthClient(client.client_id).catch(error =>
          logError({ ip: 'internal', userId: 'system', tool: 'OAUTH_DIAGNOSTIC_EXPIRY_CLEANUP', error })
        );
      },
      10 * 60 * 1000
    );
    cleanupTimer.unref();
    for (const [key, value] of oauthDiagnostics) if (value.expiresAt < Date.now()) oauthDiagnostics.delete(key);
    const authorizationUrl = new URL(`${issuer}/api/oidc/authorization`);
    authorizationUrl.searchParams.set('client_id', client.client_id);
    authorizationUrl.searchParams.set('redirect_uri', redirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('scope', 'openid profile email offline_access');
    authorizationUrl.searchParams.set('resource', resource);
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    logSecurityEvent({ ip: req.clientIP, event: 'OAUTH_DIAGNOSTIC_STARTED', detail: { clientId: client.client_id } });
    res.json({ authorizationUrl: authorizationUrl.toString(), expiresAt: new Date(expiresAt).toISOString() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/oauth-diagnostic/callback', async (req, res) => {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const diagnostic = oauthDiagnostics.get(state);
  oauthDiagnostics.delete(state);
  const render = (title, message, passed = false) =>
    res
      .status(passed ? 200 : 400)
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><title>${title}</title><main style="font:16px system-ui;max-width:640px;margin:4rem auto;padding:2rem"><h1>${title}</h1><p>${message}</p><p>You may close this window.</p></main>`
      );
  if (!diagnostic || diagnostic.expiresAt < Date.now() || !code)
    return render(
      'OAuth diagnostic failed',
      'The test expired or no authorization code was returned. Start a new test from the OAuth screen.'
    );
  try {
    const tokenResponse = await fetch(`${process.env.AUTHELIA_ISSUER.replace(/\/$/, '')}/api/oidc/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${diagnostic.clientId}:${diagnostic.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: diagnostic.redirectUri,
        resource: diagnostic.resource,
        code_verifier: diagnostic.codeVerifier,
      }),
    });
    const tokenBody = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string')
      throw new Error(
        `Token exchange failed (${tokenResponse.status}${tokenBody.error ? `: ${tokenBody.error}` : ''})`
      );
    if (typeof tokenBody.refresh_token !== 'string')
      throw new Error('Token exchange did not issue the requested refresh token');
    const mcpHeaders = {
      Authorization: `Bearer ${tokenBody.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    const mcpResponse = await fetch(`${diagnostic.resource}/mcp`, {
      method: 'GET',
      headers: mcpHeaders,
    });
    const sessionId = mcpResponse.headers.get('mcp-session-id');
    if (!sessionId) throw new Error('MCP initialize did not return a session ID');
    const sessionHeaders = { ...mcpHeaders, 'Mcp-Session-Id': sessionId };
    const initResponse = await fetch(`${diagnostic.resource}/mcp/message`, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'MCP OAuth diagnostic', version: '1.0' },
        },
      }),
    });
    console.log('Diagnostic POST /mcp/message returned:', initResponse.status, 'SessionId:', sessionId);
    if (!initResponse.ok) throw new Error(`MCP initialize message failed (${initResponse.status})`);

    const initializedResponse = await fetch(`${diagnostic.resource}/mcp/message`, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    if (!initializedResponse.ok) throw new Error(`MCP initialized notification failed (${initializedResponse.status})`);
    const toolsResponse = await fetch(`${diagnostic.resource}/mcp/message`, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const toolsBody = await toolsResponse.text();
    if (!toolsResponse.ok) throw new Error(`MCP tools/list failed (${toolsResponse.status})`);
    logSecurityEvent({ ip: req.clientIP, event: 'OAUTH_DIAGNOSTIC_PASSED', detail: { clientId: diagnostic.clientId } });
    return render(
      'OAuth and MCP connection succeeded',
      'The live server issued access and refresh tokens, initialized an authenticated MCP session, and returned its tool list.',
      true
    );
  } catch (error) {
    logSecurityEvent({
      ip: req.clientIP,
      event: 'OAUTH_DIAGNOSTIC_FAILED',
      detail: { clientId: diagnostic.clientId, error: error.message },
    });
    return render('OAuth diagnostic failed', `The live test reached an error: ${error.message}`);
  } finally {
    deleteOAuthClient(diagnostic.clientId).catch(error =>
      logError({ ip: req.clientIP, userId: 'system', tool: 'OAUTH_DIAGNOSTIC_CLEANUP', error })
    );
  }
});

// ── Authelia Health & Control ──────────────────────────────

app.get('/admin/oauth-health', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const health = await getAutheliaHealth();
    res.json(health);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/oauth-restart', authenticateJWT, async (req, res) => {
  if (req.identity.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  return res.status(409).json({
    error: 'Direct OAuth-provider restart is disabled. Use the registered recovery workflow with console access.',
  });
});

// MCP SSE endpoint. A session is created by a GET request to /mcp;
// subsequent POST requests to /mcp/message must present the session id.
app.all(['/mcp', '/mcp/message'], authenticateJWT, authenticatedLimiter, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] || req.headers['x-session-id'] || req.query.sessionId;
  let session = activeTransports.get(sessionId);

  // Modern MCP clients initialize Streamable HTTP with a POST directly to
  // /mcp. This path coexists with the legacy GET + /mcp/message SSE flow below.
  if (!session && req.method === 'POST' && req.path === '/mcp' && !sessionId) {
    if (!isInitializeRequest(req.body)) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid MCP session ID provided' },
        id: null,
      });
    }

    const identity = req.identity;
    const ip = req.clientIP;
    const maxConns = parseInt(process.env.MAX_SSE_CONNECTIONS || '100', 10);
    if (activeTransports.size >= maxConns) {
      return res.status(503).json({ error: 'Too many active connections globally' });
    }
    const userCount = [...activeTransports.values()].filter(item => item.identity?.userId === identity.userId).length;
    if (userCount >= MAX_SESSIONS_PER_USER) {
      return res.status(429).json({ error: 'Too many active connections for this user' });
    }

    let transport;
    const mcpServer = await createMcpServer(identity, ip);
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: initializedSessionId => {
        identity.sessionId = initializedSessionId;
        const streamableSession = {
          transport,
          identity,
          ip,
          connectedAt: new Date().toISOString(),
          lastActivity: Date.now(),
          mcpServer,
        };
        activeTransports.set(initializedSessionId, streamableSession);
        monitor.attachPersistent(initializedSessionId, alertOwnerKey(identity));
      },
    });
    transport.onclose = () => {
      const initializedSessionId = transport.sessionId;
      if (initializedSessionId) {
        activeTransports.delete(initializedSessionId);
        monitor.unsubscribeAll(initializedSessionId);
      }
    };
    transport.onerror = err => {
      logError({ ip, userId: identity.userId, tool: 'MCP_STREAMABLE_TRANSPORT', error: err });
    };

    try {
      res.setHeader('X-Accel-Buffering', 'no');
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      const initializedSessionId = transport.sessionId;
      if (initializedSessionId) activeTransports.delete(initializedSessionId);
      logError({ ip, userId: identity.userId, tool: 'MCP_STREAMABLE_CONNECT', error: err });
      if (!res.headersSent) {
        return res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Unable to initialize MCP session' },
          id: null,
        });
      }
    }
    return;
  }

  if (!session && req.method === 'GET' && req.path === '/mcp' && !sessionId) {
    const identity = req.identity;
    const ip = req.clientIP;
    const maxConns = parseInt(process.env.MAX_SSE_CONNECTIONS || '100', 10);
    if (activeTransports.size >= maxConns) {
      return res.status(503).json({ error: 'Too many active connections globally' });
    }
    const userCount = [...activeTransports.values()].filter(s => s.identity?.userId === identity.userId).length;
    if (userCount >= MAX_SESSIONS_PER_USER) {
      return res.status(429).json({ error: 'Too many active connections for this user' });
    }

    const transport = new SSEServerTransport('/mcp/message', res);
    identity.sessionId = transport.sessionId;
    const mcpServer = await createMcpServer(identity, ip);
    monitor.attachPersistent(transport.sessionId, alertOwnerKey(identity));

    // Tools are registered before the transport exists, so the SDK's automatic
    // list-changed notifications cannot reach the client. Notify again once the
    // MCP initialization handshake completes to invalidate cached manifests.
    mcpServer.server.oninitialized = async () => {
      await mcpServer.sendToolListChanged();
      logSecurityEvent({
        ip,
        event: 'MCP_TOOL_LIST_REFRESH_SENT',
        detail: { userId: identity.userId, sessionId: transport.sessionId },
      });
    };

    res.setHeader('mcp-session-id', transport.sessionId);
    res.setHeader('X-Accel-Buffering', 'no');

    session = { transport, identity, ip, connectedAt: new Date().toISOString(), lastActivity: Date.now(), mcpServer };
    activeTransports.set(transport.sessionId, session);
    transport.onclose = () => {
      console.log('Session closed/deleted!', transport.sessionId);
      activeTransports.delete(transport.sessionId);
      monitor.unsubscribeAll(transport.sessionId);
    };
    try {
      await mcpServer.connect(transport);
    } catch (err) {
      activeTransports.delete(transport.sessionId);
      logError({ ip, userId: identity.userId, tool: 'MCP_CONNECT', error: err });
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Unable to initialize MCP session' });
      }
    }
    return; // SSEServerTransport handles the response stream
  } else if (!session) {
    console.log('Session lookup failed for ID:', sessionId, 'Method:', req.method, 'Path:', req.path);
    return res.status(404).json({ error: 'Unknown MCP session' });
  }

  // Verify session ownership — prevent hijacking
  if (
    session.identity?.userId !== req.identity?.userId ||
    session.identity?.authType !== req.identity?.authType ||
    (session.identity?.authType === 'apiKey' && session.identity?.keyId !== req.identity?.keyId) ||
    (session.identity?.authType === 'oauth' &&
      (session.identity?.oauthUser !== req.identity?.oauthUser ||
        session.identity?.oauthClient !== req.identity?.oauthClient ||
        session.identity?.oauthSubject !== req.identity?.oauthSubject ||
        session.identity?.authorizationVersion !== req.identity?.authorizationVersion))
  ) {
    logSecurityEvent({
      ip: req.clientIP,
      event: 'SESSION_HIJACK_ATTEMPT',
      detail: { sessionOwner: session.identity?.userId, requestUser: req.identity?.userId },
    });
    if (session.identity?.authorizationVersion !== req.identity?.authorizationVersion) {
      await session.mcpServer?.close().catch(() => {});
      activeTransports.delete(sessionId);
    }
    return res.status(403).json({ error: 'Session does not belong to you' });
  }

  session.lastActivity = Date.now();

  try {
    if (session.transport instanceof StreamableHTTPServerTransport) {
      if (req.path !== '/mcp') {
        return res.status(400).json({ error: 'Streamable HTTP sessions use the /mcp endpoint' });
      }
      await session.transport.handleRequest(req, res, req.body);
    } else if (req.method === 'POST') {
      await session.transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    logError({ ip: req.clientIP, userId: req.identity?.userId, tool: 'POST_MESSAGE', error: err });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// ── Centralized Error Handler ──────────────────────────────

app.use((err, req, res, next) => {
  const errorId = randomUUID();
  logError({
    ip: req.clientIP || 'unknown',
    userId: req.identity?.userId || 'unknown',
    tool: 'HTTP_ERROR',
    errorId,
    error: err,
  });
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: `Internal Server Error (ID: ${errorId})` });
  }
});

// ── MCP Server Factory ─────────────────────────────────────

async function createMcpServer(identity, ip) {
  const server = new McpServer({
    name: 'server-control',
    version:
      process.env.npm_package_version ||
      JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version,
  });

  server.onerror = err => {
    logError({ ip, userId: identity.userId, tool: 'MCP_SERVER_ERROR', error: err });
  };

  server.registerResource(
    'current-alerts',
    'mcp-sentinel://alerts/current',
    { title: 'Current MCP Sentinel alerts', description: 'Alert subscriptions for this exact MCP session' },
    async uri => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            sessionId: identity.sessionId || null,
            alerts: monitor.getActiveAlerts(identity.sessionId),
          }),
        },
      ],
    })
  );

  // ── Helper: wrap tool calls with audit logging ───────────
  const registrations = [];
  function tool(name, description, schema, handler, resultSchema = null) {
    // Tools outside the authenticated identity's scope are never advertised.
    // Invocation checks below remain as defense in depth for stale sessions.
    if (!scopeAllows(identity.scopes || [], name)) return;
    const readOnlyTools = new Set([
      'get_system_info',
      'get_processes',
      'read_file',
      'list_directory',
      'get_file_info',
      'search_files',
      'get_service_status',
      'list_services',
      'get_journal_logs',
      'list_users',
      'get_user_info',
      'list_config_backups',
      'list_guided_workflows',
      'get_security_posture',
      'list_projects',
      'plan_project_deployment',
      'list_active_alerts',
      'get_project_test_run',
    ]);
    const stateChangingTools = new Set([
      'write_file',
      'delete_file',
      'move_file',
      'copy_file',
      'kill_process',
      'manage_service',
      'manage_firewall',
      'create_user',
      'delete_user',
      'set_user_password',
      'modify_user',
      'manage_ssh_keys',
      'run_sandboxed_code',
      'apply_config',
      'restore_config',
      'git_operation',
      'execute_query',
      'request_change_approval',
      'deploy_project',
      'subscribe_to_alert',
      'unsubscribe_from_alert',
      'run_project_tests',
      'cancel_project_test_run',
    ]);
    const openWorldTools = new Set([
      'deploy_project',
      'run_project_tests',
      'run_sandboxed_code',
      'git_operation',
      'execute_query',
    ]);
    const annotations = {
      readOnlyHint: readOnlyTools.has(name),
      destructiveHint: stateChangingTools.has(name),
      idempotentHint: readOnlyTools.has(name),
      openWorldHint: openWorldTools.has(name),
    };
    const title = name
      .split('_')
      .map(word => word[0].toUpperCase() + word.slice(1))
      .join(' ');
    const fullDescription = `${description}${isDeprecatedTool(name) ? ' Deprecated: retained for compatibility through the next minor release.' : ''}`;
    const inputJsonSchema = zodToJsonSchema(z.object(schema), { target: 'openApi3', $refStrategy: 'none' });
    const errorResultSchema = z
      .object({
        error: z.string(),
        errorId: z.string().uuid().optional(),
        requiredCapability: z.string().nullable().optional(),
        pendingApproval: z.boolean().optional(),
        approvalId: z.string().uuid().optional(),
        message: z.string().optional(),
      })
      .passthrough();
    const effectiveResultSchema = z.union([resultSchema || toolResultSchema(name), errorResultSchema]);
    const outputJsonSchema = zodToJsonSchema(z.object({ result: effectiveResultSchema }), {
      target: 'openApi3',
      $refStrategy: 'none',
    });
    const registration = server.registerTool(
      name,
      {
        title,
        description: fullDescription,
        inputSchema: schema,
        outputSchema: { result: effectiveResultSchema.describe('Structured result returned by this operation') },
        annotations,
      },
      async args => {
        const start = Date.now();
        const availability = await toolAvailability(name);
        if (!availability.available) {
          logSecurityEvent({
            ip,
            event: 'CAPABILITY_DENIED',
            detail: { userId: identity.userId, tool: name, capability: availability.pack },
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: availability.message, requiredCapability: availability.pack }),
              },
            ],
            structuredContent: { result: { error: availability.message, requiredCapability: availability.pack } },
            isError: true,
          };
        }
        // Enforce scope authorization
        const scopes = identity.scopes || [];
        if (!scopeAllows(scopes, name)) {
          logSecurityEvent({ ip, event: 'SCOPE_DENIED', detail: { userId: identity.userId, tool: name } });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: `Access to tool '${name}' is not permitted by your API key scopes` }),
              },
            ],
            structuredContent: {
              result: { error: `Access to tool '${name}' is not permitted by your API key scopes` },
            },
            isError: true,
          };
        }

        let policyDecision;
        try {
          policyDecision = await evaluatePolicy({ tool: name, identity });
        } catch (err) {
          logSecurityEvent({ ip, event: 'POLICY_ERROR', detail: { tool: name, error: err.message } });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: 'Server policy could not be evaluated. The action was not run.' }),
              },
            ],
            structuredContent: { result: { error: 'Server policy could not be evaluated. The action was not run.' } },
            isError: true,
          };
        }
        if (!policyDecision.allowed) {
          logSecurityEvent({ ip, event: 'POLICY_DENIED', detail: { userId: identity.userId, tool: name } });
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: policyDecision.reason }) }],
            structuredContent: { result: { error: policyDecision.reason } },
            isError: true,
          };
        }

        const requiresConfirmation =
          [
            'delete_file',
            'delete_user',
            'create_user',
            'set_user_password',
            'apply_config',
            'restore_config',
            'kill_process',
            'run_project_tests',
            'cancel_project_test_run',
          ].includes(name) ||
          (name === 'modify_user' && Object.keys(args).some(key => !['username', 'confirm'].includes(key))) ||
          (name === 'manage_ssh_keys' && ['add', 'remove'].includes(args.action)) ||
          (name === 'manage_firewall' && !['status', 'list'].includes(args.action)) ||
          (name === 'manage_service' && !['status', 'is-active'].includes(args.action)) ||
          (name === 'run_sandboxed_code' && args.allowNetwork === true) ||
          (name === 'git_operation' && ['checkout', 'add', 'commit', 'pull', 'push'].includes(args.action)) ||
          name === 'deploy_project' ||
          (name === 'execute_query' &&
            /^\s*(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|GRANT|REVOKE)/i.test(args.query || '')) ||
          policyDecision.requireApproval;
        if (requiresConfirmation && !args.confirm) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: 'This is a destructive action. You must include "confirm": true in your arguments to proceed.',
                }),
              },
            ],
            structuredContent: {
              result: {
                error: 'This is a destructive action. You must include "confirm": true in your arguments to proceed.',
              },
            },
            isError: true,
          };
        }

        // Keys created with approval mode cannot execute a risky action until an
        // administrator has approved this exact, redacted request. The approved
        // grant is single-use and expires automatically.
        const approvalSensitive =
          requiresConfirmation || ['write_file', 'move_file', 'copy_file', 'run_sandboxed_code'].includes(name);
        if (approvalSensitive && identity.requireApproval) {
          const approved = await consumeApproval({ tool: name, args, identity });
          if (!approved) {
            const { approval, created } = await requestApproval({
              tool: name,
              args,
              identity,
              risk: 'high',
              summary: `AI requested ${name.replaceAll('_', ' ')}`,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    pendingApproval: true,
                    approvalId: approval.id,
                    message: created
                      ? 'This action is waiting for an administrator to approve it. Resubmit the exact request after approval.'
                      : 'This action is already waiting for administrator approval.',
                  }),
                },
              ],
              structuredContent: {
                result: {
                  pendingApproval: true,
                  approvalId: approval.id,
                  message: created
                    ? 'This action is waiting for an administrator to approve it. Resubmit the exact request after approval.'
                    : 'This action is already waiting for administrator approval.',
                },
              },
              isError: true,
            };
          }
        }

        try {
          const result = await handler(args, identity);
          logAccess({
            ip,
            apiKey: null,
            userId: identity.userId,
            tool: name,
            args,
            result: 'success',
            duration: Date.now() - start,
          });
          const textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          return {
            content: [{ type: 'text', text: textContent || 'Success' }],
            structuredContent: { result },
            ...(availability.deprecated
              ? { _meta: { deprecated: true, deprecationMessage: availability.message } }
              : {}),
          };
        } catch (err) {
          const errorId = randomUUID();
          logError({ ip, userId: identity.userId, tool: name, errorId, error: err });
          logAccess({
            ip,
            userId: identity.userId,
            tool: name,
            args,
            errorId,
            result: 'failure',
            duration: Date.now() - start,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `Operation failed (Error ID: ${errorId})` }) }],
            structuredContent: { result: { error: `Operation failed (Error ID: ${errorId})`, errorId } },
            isError: true,
          };
        }
      }
    );
    registrations.push({
      name,
      registration,
      definition: {
        name,
        title,
        description: fullDescription,
        inputSchema: inputJsonSchema,
        outputSchema: outputJsonSchema,
        annotations,
      },
    });
  }

  // ── System Tools ───────────────────────────────────────

  tool(
    'get_system_info',
    'Get comprehensive system information: CPU, memory, disk, network, uptime, logged-in users.',
    {},
    getSystemInfo
  );

  tool(
    'get_processes',
    'List running processes. Admins see all processes; users see only their own.',
    {
      filter: z.string().max(4096).optional().describe('Filter processes by name/keyword'),
      asUser: z.string().max(4096).optional().describe('(Admin only) Show processes for specific user'),
    },
    getProcesses
  );

  tool(
    'kill_process',
    'Send a signal to a process. Non-admin users can only kill their own processes.',
    {
      pid: z.number().int().positive().describe('Process ID to signal'),
      signal: z
        .enum(['TERM', 'KILL', 'HUP', 'INT', 'USR1', 'USR2'])
        .optional()
        .describe('Signal to send (default: TERM)'),
      confirm: z.literal(true).describe('Must be true to execute'),
    },
    killProcess
  );
  tool(
    'run_project_tests',
    'Run a registered project test recipe as the project execution user in a verified testing environment.',
    {
      projectId: z.string().uuid().describe('Assigned registered project identifier'),
      runner: z
        .enum([
          'artisan',
          'phpunit',
          'npm',
          'composer-validate',
          'pest',
          'frontend',
          'playwright',
          'python',
          'go',
          'rust',
        ])
        .describe('Registered test recipe to use'),
      target: z
        .string()
        .max(4096)
        .optional()
        .describe('Relative test file or directory; required unless full-suite execution is registered'),
      filter: z.string().min(1).max(256).optional().describe('Optional bounded runner filter'),
      confirm: z.literal(true).describe('Must be true to start the test process'),
    },
    runProjectTests,
    z.object({
      runId: z.string().uuid(),
      projectId: z.string().uuid(),
      runner: z.string(),
      target: z.string().nullable(),
      state: z.enum(['running', 'completed', 'failed', 'cancelled']),
      exitCode: z.number().int().nullable(),
      durationMs: z.number().nonnegative(),
      testCount: z.number().int().nonnegative().optional(),
      assertionCount: z.number().int().nonnegative().optional(),
      stdout: z.string(),
      stderr: z.string(),
      truncated: z.boolean(),
      failureClassification: z
        .enum(['cancelled', 'timeout', 'unsafe-environment', 'test-failure', 'runner-error'])
        .nullable(),
    })
  );

  tool(
    'get_project_test_run',
    'Get the structured status and bounded output of a project test run owned by this identity.',
    { runId: z.string().uuid().describe('Test run identifier') },
    getProjectTestRun,
    z.object({
      runId: z.string().uuid(),
      projectId: z.string().uuid(),
      runner: z.string(),
      target: z.string().nullable(),
      state: z.enum(['running', 'completed', 'failed', 'cancelled']),
      exitCode: z.number().int().nullable(),
      durationMs: z.number().nonnegative(),
      testCount: z.number().int().nonnegative().optional(),
      assertionCount: z.number().int().nonnegative().optional(),
      stdout: z.string(),
      stderr: z.string(),
      truncated: z.boolean(),
      failureClassification: z
        .enum(['cancelled', 'timeout', 'unsafe-environment', 'test-failure', 'runner-error'])
        .nullable(),
    })
  );

  tool(
    'cancel_project_test_run',
    'Cancel a running project test and its managed process tree.',
    {
      runId: z.string().uuid().describe('Test run identifier'),
      confirm: z.literal(true).describe('Must be true to cancel the run'),
    },
    cancelProjectTestRun,
    z.object({
      runId: z.string().uuid(),
      projectId: z.string().uuid(),
      runner: z.string(),
      target: z.string().nullable(),
      state: z.enum(['running', 'completed', 'failed', 'cancelled']),
      exitCode: z.number().int().nullable(),
      durationMs: z.number().nonnegative(),
      testCount: z.number().int().nonnegative().optional(),
      assertionCount: z.number().int().nonnegative().optional(),
      stdout: z.string(),
      stderr: z.string(),
      truncated: z.boolean(),
      failureClassification: z
        .enum(['cancelled', 'timeout', 'unsafe-environment', 'test-failure', 'runner-error'])
        .nullable(),
    })
  );

  // ── File Tools ─────────────────────────────────────────

  tool(
    'read_file',
    'Read the contents of a file. Paths are sandboxed per role.',
    {
      projectId: z.string().uuid().describe('Assigned registered project UUID'),
      filePath: z.string().max(4096).describe('Path relative to the registered project root'),
      encoding: z.string().max(4096).optional().describe('File encoding (default: utf8)'),
      maxBytes: z.number().int().positive().optional().describe('Maximum bytes to read (default: 1MB)'),
    },
    readFile
  );

  tool(
    'write_file',
    'Write content to a file (create or overwrite). Paths are sandboxed per role.',
    {
      projectId: z.string().uuid().describe('Assigned registered project UUID'),
      filePath: z.string().max(4096).describe('Path relative to the registered project root'),
      content: z
        .string()
        .max(5 * 1024 * 1024)
        .describe('Content to write'),
      mode: z.enum(['overwrite', 'append']).optional().describe('Write mode (default: overwrite)'),
      encoding: z.string().max(4096).optional().describe('File encoding (default: utf8)'),
    },
    writeFile
  );

  tool(
    'delete_file',
    'Delete a file or directory.',
    {
      projectId: z.string().uuid().describe('Assigned registered project UUID'),
      filePath: z.string().max(4096).describe('Path relative to the registered project root'),
      recursive: z.boolean().optional().describe('Recursively delete directory contents (default: false)'),
      confirm: z.literal(true).describe('Must be true to execute'),
    },
    deleteFile
  );

  tool(
    'list_directory',
    'List the contents of a directory.',
    {
      projectId: z.string().uuid().describe('Assigned registered project UUID'),
      dirPath: z.string().max(4096).describe('Directory relative to the registered project root'),
      showHidden: z.boolean().optional().describe('Include hidden files (default: false)'),
      detailed: z.boolean().optional().describe('Include file details like size, permissions (default: true)'),
    },
    listDirectory
  );

  tool(
    'move_file',
    'Move or rename a regular file inside one assigned project.',
    {
      projectId: z.string().uuid().describe('Assigned registered project UUID'),
      sourcePath: z.string().max(4096).describe('Source relative to the registered project root'),
      destPath: z.string().max(4096).describe('Destination relative to the registered project root'),
    },
    moveFile
  );

  tool(
    'copy_file',
    'Copy a regular file inside one assigned project.',
    {
      projectId: z.string().uuid().describe('Assigned registered project UUID'),
      sourcePath: z.string().max(4096).describe('Source relative to the registered project root'),
      destPath: z.string().max(4096).describe('Destination relative to the registered project root'),
    },
    copyFile
  );

  tool(
    'get_file_info',
    'Get detailed metadata about a file including size, permissions, and SHA256 checksum.',
    {
      projectId: z.string().uuid().describe('Assigned registered project UUID'),
      filePath: z.string().max(4096).describe('Path relative to the registered project root'),
    },
    getFileInfo
  );

  tool(
    'search_files',
    'Search for files by name pattern in a directory tree.',
    {
      projectId: z.string().uuid().describe('Assigned registered project UUID'),
      searchPath: z.string().max(4096).describe('Search root relative to the registered project root'),
      pattern: z
        .string()
        .max(128)
        .describe('Filename pattern using letters, numbers, *, ?, dot, underscore, or hyphen'),
      maxResults: z.number().int().positive().optional().describe('Maximum results (default: 50)'),
      fileType: z.enum(['file', 'directory']).optional().describe('Filter by type'),
    },
    searchFiles
  );

  // ── Service Tools (Admin only) ─────────────────────────

  tool(
    'manage_service',
    'Start, stop, restart, enable, or disable a systemd service. Admin only.',
    {
      service: z.string().max(4096).describe('Service name (e.g. nginx, mysql, sshd)'),
      action: z.enum(['start', 'stop', 'restart', 'reload', 'status', 'is-active']).describe('Action to perform'),
      confirm: z.boolean().optional().describe('Must be true for state-changing actions'),
    },
    manageService
  );

  tool(
    'get_service_status',
    'Get detailed status and recent logs for a systemd service. Admin only.',
    {
      service: z.string().max(4096).describe('Service name'),
    },
    getServiceStatus
  );

  tool(
    'list_services',
    'List all systemd services with their status. Admin only.',
    {
      filter: z.string().max(4096).optional().describe('Filter by service name keyword'),
      state: z.string().max(4096).optional().describe('Filter by state: active, inactive, failed, etc.'),
    },
    listServices
  );

  tool(
    'get_journal_logs',
    'Read systemd journal logs. Admin only.',
    {
      service: z.string().max(4096).optional().describe('Service name to filter logs for'),
      lines: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe('Number of log lines to return (default: 50, max: 500)'),
      since: z
        .string()
        .max(4096)
        .optional()
        .describe('Show logs since this time (e.g. "1 hour ago", "2024-01-01 00:00:00")'),
      priority: z.enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']).optional(),
    },
    getJournalLogs
  );

  tool(
    'manage_firewall',
    'Manage UFW firewall rules. Admin only.',
    {
      action: z.enum(['status', 'allow', 'deny', 'delete', 'list', 'confirm']).describe('Firewall action'),
      port: z.number().int().positive().optional().describe('Port number for allow/deny/delete actions'),
      protocol: z.enum(['tcp', 'udp']).optional().describe('Protocol (default: tcp)'),
      rule: z.enum(['allow', 'deny']).optional().describe('Rule type for delete action'),
      rollbackId: z.string().uuid().optional().describe('Timed rollback ID returned by a mutation'),
      confirm: z.boolean().optional().describe('Must be true to execute destructive actions'),
    },
    manageFirewall
  );

  // ── User Management Tools (Admin only) ─────────────────

  tool(
    'list_users',
    'List all system users. Admin only.',
    {
      includeSystem: z.boolean().optional().describe('Include system users (uid < 1000). Default: false'),
    },
    listUsers
  );

  tool(
    'get_user_info',
    'Get detailed info about a user including groups and SSH keys.',
    {
      username: z.string().max(4096).describe('Username to query'),
    },
    getUserInfo
  );

  tool(
    'create_user',
    'Create a new system user. Admin only.',
    {
      username: z.string().max(4096).describe('New username'),
      password: z.string().max(4096).optional().describe('Initial password'),
      groups: z.string().max(4096).optional().describe('Comma-separated supplementary groups'),
      shell: z.string().max(4096).optional().describe('Login shell (default: /bin/bash)'),
      comment: z.string().max(4096).optional().describe('User comment/description'),
      createHome: z.boolean().optional().describe('Create home directory (default: true)'),
      confirm: z.literal(true).describe('Must be true to create a user'),
    },
    createUser
  );

  tool(
    'delete_user',
    'Delete a system user. Admin only.',
    {
      username: z.string().max(4096).describe('Username to delete'),
      removeHome: z.boolean().optional().describe('Remove home directory (default: false)'),
      confirm: z.literal(true).describe('Must be true to execute'),
    },
    deleteUser
  );

  tool(
    'set_user_password',
    'Set or change a user password. Admin only.',
    {
      username: z.string().max(4096).describe('Username'),
      password: z.string().max(4096).describe('New password'),
      confirm: z.literal(true).describe('Must be true to change a password'),
    },
    setUserPassword
  );

  tool(
    'modify_user',
    'Modify user properties: groups, shell, lock/unlock, expiry. Admin only.',
    {
      username: z.string().max(4096).describe('Username to modify'),
      addGroups: z.string().max(4096).optional().describe('Comma-separated groups to add user to'),
      removeGroups: z.string().max(4096).optional().describe('Comma-separated groups to remove user from'),
      shell: z.string().max(4096).optional().describe('New login shell'),
      lockAccount: z.boolean().optional().describe('Lock the user account'),
      unlockAccount: z.boolean().optional().describe('Unlock the user account'),
      expireDate: z.string().max(4096).optional().describe('Account expiry date (YYYY-MM-DD), empty string to disable'),
      confirm: z.literal(true).describe('Must be true to modify a user'),
    },
    modifyUser
  );

  tool(
    'manage_ssh_keys',
    'Add, list, or remove SSH authorized keys for a user.',
    {
      username: z.string().max(4096).describe('Target username'),
      action: z.enum(['add', 'list', 'remove']).describe('Action to perform'),
      publicKey: z.string().max(4096).optional().describe('Full SSH public key string (for add action)'),
      keyIndex: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Key index to remove (for remove action, use list first)'),
      confirm: z.boolean().optional().describe('Must be true to add or remove a key'),
    },
    manageSshKeys
  );

  // ── Docker Sandboxing ────────────────────────────────────

  tool(
    'run_sandboxed_code',
    'Run code in an ephemeral, digest-pinned, rootless OCI sandbox. Networking is denied unless separately enabled and confirmed.',
    {
      language: z.enum(['python', 'node']).describe('Registered language runtime to use'),
      code: z
        .string()
        .max(256 * 1024)
        .describe('Code to execute'),
      allowNetwork: z.boolean().optional().describe('Use the preconfigured egress-filtered network (default: false)'),
      confirm: z.boolean().optional().describe('Must be true when allowNetwork is true'),
      timeout: z.number().int().positive().max(120).optional().describe('Timeout in seconds (default: 30)'),
      files: z
        .record(z.string())
        .optional()
        .describe('Optional key-value map of filename:content to inject into the workspace'),
    },
    runSandboxedCode
  );

  // ── Rollback Tools (Admin only) ──────────────────────────

  tool(
    'apply_config',
    'Apply a registered configuration using its fixed validator, restart its registered service, verify application health, and rollback on failure.',
    {
      configId: z
        .string()
        .regex(/^[a-z][a-z0-9_.-]{1,63}$/)
        .describe('Registered protected configuration ID'),
      newContent: z
        .string()
        .max(5 * 1024 * 1024)
        .describe('New file contents'),
      healthCheckTimeout: z
        .number()
        .int()
        .positive()
        .max(60)
        .optional()
        .describe('Seconds to wait for service health (default: 15)'),
      confirm: z.literal(true).describe('Must be true to execute'),
    },
    applyConfig
  );

  tool(
    'list_config_backups',
    'List protected backups for a registered configuration. Admin only.',
    {
      configId: z
        .string()
        .regex(/^[a-z][a-z0-9_.-]{1,63}$/)
        .describe('Registered configuration ID'),
    },
    listConfigBackups
  );

  tool(
    'restore_config',
    'Restore and health-check a registered configuration backup. Admin only.',
    {
      configId: z
        .string()
        .regex(/^[a-z][a-z0-9_.-]{1,63}$/)
        .describe('Registered configuration ID'),
      timestamp: z
        .string()
        .regex(/^\d{10,16}$/)
        .describe('Timestamp of the backup to restore'),
      confirm: z.literal(true).describe('Must be true to execute'),
    },
    restoreConfig
  );

  // ── Git & DB Tools ───────────────────────────────────────

  tool(
    'git_operation',
    'Execute a fixed Git recipe as the assigned project Unix user.',
    {
      projectId: z.string().uuid().describe('Assigned registered project UUID'),
      action: z
        .enum(['status', 'diff', 'log', 'branch', 'checkout', 'add', 'commit', 'pull', 'push'])
        .describe('Git action'),
      args: z
        .union([
          z.object({}).strict(),
          z.object({ n: z.number().int().min(1).max(100) }).strict(),
          z.object({ files: z.array(z.string().min(1).max(4096)).min(1).max(100) }).strict(),
          z
            .object({
              branch: z.string().min(1).max(255).optional(),
              file: z.string().min(1).max(4096).optional(),
              create: z.boolean().optional(),
            })
            .strict(),
          z
            .object({
              message: z
                .string()
                .min(1)
                .max(2000)
                .regex(/^[^\r\n\0]+$/),
            })
            .strict(),
        ])
        .optional()
        .describe('Strict action-specific arguments; unknown fields are rejected by the broker'),
      confirm: z.boolean().optional().describe('Must be true for state-changing actions'),
    },
    gitOperation
  );

  tool(
    'execute_query',
    'Execute a SQL query against a configured database alias.',
    {
      alias: z.string().max(4096).describe('Configured database alias (e.g. "production")'),
      query: z.string().max(102400).describe('SQL query string with ? placeholders for params'),
      params: z.array(z.any()).optional().describe('Parameters for the query placeholders'),
      confirm: z.boolean().optional().describe('Must be true for write queries'),
    },
    executeQuery
  );

  // ── Pub/Sub Alert Tools ──────────────────────────────────

  tool(
    'list_guided_workflows',
    'List safe, plain-language workflows for server care and developer work.',
    {},
    async () => {
      return { workflows: getWorkflowCatalog() };
    }
  );

  tool(
    'get_security_posture',
    'Review the server security posture in plain language. This read-only tool reports TLS, access controls, approvals, and policy configuration.',
    {},
    async (_, toolIdentity) => {
      if (toolIdentity.role !== 'admin' && toolIdentity.role !== 'auditor')
        throw new Error('Security posture requires an administrator or auditor role');
      return buildSecurityPosture();
    }
  );

  tool(
    'request_change_approval',
    'Submit a proposed MCP action for administrator approval. After approval, resubmit the exact original action once.',
    {
      tool: z.string().max(128).describe('The MCP tool that will be run after approval'),
      arguments: z.record(z.any()).describe('The exact arguments that will be used when the action is resubmitted'),
      summary: z.string().max(500).optional().describe('Plain-language explanation of the requested change'),
      risk: z.enum(['medium', 'high', 'critical']).optional().describe('Impact level for the reviewer'),
    },
    async ({ tool: requestedTool, arguments: requestedArgs, summary, risk }, toolIdentity) => {
      if (requestedTool === 'request_change_approval' || requestedTool === 'list_guided_workflows') {
        throw new Error('Approval requests must target an operational tool');
      }
      const { approval, created } = await requestApproval({
        tool: requestedTool,
        args: requestedArgs,
        identity: toolIdentity,
        summary,
        risk: risk || 'high',
      });
      return {
        approvalId: approval.id,
        status: approval.status,
        message: created
          ? 'Approval requested. Do not execute the change until it is approved.'
          : 'An identical approval request is already pending.',
      };
    }
  );

  tool(
    'list_projects',
    'List the software projects this identity is allowed to inspect and deploy.',
    {},
    async (_, toolIdentity) => {
      return { projects: await listProjects(toolIdentity) };
    }
  );

  tool(
    'plan_project_deployment',
    'Create a safe, plain-language deployment plan for a registered project. This tool never deploys anything.',
    {
      projectId: z.string().uuid().describe('Registered project identifier'),
    },
    async ({ projectId }, toolIdentity) => {
      const project = await getProject(projectId, toolIdentity);
      return getDeploymentPlan(project);
    }
  );

  tool(
    'deploy_project',
    'Deploy a registered project using a controlled Git fast-forward pull, a registered systemd service restart, and an optional health check. Administrator approval is required.',
    {
      projectId: z.string().uuid().describe('Registered project identifier'),
      confirm: z.literal(true).describe('Must be true to deploy'),
    },
    async ({ projectId }, toolIdentity) => {
      if (toolIdentity.role !== 'admin') throw new Error('Deploying a project requires an administrator role');
      const project = await getProject(projectId, toolIdentity);
      if (!project.serviceName)
        throw new Error(
          'This project has no registered systemd service, so it cannot use the managed deployment playbook'
        );
      await assertRepositoryPermitted(project.repoPath, toolIdentity);
      const git = await gitOperation({ projectId: project.id, action: 'pull', args: {} }, toolIdentity);
      const service = await manageService({ service: project.serviceName, action: 'restart' }, toolIdentity);
      let health = { status: 'not-configured' };
      if (project.healthUrl) {
        const healthUrl = assertProjectHealthUrlAllowed(project);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch(healthUrl, { redirect: 'error', signal: controller.signal });
          health = { status: response.ok ? 'healthy' : 'unhealthy', httpStatus: response.status };
        } catch (err) {
          health = { status: 'unreachable', message: err.name === 'AbortError' ? 'Timed out' : 'Connection failed' };
        } finally {
          clearTimeout(timer);
        }
      }
      return {
        projectId: project.id,
        project: project.name,
        git,
        service,
        health,
        rollback: 'Use the project’s previous Git revision and restart its registered service if verification fails.',
      };
    }
  );

  tool(
    'subscribe_to_alert',
    'Subscribe this exact MCP session to a structured MCP Sentinel alert notification.',
    {
      alertType: z.enum(['cpu_threshold', 'memory_threshold', 'disk_threshold']).describe('Type of alert'),
      threshold: z.number().positive().max(100).describe('Threshold percentage (e.g. 90 for 90%)'),
      cooldownSeconds: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Minimum seconds between repeated alerts (default: 300)'),
      persistent: z.boolean().optional().describe('Restore this subscription for later sessions of the same identity'),
    },
    async ({ alertType, threshold, cooldownSeconds, persistent }, identity) => {
      if (!identity.sessionId || !activeTransports.has(identity.sessionId)) throw new Error('Exact session not found');
      const id = monitor.subscribe(
        identity.sessionId,
        alertOwnerKey(identity),
        alertType,
        threshold,
        cooldownSeconds,
        persistent === true
      );
      return { id, alertType, threshold, persistent: persistent === true };
    }
  );

  tool(
    'unsubscribe_from_alert',
    'Unsubscribe from an active alert by ID.',
    {
      alertId: z.string().max(4096).describe('Alert ID returned from subscribe_to_alert'),
    },
    async ({ alertId }, identity) => {
      if (!identity.sessionId || !activeTransports.has(identity.sessionId)) throw new Error('Exact session not found');
      monitor.unsubscribe(identity.sessionId, alertOwnerKey(identity), alertId);
      return { alertId, unsubscribed: true };
    }
  );

  tool('list_active_alerts', 'List alert subscriptions for this exact MCP session.', {}, async (_, identity) => {
    return { alerts: monitor.getActiveAlerts(identity.sessionId) };
  });

  // Disabled packs are absent from tools/list, so an AI cannot casually discover
  // or invoke specialist operations.
  for (const { name, registration } of registrations) {
    const availability = await toolAvailability(name);
    const policyDecision = await evaluatePolicy({ tool: name, identity }).catch(() => ({ allowed: false }));
    if (!availability.available || !policyDecision.allowed) registration.disable();
  }
  const visibleTools = [];
  for (const item of registrations) {
    const availability = await toolAvailability(item.name);
    const policyDecision = await evaluatePolicy({ tool: item.name, identity }).catch(() => ({ allowed: false }));
    if (availability.available && policyDecision.allowed) visibleTools.push(item.definition);
  }
  const manifestBody = JSON.stringify(visibleTools);
  manifestSnapshots.set(manifestIdentityKey(identity), {
    version: 2,
    hash: createHash('sha256').update(manifestBody).digest('hex'),
    generatedAt: new Date().toISOString(),
    authorizationVersion: identity.authorizationVersion || identity.keyVersion || null,
    tools: visibleTools,
  });
  server._sentinelRegistrations = registrations;
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

  return https.createServer(
    {
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
    },
    app
  );
}

// ── Start Server ───────────────────────────────────────────

function validateConfig() {
  if (!jwtSecretIsConfigured()) {
    console.error('FATAL: JWT signing credential must be at least 64 characters and not a placeholder.');
    process.exit(1);
  }
  const adminKey = process.env.ADMIN_API_KEY || '';
  const hasStoredAdmin = listApiKeys().some(key => key.active !== false && key.role === 'admin');
  if ((!adminKey || adminKey.includes('CHANGE_ME')) && !hasStoredAdmin) {
    console.error('FATAL: configure an ADMIN_API_KEY bootstrap credential or retain an active stored admin key.');
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
  if (process.env.NODE_ENV === 'production' && !(process.env.ALLOWED_ORIGINS || '').trim()) {
    console.error('FATAL: ALLOWED_ORIGINS must list explicit dashboard origins in production.');
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

    const currentVersion =
      process.env.npm_package_version ||
      JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;

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
    try {
      session.transport.close?.();
    } catch {}
    activeTransports.delete(id);
  }
  if (server) {
    server.close(() => {
      console.log('Server closed. Flushing logs...');
      import('./audit.js')
        .then(({ shutdownLoggers }) => {
          shutdownLoggers(() => {
            console.log('Goodbye.');
            process.exit(0);
          });
        })
        .catch(() => process.exit(0));
    });
  } else {
    process.exit(0);
  }
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', err => {
  logError({ tool: 'UNCAUGHT_EXCEPTION', error: err });
  console.error('Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  logError({ tool: 'UNHANDLED_REJECTION', error: new Error(String(reason)) });
});
