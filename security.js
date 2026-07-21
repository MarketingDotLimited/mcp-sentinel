// ============================================================
//  security.js - All Security Middleware
// ============================================================
import jwt from 'jsonwebtoken';
import { logAuth, logSecurityEvent } from './audit.js';

// ── In-memory key store (load from .env / DB in production) ─
// Format: { apiKey: { userId, role, allowedIPs, scopes, active } }
const API_KEYS = new Map();

// Initialize from environment
if (process.env.ADMIN_API_KEY) {
  API_KEYS.set(process.env.ADMIN_API_KEY, {
    userId: 'admin',
    role: 'admin',         // admin | user
    allowedIPs: [],        // empty = use global whitelist
    scopes: ['*'],         // '*' = all tools
    active: true,
    label: 'Master Admin Key',
  });
}

// ── IP Whitelist ───────────────────────────────────────────

/**
 * Parse CIDR or plain IP and check membership.
 * Supports IPv4 only for simplicity; extend with 'ipaddr.js' for IPv6 if needed.
 */
function ipInCidr(ip, cidr) {
  if (!cidr.includes('/')) return ip === cidr;
  const [base, bits] = cidr.split('/');
  const mask = ~((1 << (32 - parseInt(bits))) - 1) >>> 0;
  const ipNum = ipToNum(ip);
  const baseNum = ipToNum(base);
  return (ipNum & mask) === (baseNum & mask);
}

function ipToNum(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
}

function getClientIP(req) {
  if (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-for']) {
    return req.headers['x-forwarded-for'].split(',')[0].trim().replace('::ffff:', '');
  }
  return (
    req.socket?.remoteAddress ||
    ''
  ).replace('::ffff:', '');
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

  const keyEntry = API_KEYS.get(apiKey);

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
    apiKey,
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
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY || '8h',
    issuer: 'mcp-server',
    audience: 'mcp-client',
  });

  logAuth({ ip, userId: req.identity.userId, event: 'TOKEN_ISSUED' });

  return res.json({
    token,
    expires_in: process.env.JWT_EXPIRY || '8h',
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
    });

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

export function addApiKey(key, options) {
  API_KEYS.set(key, {
    userId: options.userId,
    role: options.role || 'user',
    allowedIPs: options.allowedIPs || [],
    scopes: options.scopes || [],
    active: true,
    label: options.label || '',
    createdAt: new Date().toISOString(),
  });
}

export function revokeApiKey(key) {
  const entry = API_KEYS.get(key);
  if (entry) {
    entry.active = false;
    return true;
  }
  return false;
}

export function listApiKeys() {
  return Array.from(API_KEYS.entries()).map(([key, entry]) => ({
    key: maskKey(key),
    ...entry,
  }));
}

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}

export { getClientIP };
