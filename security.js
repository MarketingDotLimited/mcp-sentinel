import jwt from 'jsonwebtoken';
import { logAuth, logSecurityEvent } from './audit.js';
import { isIP } from 'net';
import ipaddr from 'ipaddr.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  loadKeystore,
  addKeyEntry,
  revokeKeyEntry,
  revokeKeyEntryById,
  getKeyEntry,
  getKeys,
  getKeyById,
  updateKeyEntry,
} from './keystore.js';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { readOAuthMappings } from './lib/oauth-mappings-store.js';
import { DatabaseSync } from 'node:sqlite';
import { loadCredentialSecret } from './lib/credentials.js';
import { validateOAuthTokenPolicy } from './lib/oauth-token-policy.js';

const execFileAsync = promisify(execFile);
const JWT_SECRET = loadCredentialSecret('JWT_SECRET', 'jwt-key');

export function jwtSecretIsConfigured() {
  return JWT_SECRET.length >= 64 && !JWT_SECRET.includes('CHANGE_ME');
}

// Load keystore
await loadKeystore();

// Initialize from environment
if (process.env.ADMIN_API_KEY) {
  const existing = getKeyEntry(process.env.ADMIN_API_KEY);
  if (!existing) {
    await addKeyEntry(process.env.ADMIN_API_KEY, {
      userId: 'admin',
      role: 'admin',
      allowedIPs: [],
      scopes: ['*'],
      active: true,
      label: 'Master Admin Key',
    });
  }
}

