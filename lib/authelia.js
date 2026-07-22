// ============================================================
//  lib/authelia.js - Authelia Management Module
//  Handles user CRUD, OIDC client management, service health,
//  file safety (backup/restore), and Authelia service control.
// ============================================================
import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as yaml from 'js-yaml';
import path from 'path';
import { randomBytes } from 'crypto';
import { readOAuthMappings, writeOAuthMappings } from './oauth-mappings-store.js';

const execFileAsync = promisify(execFile);

const USERS_FILE = process.env.AUTHELIA_USERS_FILE || '/etc/mcp-sentinel/users.yml';
const CONFIG_FILE = process.env.AUTHELIA_CONFIG_FILE || '/etc/mcp-sentinel/authelia.yml';
const BACKUP_DIR = process.env.AUTHELIA_BACKUP_DIR || '/var/lib/mcp-sentinel/authelia-backups';
const AUTHELIA_URL = process.env.AUTHELIA_ISSUER || '';

// ── File Safety ────────────────────────────────────────────

async function ensureBackupDir() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
    // Backups contain identity-provider configuration, so keep them private
    // even if the directory was created by an earlier installation.
    await fs.chmod(BACKUP_DIR, 0o700);
  } catch (error) {
    throw new Error(`Cannot prepare Authelia backup directory (${BACKUP_DIR}): ${error.message}`);
  }
}

