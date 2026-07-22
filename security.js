import jwt from 'jsonwebtoken';
import { logAuth, logSecurityEvent } from './audit.js';
import { isIP } from 'net';
import ipaddr from 'ipaddr.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { loadKeystore, addKeyEntry, revokeKeyEntry, getKeyEntry, getKeys, getKeyById } from './keystore.js';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

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

const JWT_DENYLIST = new Set();

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
    const trustedProxies = (process.env.TRUSTED_PROXIES || '').split(',').map(s => s.trim()).filter(Boolean);
    const isTrusted = trustedProxies.length === 0 || trustedProxies.some(p => ipInCidr(directIp, p));
    if (isTrusted) {
      return req.headers['x-forwarded-for'].split(',')[0].trim().replace(/^::ffff:/, '');
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
  const apiKey =
    req.headers['x-api-key'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '');

  if (!apiKey) {
    logAuth({ ip, event: 'AUTH_MISSING_KEY', reason: 'No API key provided' });
    return res.status(401).json({ error: 'Missing API key' });
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
  };

  logAuth({ ip, apiKey, userId: keyEntry.userId, event: 'AUTH_SUCCESS' });
  next();
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
    ip, // Bind token to issuing IP
    keyVersion: req.identity.keyVersion,
    keyId: req.identity.keyId,
    jti: randomUUID(),
  };

  let expiresIn = process.env.JWT_EXPIRY || '8h';
  const match = expiresIn.match(/^(\\d+)([hmd])$/);
  if (match) {
    let val = parseInt(match[1]);
    let unit = match[2];
    let hours = unit === 'd' ? val * 24 : unit === 'm' ? val / 60 : val;
    if (hours > 24) expiresIn = '24h';
  } else {
    expiresIn = '8h';
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
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
 * Middleware: Validate JWT token (alternative to API key for SSE sessions)
 */
export function authenticateJWT(req, res, next) {
  const ip = req.clientIP || getClientIP(req);
  const authHeader = req.headers['authorization'];

  if (!authHeader?.startsWith('Bearer ')) {
    return authenticate(req, res, next); // Fallback to API key auth
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'mcp-server',
      audience: 'mcp-client',
      algorithms: ['HS256'],
    });

    if (JWT_DENYLIST.has(decoded.jti)) {
      logSecurityEvent({ ip, event: 'TOKEN_DENYLISTED', detail: { jti: decoded.jti } });
      return res.status(401).json({ error: 'Token revoked' });
    }

    const keyEntry = getKeyById(decoded.keyId);
    if (!keyEntry || !keyEntry.active || keyEntry.version !== decoded.keyVersion) {
      logSecurityEvent({ ip, event: 'TOKEN_KEY_REVOKED', detail: { keyId: decoded.keyId } });
      return res.status(401).json({ error: 'Token invalidated (key revoked or changed)' });
    }

    // Optional: enforce IP binding
    if (decoded.ip && decoded.ip !== ip) {
      logSecurityEvent({ ip, event: 'TOKEN_IP_MISMATCH', detail: { tokenIP: decoded.ip } });
      return res.status(403).json({ error: 'Token not valid for this IP' });
    }

    req.identity = {
      userId: decoded.sub,
      role: decoded.role,
      scopes: decoded.scopes,
    };

    next();
  } catch (err) {
    logSecurityEvent({ ip, event: 'INVALID_JWT', detail: { error: err.message } });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Authorization: Scope Check ─────────────────────────────

export function requireScope(toolName) {
  return (req, res, next) => {
    const scopes = req.identity?.scopes || [];
    if (scopes.includes('*') || scopes.includes(toolName)) {
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
  if (!key || key.length < 32) throw new Error("Key must be at least 32 characters");
  if (!['admin', 'user'].includes(options.role)) throw new Error("Invalid role");

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
    scopes: options.scopes || [],
    label: options.label || '',
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

export function listApiKeys() {
  return getKeys();
}

export { getClientIP };