const JWT_REVOCATION_FILE = process.env.JWT_REVOCATION_FILE || '/var/lib/mcp-sentinel/jwt-revocations.json';
const SECURITY_STATE_DB = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
const USE_LEGACY_REVOCATIONS = Boolean(
  !process.env.MCP_STATE_DB &&
  (process.env.JWT_REVOCATION_FILE || process.env.KEYSTORE_FILE || process.env.CONTROL_PLANE_STATE_FILE)
);
const JWT_DENYLIST = new Map();
let revocationDatabase;
if (USE_LEGACY_REVOCATIONS) {
  try {
    const saved = JSON.parse(fs.readFileSync(JWT_REVOCATION_FILE, 'utf8'));
    for (const item of saved.revocations || []) {
      if (typeof item.jti === 'string' && Number(item.expiresAt) > Date.now())
        JWT_DENYLIST.set(item.jti, item.expiresAt);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Invalid JWT revocation state: ${error.message}`);
  }
} else {
  fs.mkdirSync(path.dirname(SECURITY_STATE_DB), { recursive: true, mode: 0o700 });
  revocationDatabase = new DatabaseSync(SECURITY_STATE_DB);
  revocationDatabase.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  revocationDatabase.exec(`CREATE TABLE IF NOT EXISTS jwt_revocations (
    jti TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    revoked_at TEXT NOT NULL
  ) STRICT;`);
  revocationDatabase.prepare('DELETE FROM jwt_revocations WHERE expires_at <= ?').run(Date.now());
  for (const row of revocationDatabase.prepare('SELECT jti, expires_at FROM jwt_revocations').all())
    JWT_DENYLIST.set(row.jti, row.expires_at);
  fs.chmodSync(SECURITY_STATE_DB, 0o600);
}

function persistJwtRevocations() {
  const now = Date.now();
  for (const [jti, expiresAt] of JWT_DENYLIST) if (expiresAt <= now) JWT_DENYLIST.delete(jti);
  if (!USE_LEGACY_REVOCATIONS) {
    const insert = revocationDatabase.prepare(
      'INSERT OR REPLACE INTO jwt_revocations(jti, expires_at, revoked_at) VALUES (?, ?, ?)'
    );
    revocationDatabase.exec('BEGIN IMMEDIATE');
    try {
      revocationDatabase.prepare('DELETE FROM jwt_revocations WHERE expires_at <= ?').run(now);
      for (const [jti, expiresAt] of JWT_DENYLIST) insert.run(jti, expiresAt, new Date().toISOString());
      revocationDatabase.exec('COMMIT');
    } catch (error) {
      revocationDatabase.exec('ROLLBACK');
      throw error;
    }
    return;
  }
  fs.mkdirSync(path.dirname(JWT_REVOCATION_FILE), { recursive: true, mode: 0o700 });
  const temporary = `${JWT_REVOCATION_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporary,
    JSON.stringify({ version: 1, revocations: [...JWT_DENYLIST].map(([jti, expiresAt]) => ({ jti, expiresAt })) }),
    { mode: 0o600 }
  );
  fs.renameSync(temporary, JWT_REVOCATION_FILE);
}

export const ROLE_TEMPLATES = {
  viewer: {
    label: 'Viewer',
    description: 'Read server health and approved project information without making changes.',
    scopes: [
      'get_system_info',
      'get_processes',
      'get_service_status',
      'list_services',
      'get_journal_logs',
      'list_directory',
      'read_file',
      'get_file_info',
      'search_files',
      'list_guided_workflows',
      'list_projects',
      'plan_project_deployment',
      'security.*',
    ],
    requireApproval: true,
  },
  auditor: {
    label: 'Auditor',
    description: 'Read-only access for security, operations, and compliance review.',
    scopes: [
      'get_system_info',
      'get_processes',
      'get_service_status',
      'list_services',
      'get_journal_logs',
      'list_directory',
      'read_file',
      'get_file_info',
      'search_files',
      'list_guided_workflows',
      'list_projects',
      'plan_project_deployment',
    ],
    requireApproval: true,
  },
  developer: {
    label: 'Developer',
    description: 'Build, test, inspect repositories, and propose deployments. Risky actions require approval.',
    scopes: ['system.*', 'files.*', 'docker.*', 'git.*', 'db.*', 'projects.*', 'workflows.*', 'monitor.*'],
    requireApproval: true,
  },
  operator: {
    label: 'Operator',
    description: 'Operate approved services and configurations with human approval for changes.',
    scopes: ['system.*', 'services.*', 'files.*', 'config.*', 'monitor.*', 'workflows.*', 'projects.*'],
    requireApproval: true,
  },
  user: {
    label: 'User',
    description:
      'Read server information and files within the user’s normal sandbox. Select custom scopes to grant more.',
    scopes: [
      'get_system_info',
      'get_processes',
      'list_directory',
      'read_file',
      'get_file_info',
      'search_files',
      'list_guided_workflows',
      'list_projects',
      'plan_project_deployment',
    ],
    requireApproval: true,
  },
  admin: {
    label: 'Administrator',
    description: 'Full server control. Use only for trusted owners and emergency operations.',
    scopes: ['*'],
    requireApproval: false,
  },
};

// ── IP Whitelist ───────────────────────────────────────────

/**
 * Parse CIDR or plain IP and check membership using ipaddr.js.
 */
function ipInCidr(ip, cidr) {
  try {
    const parsedIP = ipaddr.process(ip);

    if (!cidr.includes('/')) {
      return parsedIP.toString() === ipaddr.process(cidr).toString();
    }

    const [rangeIpStr, bitsStr] = cidr.split('/');
    const rangeIp = ipaddr.process(rangeIpStr);
    const bits = parseInt(bitsStr, 10);

    if (parsedIP.kind() !== rangeIp.kind()) return false;

    return parsedIP.match(rangeIp, bits);
  } catch (err) {
    return false; // invalid IP or CIDR
  }
}

function getClientIP(req) {
  const directIp = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-for']) {
    const trustedProxies = (process.env.TRUSTED_PROXIES || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const isTrusted = trustedProxies.length > 0 && trustedProxies.some(p => ipInCidr(directIp, p));
    if (isTrusted) {
      return req.headers['x-forwarded-for']
        .split(',')[0]
        .trim()
        .replace(/^::ffff:/, '');
    }
  }
  return directIp;
}

function isIPAllowed(ip, keyEntry) {
  // Key-level IP restriction takes priority
  if (keyEntry?.allowedIPs?.length > 0) {
    return keyEntry.allowedIPs.some(cidr => ipInCidr(ip, cidr));
  }

  // Global whitelist from env
  const globalList = (process.env.ALLOWED_IPS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (globalList.length === 0) return true; // No restriction
  return globalList.some(cidr => ipInCidr(ip, cidr));
}

// ── Middleware: IP Whitelist ───────────────────────────────

export function ipWhitelist(req, res, next) {
  const ip = getClientIP(req);
  req.clientIP = ip;

  // Skip for /health endpoint
  if (req.path === '/health') return next();

  // We'll do full IP check after API key is verified (in authenticate)
  next();
}

// ── Middleware: Authenticate ───────────────────────────────

export function authenticate(req, res, next) {
  const ip = req.clientIP || getClientIP(req);

  // 1. Check API Key header
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');

  if (!apiKey) {
    logAuth({ ip, event: 'AUTH_MISSING_KEY', reason: 'No API key provided' });
    return sendUnauthorized(req, res, 'Missing API key');
  }

  const keyEntry = getKeyEntry(apiKey);

  if (!keyEntry || !keyEntry.active) {
    logSecurityEvent({ ip, event: 'INVALID_API_KEY', detail: { key: apiKey.slice(0, 8) + '...' } });
    logAuth({ ip, apiKey, event: 'AUTH_FAILED', reason: 'Invalid or inactive API key' });
    return res.status(403).json({ error: 'Invalid API key' });
  }

  // 2. IP check (with key-level restrictions)
  if (!isIPAllowed(ip, keyEntry)) {
    logSecurityEvent({ ip, event: 'IP_BLOCKED', detail: { userId: keyEntry.userId } });
    logAuth({ ip, apiKey, userId: keyEntry.userId, event: 'AUTH_IP_BLOCKED', reason: 'IP not whitelisted' });
    return res.status(403).json({ error: 'IP address not permitted' });
  }

  // 3. Attach identity to request
  req.identity = {
    userId: keyEntry.userId,
    role: keyEntry.role,
    scopes: keyEntry.scopes,
    keyVersion: keyEntry.version,
    keyId: keyEntry.keyId,
    authType: 'apiKey',
    requireApproval: keyEntry.requireApproval === true,
    projectIds: Array.isArray(keyEntry.projectIds) ? keyEntry.projectIds : undefined,
    organizationId: keyEntry.organizationId || undefined,
    teamId: keyEntry.teamId || undefined,
  };

  logAuth({ ip, apiKey, userId: keyEntry.userId, event: 'AUTH_SUCCESS' });
  next();
}

// Remote MCP clients learn the OAuth authorization server from the challenge
// returned by the protected resource. Without this header ChatGPT can reach
// /mcp but cannot populate its OAuth endpoint fields during connector setup.
function sendUnauthorized(req, res, error) {
  if (req.path === '/mcp' || req.path === '/mcp/message') {
    const publicUrl = (
      process.env.OAUTH_RESOURCE_URL ||
      process.env.PUBLIC_URL ||
      `${req.protocol}://${req.get('host')}`
    ).replace(/\/$/, '');
    res.set('WWW-Authenticate', `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`);
  }
  return res.status(401).json({ error });
}

// ── JWT Token Endpoints ────────────────────────────────────

/**
 * POST /auth/token
 * Exchange API key for a short-lived JWT session token
 */
export function issueToken(req, res) {
  const ip = req.clientIP;

  if (!req.identity) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const payload = {
    sub: req.identity.userId,
    role: req.identity.role,
    scopes: req.identity.scopes,
    ip, // Record the issuing IP for anomaly detection.
    keyVersion: req.identity.keyVersion,
    keyId: req.identity.keyId,
    requireApproval: req.identity.requireApproval === true,
    projectIds: req.identity.projectIds,
    organizationId: req.identity.organizationId,
    teamId: req.identity.teamId,
    jti: randomUUID(),
  };

  let expiresIn = process.env.JWT_EXPIRY || '8h';
  const match = expiresIn.match(/^(\d+)([hmd])$/);
  if (match) {
    let val = parseInt(match[1]);
    let unit = match[2];
    let hours = unit === 'd' ? val * 24 : unit === 'm' ? val / 60 : val;
    if (hours > 24) expiresIn = '24h';
  } else {
    expiresIn = '8h';
  }

  const token = jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn,
    issuer: 'mcp-server',
    audience: 'mcp-client',
  });

  logAuth({ ip, userId: req.identity.userId, event: 'TOKEN_ISSUED' });

  return res.json({
    token,
    expires_in: expiresIn,
    token_type: 'Bearer',
  });
}

/**
 * Middleware: Validate JWT token (dual-auth: internal HS256 + Authelia RS256)
 */

// ── JWKS Cache for Authelia tokens ─────────────────────────
let _jwksCache = null;
let _jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour
const AUTHELIA_ISSUER = process.env.AUTHELIA_ISSUER || '';
const AUTHELIA_JWKS_URL = process.env.AUTHELIA_JWKS_URL || '';

async function getAutheliaJWKS(forceRefresh = false) {
  if (!AUTHELIA_JWKS_URL) return null;
  if (_jwksCache && !forceRefresh && Date.now() - _jwksCacheTime < JWKS_CACHE_TTL) {
    return _jwksCache;
  }
  try {
    const { createRemoteJWKSet } = await import('jose');
    _jwksCache = createRemoteJWKSet(new URL(AUTHELIA_JWKS_URL), {
      cooldownDuration: 30000,
      cacheMaxAge: JWKS_CACHE_TTL,
    });
    _jwksCacheTime = Date.now();
    return _jwksCache;
  } catch (err) {
    console.error('Failed to fetch Authelia JWKS:', err.message);
    return null;
  }
}

async function loadUserMappings() {
  try {
    return await readOAuthMappings();
  } catch {
    return {};
  }
}

export function authenticateJWT(req, res, next) {
  const ip = req.clientIP || getClientIP(req);
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    return authenticate(req, res, next); // Fallback to API key auth
  }

  const token = authHeader.slice(7);

  // Some remote MCP clients (including CLI clients that only expose a bearer
  // token setting) cannot send arbitrary headers. Treat a Sentinel API key in
  // that bearer slot exactly like the existing X-API-Key form. This is not a
  // JWT fallback for arbitrary bearer strings and preserves OIDC processing.
  if (token.startsWith('mcp_')) {
    return authenticate(req, res, next);
  }

  // ── Try 1: Internal Sentinel HS256 Token ──────────────
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'mcp-server',
      audience: 'mcp-client',
      algorithms: ['HS256'],
    });

    if (JWT_DENYLIST.has(decoded.jti)) {
      logSecurityEvent({ ip, event: 'TOKEN_DENYLISTED', detail: { jti: decoded.jti } });
      return sendUnauthorized(req, res, 'Token revoked');
    }

    const keyEntry = getKeyById(decoded.keyId);
    if (!keyEntry || !keyEntry.active || keyEntry.version !== decoded.keyVersion) {
      logSecurityEvent({ ip, event: 'TOKEN_KEY_REVOKED', detail: { keyId: decoded.keyId } });
      return sendUnauthorized(req, res, 'Token invalidated (key revoked or changed)');
    }

    // Detect IP changes without rejecting sessions behind rotating trusted proxies.
    if (decoded.ip && decoded.ip !== ip) {
      logSecurityEvent({ ip, event: 'TOKEN_IP_MISMATCH', detail: { tokenIP: decoded.ip, currentIP: ip } });
      // We don't block here anymore because Cloudflare can change the client IP mid-session
    }

    req.identity = {
      userId: decoded.sub,
      role: decoded.role,
      scopes: decoded.scopes,
      keyId: decoded.keyId,
      keyVersion: decoded.keyVersion,
      authType: 'apiKey',
      requireApproval: decoded.requireApproval === true,
      projectIds: Array.isArray(decoded.projectIds) ? decoded.projectIds : undefined,
      organizationId: decoded.organizationId || undefined,
      teamId: decoded.teamId || undefined,
      jti: decoded.jti,
      tokenExpiresAt: decoded.exp ? decoded.exp * 1000 : Date.now(),
    };

    return next();
  } catch (internalErr) {
    // Internal token failed — try Authelia token
  }

  // ── Try 2: Authelia RS256 OIDC Token ──────────────────
  if (!AUTHELIA_ISSUER || !AUTHELIA_JWKS_URL) {
    logSecurityEvent({ ip, event: 'INVALID_BEARER_TOKEN', detail: {} });
    return sendUnauthorized(req, res, 'Invalid or expired token');
  }
  (async () => {
    try {
      const { jwtVerify } = await import('jose');
      const jwks = await getAutheliaJWKS();
      if (!jwks) {
        logSecurityEvent({ ip, event: 'OAUTH_JWKS_UNAVAILABLE', detail: {} });
        return sendUnauthorized(req, res, 'OAuth verification unavailable');
      }

      let result;
      try {
        result = await jwtVerify(token, jwks, {
          issuer: AUTHELIA_ISSUER,
          audience: (process.env.OAUTH_RESOURCE_URL || process.env.PUBLIC_URL || '').replace(/\/$/, ''),
          algorithms: ['RS256'],
          requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
        });
      } catch (verifyErr) {
        // Force refresh JWKS and retry once (handles key rotation)
        const refreshedJwks = await getAutheliaJWKS(true);
        if (!refreshedJwks) {
          throw verifyErr;
        }
        result = await jwtVerify(token, refreshedJwks, {
          issuer: AUTHELIA_ISSUER,
          audience: (process.env.OAUTH_RESOURCE_URL || process.env.PUBLIC_URL || '').replace(/\/$/, ''),
          algorithms: ['RS256'],
          requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat'],
        });
      }

      const payload = result.payload;
      const configuredResource = (process.env.OAUTH_RESOURCE_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
      if (!configuredResource) throw new Error('OAUTH_RESOURCE_URL must be configured for OAuth');
      const { clientId } = validateOAuthTokenPolicy({
        payload,
        protectedHeader: result.protectedHeader,
        issuer: AUTHELIA_ISSUER,
        resource: configuredResource,
        acceptedTypes: process.env.OAUTH_ACCESS_TOKEN_TYPES,
      });

      // Authelia access tokens use an opaque stable subject and do not always
      // embed profile claims. Resolve the username from the OIDC userinfo
      // endpoint when necessary, and bind the response to the token subject.
      let oauthUsername = payload.preferred_username || payload.email || '';
      if (!oauthUsername) {
        const userinfoResponse = await fetch(`${AUTHELIA_ISSUER.replace(/\/$/, '')}/api/oidc/userinfo`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!userinfoResponse.ok) throw new Error(`OIDC userinfo request failed (${userinfoResponse.status})`);
        const userinfo = await userinfoResponse.json();
        if (!userinfo.sub || userinfo.sub !== payload.sub) throw new Error('OIDC userinfo subject mismatch');
        oauthUsername = userinfo.preferred_username || userinfo.email || '';
      }
      if (!oauthUsername) throw new Error('OAuth token does not identify a mapped username');

      // Look up user mapping
      const mappings = await loadUserMappings();

      const userMapping = mappings[oauthUsername];
      if (!userMapping) {
        throw new Error(`No mapping found for OAuth user: ${oauthUsername}`);
      }

      const clientMapping = userMapping.clients?.[clientId];
      if (!clientMapping) throw new Error(`User not authorized for client: ${clientId}`);
      const mappedUser = clientMapping.linuxUser || userMapping.linuxUser;
      const mappedScopes = clientMapping.scopes || userMapping.scopes || [];
      const mappedRole = clientMapping.role || userMapping.role;
      if (!mappedUser || !mappedRole || !Array.isArray(mappedScopes) || !mappedScopes.length)
        throw new Error('OAuth mapping is incomplete');
      if (mappedUser === 'root') throw new Error('OAuth identities cannot map directly to root');
      if (!['viewer', 'auditor', 'developer', 'operator', 'user', 'admin'].includes(mappedRole))
        throw new Error('OAuth mapping contains an invalid role');

      req.identity = {
        userId: mappedUser,
        role: mappedRole,
        scopes: mappedScopes,
        requireApproval:
          clientMapping.requireApproval === undefined
            ? userMapping.requireApproval !== false
            : clientMapping.requireApproval === true,
        projectIds: clientMapping.projectIds || userMapping.projectIds,
        organizationId: clientMapping.organizationId || userMapping.organizationId,
        teamId: clientMapping.teamId || userMapping.teamId,
        authorizationVersion: clientMapping.authorizationVersion || userMapping.authorizationVersion || 1,
        oauthIssuer: payload.iss,
        oauthSubject: payload.sub,
        oauthUser: oauthUsername,
        oauthClient: clientId,
        oauthProvider: 'authelia',
        authType: 'oauth',
      };

      logAuth({ ip, userId: mappedUser, event: 'OAUTH_TOKEN_VALIDATED', reason: `OAuth user: ${oauthUsername}` });
      return next();
    } catch (oauthErr) {
      logSecurityEvent({ ip, event: 'OAUTH_TOKEN_REJECTED', detail: { error: oauthErr.message } });
      return sendUnauthorized(req, res, 'Invalid or expired token');
    }
  })();
}

