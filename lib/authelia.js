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

const execFileAsync = promisify(execFile);

const USERS_FILE = '/etc/authelia/users.yml';
const CONFIG_FILE = '/etc/authelia/configuration.yml';
const MAPPINGS_FILE = '/etc/authelia/user-mappings.json';
const BACKUP_DIR = '/etc/authelia/backups';
const AUTHELIA_URL = process.env.AUTHELIA_ISSUER || '';

// ── File Safety ────────────────────────────────────────────

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
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
    await new Promise(resolve => setTimeout(resolve, 2000));
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
  try {
    const data = await fs.readFile(MAPPINGS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function writeMappings(mappings) {
  await atomicWrite(MAPPINGS_FILE, JSON.stringify(mappings, null, 2));
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
        scopes: mapping.scopes || [],
        // Never expose the password hash
      });
    }
  }
  return users;
}

export async function addOAuthUser({ username, password, email, groups, linuxUser, scopes }) {
  if (!username || !password || !email) {
    throw new Error('username, password, and email are required');
  }

  // Validate username format
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    throw new Error('Username must contain only letters, numbers, dots, hyphens, and underscores');
  }

  // Validate Linux user exists if specified
  if (linuxUser && linuxUser !== 'root') {
    try {
      await execFileAsync('id', [linuxUser]);
    } catch {
      throw new Error(`Linux user '${linuxUser}' does not exist on this system`);
    }
  }

  // Generate Argon2 hash using the authelia binary
  let hash;
  try {
    const { stdout } = await execFileAsync('authelia', [
      'crypto', 'hash', 'generate', 'argon2', '--password', password
    ], { timeout: 10000 });
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
  mappings[username] = {
    linuxUser: linuxUser || '',
    scopes: scopes || [],
  };
  await writeMappings(mappings);

  return { username, email, groups: groups || ['users'], linuxUser: linuxUser || '', scopes: scopes || [] };
}

export async function updateOAuthUser(username, updates) {
  const raw = await fs.readFile(USERS_FILE, 'utf8');
  const parsed = yaml.load(raw) || {};

  if (!parsed.users?.[username]) {
    throw new Error(`User '${username}' not found`);
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
    const { stdout } = await execFileAsync('authelia', [
      'crypto', 'hash', 'generate', 'argon2', '--password', updates.password
    ], { timeout: 10000 });
    const match = stdout.match(/Digest:\s+(.+)/);
    if (match) {
      parsed.users[username].password = match[1].trim();
    }
  }

  const newYaml = yaml.dump(parsed, { lineWidth: -1, quotingType: '"', forceQuotes: false });
  await safeWriteAndRestart(USERS_FILE, newYaml);

  // Update mappings
  if (updates.linuxUser !== undefined || updates.scopes !== undefined) {
    const mappings = await readMappings();
    if (!mappings[username]) mappings[username] = {};
    if (updates.linuxUser !== undefined) mappings[username].linuxUser = updates.linuxUser;
    if (updates.scopes !== undefined) mappings[username].scopes = updates.scopes;
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
  if (!clientId || !redirectUris?.length) {
    throw new Error('clientId and at least one redirectUri are required');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(clientId)) {
    throw new Error('clientId must contain only letters, numbers, hyphens, and underscores');
  }
  if (!Array.isArray(redirectUris) || !redirectUris.every(isAllowedRedirectUri)) {
    throw new Error('redirectUris must be valid HTTPS URLs (http is allowed only for localhost) without fragments');
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

  parsed.identity_providers.oidc.clients.push({
    client_id: clientId,
    client_name: clientName || clientId,
    public: true,
    authorization_policy: 'one_factor',
    require_pkce: true,
    pkce_challenge_method: 'S256',
    redirect_uris: redirectUris,
    scopes: ['openid', 'profile', 'email'],
    userinfo_signed_response_alg: 'none',
  });

  const updatedConfig = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
  await safeWriteAndRestart(CONFIG_FILE, updatedConfig);

  return { client_id: clientId, client_name: clientName || clientId };
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
    const { stdout: uptime } = await execFileAsync('systemctl', ['show', 'authelia', '--property=ActiveEnterTimestamp']);

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
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch {
    return false;
  }
}

export async function forceRestartAuthelia() {
  return await restartAuthelia();
}