async function backupFile(filePath) {
  await ensureBackupDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const basename = path.basename(filePath);
  const backupPath = path.join(BACKUP_DIR, `${basename}.bak.${ts}`);
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

async function atomicWrite(filePath, content) {
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, content, { mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

async function restartAuthelia() {
  try {
    await execFileAsync('systemctl', ['restart', 'authelia']);
    // Wait for it to come up
    const settleMs = Math.min(Math.max(Number(process.env.AUTHELIA_RESTART_SETTLE_MS || 2000), 0), 10_000);
    await new Promise(resolve => setTimeout(resolve, settleMs));
    const { stdout } = await execFileAsync('systemctl', ['is-active', 'authelia']);
    return stdout.trim() === 'active';
  } catch {
    return false;
  }
}

async function rollbackFile(originalPath, backupPath) {
  try {
    await fs.copyFile(backupPath, originalPath);
    await restartAuthelia();
  } catch (err) {
    console.error('Rollback failed:', err.message);
  }
}

/**
 * Safely write a file with backup, atomic write, restart, and rollback on failure.
 */
async function safeWriteAndRestart(filePath, content) {
  const backupPath = await backupFile(filePath);
  await atomicWrite(filePath, content);

  const healthy = await restartAuthelia();
  if (!healthy) {
    console.error(`Authelia unhealthy after writing ${filePath}, rolling back...`);
    await rollbackFile(filePath, backupPath);
    throw new Error('Authelia failed to restart after config change. Rolled back to previous version.');
  }
  return true;
}

// ── User Mappings ──────────────────────────────────────────

async function readMappings() {
  return readOAuthMappings();
}

async function writeMappings(mappings) {
  await writeOAuthMappings(mappings);
}

function normalizeAuthorizationMapping(input, existing = {}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const linuxUser = input.linuxUser ?? existing.linuxUser ?? '';
  if (linuxUser === 'root' || (linuxUser && !/^[a-z_][a-z0-9_.-]{0,31}$/i.test(linuxUser)))
    throw new Error('Invalid OAuth Linux user');
  const role = input.role ?? existing.role ?? 'viewer';
  if (!['admin', 'developer', 'operator', 'auditor', 'viewer'].includes(role)) throw new Error('Invalid OAuth role');
  const scopes = input.scopes ?? existing.scopes ?? [];
  if (
    !Array.isArray(scopes) ||
    !scopes.every(scope => typeof scope === 'string' && /^[a-z0-9.*:_-]{1,128}$/i.test(scope))
  )
    throw new Error('Invalid OAuth scopes');
  const projectIds = input.projectIds ?? existing.projectIds ?? [];
  if (!Array.isArray(projectIds) || !projectIds.every(id => uuid.test(id)))
    throw new Error('Invalid OAuth project assignments');
  const requireApproval = input.requireApproval ?? existing.requireApproval ?? true;
  if (typeof requireApproval !== 'boolean') throw new Error('Invalid OAuth approval setting');
  const organizationId = input.organizationId ?? existing.organizationId ?? null;
  const teamId = input.teamId ?? existing.teamId ?? null;
  if (organizationId !== null && !uuid.test(organizationId)) throw new Error('Invalid OAuth organization assignment');
  if (teamId !== null && !uuid.test(teamId)) throw new Error('Invalid OAuth team assignment');
  const clients = normalizeClientOverrides(input.clients ?? existing.clients ?? {});
  const version = input.authorizationVersion ?? Number(existing.authorizationVersion || 0) + 1;
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('Invalid OAuth authorization version');
  return {
    linuxUser,
    role,
    scopes: [...new Set(scopes)],
    requireApproval,
    projectIds: [...new Set(projectIds)],
    organizationId,
    teamId,
    clients,
    authorizationVersion: version,
  };
}

function normalizeClientOverrides(clients) {
  if (!clients || typeof clients !== 'object' || Array.isArray(clients))
    throw new Error('Invalid OAuth client overrides');
  const allowedFields = new Set([
    'linuxUser',
    'role',
    'scopes',
    'requireApproval',
    'projectIds',
    'organizationId',
    'teamId',
    'authorizationVersion',
  ]);
  return Object.fromEntries(
    Object.entries(clients).map(([clientId, override]) => {
      if (!/^[a-zA-Z0-9_-]{3,128}$/.test(clientId)) throw new Error('Invalid OAuth client override ID');
      if (!override || typeof override !== 'object' || Array.isArray(override))
        throw new Error('Invalid OAuth client override');
      if (Object.keys(override).some(key => !allowedFields.has(key)))
        throw new Error('OAuth client override contains an unknown field');
      if (override.linuxUser === 'root') throw new Error('OAuth client overrides cannot map directly to root');
      if (
        override.role !== undefined &&
        !['admin', 'developer', 'operator', 'auditor', 'viewer'].includes(override.role)
      )
        throw new Error('Invalid OAuth client override role');
      if (
        override.scopes !== undefined &&
        (!Array.isArray(override.scopes) ||
          !override.scopes.every(scope => typeof scope === 'string' && /^[a-z0-9.*:_-]{1,128}$/i.test(scope)))
      )
        throw new Error('Invalid OAuth client override scopes');
      if (
        override.projectIds !== undefined &&
        (!Array.isArray(override.projectIds) || !override.projectIds.every(id => /^[0-9a-f-]{36}$/i.test(id)))
      )
        throw new Error('Invalid OAuth client project assignments');
      if (override.requireApproval !== undefined && typeof override.requireApproval !== 'boolean')
        throw new Error('Invalid OAuth client approval setting');
      if (
        override.authorizationVersion !== undefined &&
        (!Number.isSafeInteger(override.authorizationVersion) || override.authorizationVersion < 1)
      )
        throw new Error('Invalid OAuth client authorization version');
      return [
        clientId,
        {
          ...override,
          ...(override.scopes ? { scopes: [...new Set(override.scopes)] } : {}),
          ...(override.projectIds ? { projectIds: [...new Set(override.projectIds)] } : {}),
        },
      ];
    })
  );
}

// ── User Management ────────────────────────────────────────

export async function getOAuthUsers() {
  const raw = await fs.readFile(USERS_FILE, 'utf8');
  const parsed = yaml.load(raw);
  const mappings = await readMappings();
  const users = [];

  if (parsed?.users) {
    for (const [username, data] of Object.entries(parsed.users)) {
      const mapping = mappings[username] || {};
      users.push({
        username,
        displayname: data.displayname || username,
        email: data.email || '',
        groups: data.groups || [],
        linuxUser: mapping.linuxUser || '',
        role: mapping.role || 'viewer',
        scopes: mapping.scopes || [],
        requireApproval: mapping.requireApproval !== false,
        projectIds: mapping.projectIds || [],
        organizationId: mapping.organizationId || null,
        teamId: mapping.teamId || null,
        authorizationVersion: mapping.authorizationVersion || 1,
        // Never expose the password hash
      });
    }
  }
  return users;
}

export async function addOAuthUser({ username, password, email, groups, ...authorization }) {
  username = typeof username === 'string' ? username.trim() : '';
  email = typeof email === 'string' ? email.trim() : '';
  if (!username || !password || !email) {
    throw new Error('username, password, and email are required');
  }

  // Validate username format
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    throw new Error('Username must contain only letters, numbers, dots, hyphens, and underscores');
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('A valid email address is required');
  }

  // Validate Linux user exists if specified
  if (authorization.linuxUser && authorization.linuxUser !== 'root') {
    try {
      await execFileAsync('id', ['--', authorization.linuxUser]);
    } catch {
      throw new Error(`Linux user '${authorization.linuxUser}' does not exist on this system`);
    }
  }

  // Validate the complete authorization record before hashing a password or
  // changing Authelia's user file, so a rejected mapping cannot leave a
  // partially-created identity behind.
  const normalizedAuthorization = normalizeAuthorizationMapping(authorization);

  // Generate Argon2 hash using the authelia binary
  let hash;
  try {
    const { stdout } = await execFileAsync(
      'authelia',
      ['crypto', 'hash', 'generate', 'argon2', '--password', password],
      { timeout: 10000 }
    );
    const match = stdout.match(/Digest:\s+(.+)/);
    if (!match) throw new Error('Failed to parse hash output');
    hash = match[1].trim();
  } catch (err) {
    throw new Error(`Password hashing failed: ${err.message}`);
  }

  // Read existing users
  const raw = await fs.readFile(USERS_FILE, 'utf8');
  const parsed = yaml.load(raw) || {};
  if (!parsed.users) parsed.users = {};

  if (parsed.users[username]) {
    throw new Error(`User '${username}' already exists`);
  }

  // Add user
  parsed.users[username] = {
    displayname: username,
    password: hash,
    email,
    groups: groups || ['users'],
  };

  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"', forceQuotes: false });
  await safeWriteAndRestart(USERS_FILE, newYaml);

  // Save mapping
  const mappings = await readMappings();
  mappings[username] = normalizedAuthorization;
  await writeMappings(mappings);

  return { username, email, groups: groups || ['users'], ...mappings[username] };
}

export async function updateOAuthUser(username, updates) {
  const raw = await fs.readFile(USERS_FILE, 'utf8');
  const parsed = yaml.load(raw) || {};

  if (!parsed.users?.[username]) {
    throw new Error(`User '${username}' not found`);
  }

  const updatesAuthorization = [
    'linuxUser',
    'role',
    'scopes',
    'requireApproval',
    'projectIds',
    'organizationId',
    'teamId',
    'clients',
    'authorizationVersion',
  ].some(key => updates[key] !== undefined);
  let mappings;
  let normalizedAuthorization;
  if (updatesAuthorization) {
    mappings = await readMappings();
    normalizedAuthorization = normalizeAuthorizationMapping(updates, mappings[username] || {});
  }

  // Update email
  if (updates.email) {
    parsed.users[username].email = updates.email;
  }

  // Update groups
  if (updates.groups) {
    parsed.users[username].groups = updates.groups;
  }

  // Update password (re-hash)
  if (updates.password) {
    const { stdout } = await execFileAsync(
      'authelia',
      ['crypto', 'hash', 'generate', 'argon2', '--password', updates.password],
      { timeout: 10000 }
    );
    const match = stdout.match(/Digest:\s+(.+)/);
    if (match) {
      parsed.users[username].password = match[1].trim();
    }
  }

  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"', forceQuotes: false });
  await safeWriteAndRestart(USERS_FILE, newYaml);

  // Update mappings
  if (updatesAuthorization) {
    mappings[username] = normalizedAuthorization;
    await writeMappings(mappings);
  }

  return true;
}

export async function deleteOAuthUser(username) {
  if (username === 'admin') {
    throw new Error('Cannot delete the admin user');
  }

  const raw = await fs.readFile(USERS_FILE, 'utf8');
  const parsed = yaml.load(raw) || {};

  if (!parsed.users?.[username]) {
    throw new Error(`User '${username}' not found`);
  }

  delete parsed.users[username];

  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"', forceQuotes: false });
  await safeWriteAndRestart(USERS_FILE, newYaml);

  // Remove mapping
  const mappings = await readMappings();
  delete mappings[username];
  await writeMappings(mappings);

  return true;
}

// ── OIDC Client Management ─────────────────────────────────

export async function getOAuthClients() {
  const raw = await fs.readFile(CONFIG_FILE, 'utf8');
  const parsed = yaml.load(raw);
  const clients = parsed?.identity_providers?.oidc?.clients || [];
  return clients.map(c => ({
    client_id: c.client_id,
    client_name: c.client_name || c.client_id,
    public: c.public || false,
    redirect_uris: c.redirect_uris || [],
    scopes: c.scopes || [],
    authorization_policy: c.authorization_policy || 'one_factor',
  }));
}

export async function addOAuthClient({ clientId, clientName, redirectUris }) {
  clientId = typeof clientId === 'string' ? clientId.trim() : '';
  clientName = typeof clientName === 'string' ? clientName.trim() : '';
  const normalizedRedirectUris = [
    ...new Set(
      (Array.isArray(redirectUris) ? redirectUris : [])
        .map(uri => (typeof uri === 'string' ? uri.trim() : ''))
        .filter(Boolean)
    ),
  ];

  if (!normalizedRedirectUris.length) {
    throw new Error('At least one redirect URI is required');
  }

  // A generated ID prevents administrators from having to invent a unique
  // identifier for every ChatGPT connector they create.
  if (!clientId) clientId = `chatgpt-${randomBytes(8).toString('hex')}`;

  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(clientId)) {
    throw new Error('clientId must contain only letters, numbers, hyphens, and underscores');
  }
  if (!normalizedRedirectUris.every(isAllowedRedirectUri)) {
    throw new Error('redirectUris must be valid HTTPS URLs (http is allowed only for localhost) without fragments');
  }

  const clientSecret = randomBytes(32).toString('base64url');
  let clientSecretHash;
  try {
    const { stdout } = await execFileAsync(
      'authelia',
      ['crypto', 'hash', 'generate', 'argon2', '--password', clientSecret],
      { timeout: 10000 }
    );
    const match = stdout.match(/Digest:\s+(.+)/);
    if (!match) throw new Error('Failed to parse secret hash output');
    clientSecretHash = match[1].trim();
  } catch (error) {
    throw new Error(`OAuth client secret generation failed: ${error.message}`);
  }

  const raw = await fs.readFile(CONFIG_FILE, 'utf8');
  const parsed = yaml.load(raw);

  if (!parsed.identity_providers?.oidc?.clients) {
    throw new Error('Invalid Authelia config: missing OIDC clients section');
  }

  const existing = parsed.identity_providers.oidc.clients.find(c => c.client_id === clientId);
  if (existing) {
    throw new Error(`Client '${clientId}' already exists`);
  }

  const resourceAudience = (process.env.OAUTH_RESOURCE_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
  parsed.identity_providers.oidc.clients.push({
    client_id: clientId,
    client_name: clientName || clientId,
    client_secret: clientSecretHash,
    public: false,
    authorization_policy: 'one_factor',
    // Confidential clients still use PKCE to bind the authorization code to
    // the initiating client instance.
    require_pkce: true,
    pkce_challenge_method: 'S256',
    redirect_uris: normalizedRedirectUris,
    ...(resourceAudience ? { audience: [resourceAudience] } : {}),
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    response_types: ['code'],
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'client_secret_basic',
    // The MCP resource server validates access tokens locally using Authelia's
    // published JWKS. Without this, Authelia emits opaque tokens which cannot
    // be verified as a compact JWS by the resource server.
    access_token_signed_response_alg: 'RS256',
    userinfo_signed_response_alg: 'none',
  });

  const updatedConfig = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
  await safeWriteAndRestart(CONFIG_FILE, updatedConfig);

  // The plaintext secret is deliberately returned only once. The persisted
  // Authelia configuration contains its Argon2 digest, never this value.
  return {
    client_id: clientId,
    client_name: clientName || clientId,
    client_secret: clientSecret,
    redirect_uris: normalizedRedirectUris,
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    token_endpoint_auth_method: 'client_secret_basic',
  };
}

export async function deleteOAuthClient(clientId) {
  if (clientId === 'chatgpt') {
    throw new Error('Cannot delete the primary ChatGPT client');
  }

  const raw = await fs.readFile(CONFIG_FILE, 'utf8');
  const parsed = yaml.load(raw);

  if (!parsed.identity_providers?.oidc?.clients) {
    throw new Error('Invalid Authelia config');
  }

  const idx = parsed.identity_providers.oidc.clients.findIndex(c => c.client_id === clientId);
  if (idx === -1) {
    throw new Error(`Client '${clientId}' not found`);
  }

  parsed.identity_providers.oidc.clients.splice(idx, 1);

  const updatedConfig = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
  await safeWriteAndRestart(CONFIG_FILE, updatedConfig);
  return true;
}

// ── Service Health ──────────────────────────────────────────

export async function getAutheliaHealth() {
  try {
    const { stdout: active } = await execFileAsync('systemctl', ['is-active', 'authelia']);
    const { stdout: uptime } = await execFileAsync('systemctl', [
      'show',
      'authelia',
      '--property=ActiveEnterTimestamp',
    ]);

    const users = await getOAuthUsers();
    const clients = await getOAuthClients();

    return {
      status: active.trim(),
      uptime: uptime.replace('ActiveEnterTimestamp=', '').trim(),
      totalUsers: users.length,
      totalClients: clients.length,
      url: AUTHELIA_URL,
      discoveryUrl: AUTHELIA_URL ? `${AUTHELIA_URL}/.well-known/openid-configuration` : '',
      jwksUrl: process.env.AUTHELIA_JWKS_URL || '',
    };
  } catch {
    return {
      status: 'inactive',
      uptime: '',
      totalUsers: 0,
      totalClients: 0,
      url: AUTHELIA_URL,
      discoveryUrl: '',
      jwksUrl: '',
    };
  }
}

function isAllowedRedirectUri(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

export async function forceRestartAuthelia() {
  return await restartAuthelia();
}