export function revokeSessionToken(req, res) {
  if (req.identity?.authType !== 'apiKey' || !req.identity.jti)
    return res.status(400).json({ error: 'Only Sentinel session tokens can be revoked here' });
  JWT_DENYLIST.set(req.identity.jti, req.identity.tokenExpiresAt || Date.now() + 24 * 60 * 60 * 1000);
  persistJwtRevocations();
  logSecurityEvent({ ip: req.clientIP, event: 'TOKEN_REVOKED', detail: { jti: req.identity.jti } });
  return res.json({ success: true });
}

// ── Authorization: Scope Check ─────────────────────────────

export function requireScope(toolName) {
  return (req, res, next) => {
    const scopes = req.identity?.scopes || [];
    if (scopeAllows(scopes, toolName)) {
      return next();
    }
    logSecurityEvent({
      ip: req.clientIP,
      event: 'SCOPE_DENIED',
      detail: { userId: req.identity?.userId, tool: toolName },
    });
    return res.status(403).json({ error: `Access to tool '${toolName}' is not permitted` });
  };
}

// ── API Key Management ─────────────────────────────────────

export async function addApiKey(key, options) {
  if (!key || key.length < 32) throw new Error('Key must be at least 32 characters');
  if (!['admin', 'developer', 'operator', 'viewer', 'auditor', 'user'].includes(options.role))
    throw new Error('Invalid role');
  const template = ROLE_TEMPLATES[options.role];

  if (options.userId !== 'admin') {
    try {
      await execFileAsync('id', [options.userId]);
    } catch (err) {
      throw new Error(`Invalid user: Unix account '${options.userId}' does not exist on this system.`);
    }
  }

  await addKeyEntry(key, {
    userId: options.userId,
    role: options.role || 'user',
    allowedIPs: options.allowedIPs || [],
    scopes: Array.isArray(options.scopes) && options.scopes.length ? options.scopes : template.scopes,
    label: options.label || '',
    requireApproval:
      options.requireApproval === undefined ? template.requireApproval : options.requireApproval === true,
    projectIds: Array.isArray(options.projectIds) ? options.projectIds : undefined,
    organizationId: options.organizationId || undefined,
    teamId: options.teamId || undefined,
    active: true,
  });
  logSecurityEvent({ ip: 'internal', event: 'API_KEY_CREATED', detail: { userId: options.userId } });
}

