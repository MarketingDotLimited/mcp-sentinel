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
 * Middleware: Validate JWT token (dual-auth: internal HS256 + Authelia RS256)
 */

// ── JWKS Cache for Authelia tokens ─────────────────────────
let _jwksCache = null;
let _jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour
const AUTHELIA_ISSUER = 'https://begin.shopping:2083';
const AUTHELIA_JWKS_URL = 'https://127.0.0.1:2083/api/oidc/jwks';
const MAPPINGS_FILE = '/etc/authelia/user-mappings.json';

async function getAutheliaJWKS(forceRefresh = false) {
  if (_jwksCache && !forceRefresh && (Date.now() - _jwksCacheTime < JWKS_CACHE_TTL)) {
    return _jwksCache;
  }
  try {
    const { createRemoteJWKSet } = await import('jose');
    const { Agent, setGlobalDispatcher } = await import('undici');
    
    // Create an undici agent that ignores self-signed certs for loopback JWKS
    const agent = new Agent({
      connect: { rejectUnauthorized: false }
    });

    _jwksCache = createRemoteJWKSet(new URL(AUTHELIA_JWKS_URL), {
      cooldownDuration: 30000,
      cacheMaxAge: JWKS_CACHE_TTL,
      [Symbol.asyncIterator]: undefined, // trick for formatting
    });
    
    // Override the global fetch dispatcher just for this internal fetch,
    // or better yet, inject the fetch option if jose supports it.
    // In jose v5, you can pass custom fetch or use undici globally.
    setGlobalDispatcher(agent);
    _jwksCacheTime = Date.now();
    return _jwksCache;
  } catch (err) {
    console.error('Failed to fetch Authelia JWKS:', err.message);
    return null;
  }
}

async function loadUserMappings() {
  try {
    const fs = await import('fs/promises');
    const data = await fs.default.readFile(MAPPINGS_FILE, 'utf8');
    return JSON.parse(data);
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

  // ── Try 1: Internal Sentinel HS256 Token ──────────────
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

    // Enforce IP binding (soft check due to Cloudflare rotating proxy IPs)
    if (decoded.ip && decoded.ip !== ip) {
      logSecurityEvent({ ip, event: 'TOKEN_IP_MISMATCH', detail: { tokenIP: decoded.ip, currentIP: ip } });
      // We don't block here anymore because Cloudflare can change the client IP mid-session
    }

    req.identity = {
      userId: decoded.sub,
      role: decoded.role,
      scopes: decoded.scopes,
    };

    return next();
  } catch (internalErr) {
    // Internal token failed — try Authelia token
  }

  // ── Try 2: Authelia RS256 OIDC Token ──────────────────
  (async () => {
    try {
      const { jwtVerify } = await import('jose');
      const jwks = await getAutheliaJWKS();
      if (!jwks) {
        logSecurityEvent({ ip, event: 'OAUTH_JWKS_UNAVAILABLE', detail: {} });
        return res.status(401).json({ error: 'OAuth verification unavailable' });
      }

      let result;
      try {
        result = await jwtVerify(token, jwks, {
          issuer: AUTHELIA_ISSUER,
        });
      } catch (verifyErr) {
        // Force refresh JWKS and retry once (handles key rotation)
        const refreshedJwks = await getAutheliaJWKS(true);
        if (!refreshedJwks) {
          throw verifyErr;
        }
        result = await jwtVerify(token, refreshedJwks, {
          issuer: AUTHELIA_ISSUER,
        });
      }

      const payload = result.payload;
      
      // Basic audience check: ensure the token is meant for an OIDC client
      if (!payload.aud && !payload.client_id) {
        throw new Error('Missing audience or client_id claim');
      }

      // Explicit Token Type Validation: prevent users from passing an id_token as a bearer token
      // Authelia access tokens usually include scopes or client_id differently than id_tokens.
      // If Authelia adds a specific type claim (like typ: 'JWT' vs token_type: 'Bearer'), we check it.
      // Alternatively, we can check for the nonce claim which is strictly id_token only.
      if (payload.nonce) {
        throw new Error('Invalid token type: id_token cannot be used as an access token');
      }

      const oauthUsername = payload.preferred_username || payload.email || payload.sub || '';

      // Look up user mapping
      const mappings = await loadUserMappings();
      
      // Extract client_id from token (aud could be an array or string, or client_id could be present)
      const clientId = payload.client_id || (Array.isArray(payload.aud) ? payload.aud[0] : payload.aud);
      
      const userMapping = mappings[oauthUsername];
      if (!userMapping) {
        throw new Error(`No mapping found for OAuth user: ${oauthUsername}`);
      }

      // Check for client-specific scopes, fallback to global user scopes
      let mappedUser = userMapping.linuxUser;
      let mappedScopes = userMapping.scopes || [];

      if (userMapping.clients && userMapping.clients[clientId]) {
        mappedUser = userMapping.clients[clientId].linuxUser || mappedUser;
        mappedScopes = userMapping.clients[clientId].scopes || mappedScopes;
      } else if (userMapping.clients && !userMapping.scopes) {
        // Strict client checking: if they have a 'clients' block but no global fallback, deny
        throw new Error(`User not authorized for client: ${clientId}`);
      }

      req.identity = {
        userId: mappedUser,
        role: mappedScopes.includes('*') || mappedScopes.includes('admin') ? 'admin' : 'user',
        scopes: mappedScopes,
        oauthUser: oauthUsername,
        oauthClient: clientId,
        oauthProvider: 'authelia',
      };

      logAuth({ ip, userId: mappedUser, event: 'OAUTH_TOKEN_VALIDATED', reason: `OAuth user: ${oauthUsername}` });
      return next();
    } catch (oauthErr) {
      logSecurityEvent({ ip, event: 'OAUTH_TOKEN_REJECTED', detail: { error: oauthErr.message } });
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  })();
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