export async function revokeApiKey(key) {
  const success = await revokeKeyEntry(key);
  if (success) {
    logSecurityEvent({ ip: 'internal', event: 'API_KEY_REVOKED', detail: {} });
  }
  return success;
}

export async function revokeApiKeyById(keyId) {
  const success = await revokeKeyEntryById(keyId);
  if (success) logSecurityEvent({ ip: 'internal', event: 'API_KEY_REVOKED', detail: { keyId } });
  return success;
}

export async function updateApiKey(keyId, updates) {
  const entry = await updateKeyEntry(keyId, updates);
  logSecurityEvent({ ip: 'internal', event: 'API_KEY_UPDATED', detail: { keyId, updates } });
  return entry;
}

export function listApiKeys() {
  return getKeys();
}

export function getRoleTemplates() {
  return Object.entries(ROLE_TEMPLATES).map(([id, template]) => ({ id, ...template }));
}

export { getClientIP };

export const SCOPE_GROUPS = {
  'system.*': { label: 'System', tools: ['get_system_info', 'get_processes', 'kill_process'] },
  'files.*': {
    label: 'Files',
    tools: [
      'read_file',
      'write_file',
      'delete_file',
      'list_directory',
      'move_file',
      'copy_file',
      'get_file_info',
      'search_files',
    ],
  },
  'services.*': {
    label: 'Services',
    tools: ['manage_service', 'get_service_status', 'list_services', 'get_journal_logs', 'manage_firewall'],
  },
  'users.*': {
    label: 'Users',
    tools: [
      'list_users',
      'get_user_info',
      'create_user',
      'delete_user',
      'set_user_password',
      'modify_user',
      'manage_ssh_keys',
    ],
  },
  'docker.*': { label: 'Docker', tools: ['run_sandboxed_code'] },
  'git.*': { label: 'Git', tools: ['git_operation'] },
  'db.*': { label: 'Database', tools: ['execute_query'] },
  'config.*': { label: 'Config', tools: ['apply_config', 'list_config_backups', 'restore_config'] },
  'monitor.*': { label: 'Monitor', tools: ['subscribe_to_alert', 'unsubscribe_from_alert', 'list_active_alerts'] },
  'workflows.*': { label: 'Workflows', tools: ['list_guided_workflows', 'request_change_approval'] },
  'projects.*': {
    label: 'Projects',
    tools: [
      'list_projects',
      'plan_project_deployment',
      'deploy_project',
      'run_project_tests',
      'get_project_test_run',
      'cancel_project_test_run',
      'get_my_ssh_access',
      'set_my_ssh_access',
    ],
  },
  'ssh.*': {
    label: 'SSH Transport',
    tools: ['get_my_ssh_access', 'set_my_ssh_access', 'list_ssh_access_policies', 'admin_set_ssh_access'],
  },
  'security.*': { label: 'Security', tools: ['get_security_posture'] },
};

export function scopeAllows(scopes, toolName) {
  return (
    scopes.includes('*') ||
    scopes.includes(toolName) ||
    Object.entries(SCOPE_GROUPS).some(
      ([scope, groupData]) => scopes.includes(scope) && groupData.tools.includes(toolName)
    )
  );
}
