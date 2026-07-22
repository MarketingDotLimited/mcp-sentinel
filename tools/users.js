// ============================================================
//  tools/users.js - User Management (Admin Only)
// ============================================================
import { secureExec } from '../lib/exec.js';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import path from 'path';
import crypto from 'crypto';

const { O_NOFOLLOW } = fsConstants;

function validateExistingUsername(username) {
  if (!username || !/^[a-z_][a-z0-9_-]{0,31}$/.test(username)) {
    throw new Error(
      `Invalid username: '${username}'. Use lowercase letters, digits, underscore, hyphen. Max 32 chars.`
    );
  }
}

function requireAdmin(identity) {
  if (identity.role !== 'admin') {
    throw new Error('User management requires admin role');
  }
}

function validateUsername(username) {
  if (!username || !/^[a-z_][a-z0-9_\-]{0,31}$/.test(username)) {
    throw new Error(
      `Invalid username: '${username}'. Use lowercase letters, digits, underscore, hyphen. Max 32 chars.`
    );
  }
  // Prevent dangerous reserved names
  const reserved = [
    'root',
    'daemon',
    'bin',
    'sys',
    'nobody',
    'www-data',
    'sshd',
    'messagebus',
    'systemd-network',
    'systemd-resolve',
    '_apt',
    'postfix',
    'mail',
    'backup',
    'list',
    'proxy',
    'gnats',
  ];
  if (reserved.includes(username)) {
    throw new Error(`Cannot modify reserved system user: '${username}'`);
  }
}

function validateGroups(groups, fieldName = 'groups') {
  if (groups === undefined || groups === '') return;
  if (typeof groups !== 'string' || !groups.split(',').every(group => /^[a-z_][a-z0-9_-]*$/i.test(group))) {
    throw new Error(`${fieldName} must be a comma-separated list of valid group names`);
  }
}

function sshFingerprint(key) {
  const encoded = key.trim().split(/\s+/)[1] || '';
  if (!encoded) return '';
  return crypto.createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('base64').replace(/=+$/, '');
}

async function getUserHome(username) {
  const passwd = await fs.readFile('/etc/passwd', 'utf8');
  const line = passwd.split('\n').find(entry => entry.startsWith(`${username}:`));
  if (!line) throw new Error(`User '${username}' does not exist`);
  return line.split(':')[5];
}

// ── Tool: list_users ──────────────────────────────────────

export async function listUsers({ includeSystem = false }, identity) {
  requireAdmin(identity);

  const passwd = await fs.readFile('/etc/passwd', 'utf8');
  const lines = passwd.trim().split('\n');

  let uidMin = 1000;
  try {
    const defs = await fs.readFile('/etc/login.defs', 'utf8');
    const match = defs.match(/^UID_MIN\s+(\d+)/m);
    if (match) uidMin = parseInt(match[1], 10);
  } catch {}

  const users = lines.map(line => {
    const [username, , uid, gid, comment, home, shell] = line.split(':');
    return {
      username,
      uid: parseInt(uid),
      gid: parseInt(gid),
      comment: comment || '',
      home,
      shell,
      is_system: parseInt(uid) < uidMin,
    };
  });

  const filtered = includeSystem ? users : users.filter(u => !u.is_system);

  // Get last login for each
  const result = await Promise.all(
    filtered.map(async user => {
      try {
        const { stdout } = await secureExec(['lastlog', '-u', user.username], identity);
        const lastLogin = stdout.split('\n')[1]?.trim() || 'Never';
        return { ...user, last_login: lastLogin };
      } catch {
        return { ...user, last_login: 'Unknown' };
      }
    })
  );

  return { users: result, count: result.length };
}

// ── Tool: get_user_info ────────────────────────────────────

export async function getUserInfo({ username }, identity) {
  // Users can get their own info, admin can get any
  if (identity.role !== 'admin' && username !== identity.userId) {
    throw new Error('You can only view your own user info');
  }
  if (!username) throw new Error('username is required');
  validateExistingUsername(username);

  const [idOut, groupsOut, lastlogOut, passwdEntry] = await Promise.allSettled([
    secureExec(['id', username], identity),
    secureExec(['groups', username], identity),
    secureExec(['lastlog', '-u', username], identity),
    fs.readFile('/etc/passwd', 'utf8').then(c => c.split('\n').find(l => l.startsWith(username + ':'))),
  ]);

  const entry = passwdEntry.value;
  const [, , uid, gid, comment, home, shell] = (entry || ':::::/:').split(':');

  // Check SSH keys
  let sshKeys = [];
  try {
    const authKeysPath = path.join(home || `/home/${username}`, '.ssh', 'authorized_keys');
    const keyContent = await fs.readFile(authKeysPath, 'utf8');
    sshKeys = keyContent
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((k, i) => ({
        index: i,
        type: k.split(' ')[0],
        comment: k.split(' ')[2] || '',
        truncated_key: k.split(' ')[1]?.slice(0, 20) + '...',
      }));
  } catch {
    /* no SSH keys or no access */
  }

  return {
    username,
    uid: uid !== '' ? parseInt(uid, 10) : null,
    gid: gid !== '' ? parseInt(gid, 10) : null,
    comment,
    home,
    shell,
    id_output: idOut.value?.stdout?.trim(),
    groups: groupsOut.value?.stdout?.trim(),
    last_login: lastlogOut.value?.stdout?.split('\n')[1]?.trim() || 'Never',
    ssh_keys: sshKeys,
    ssh_key_count: sshKeys.length,
  };
}

// ── Tool: create_user ─────────────────────────────────────

export async function createUser(
  { username, password, groups, shell = '/bin/bash', comment, createHome = true },
  identity
) {
  requireAdmin(identity);
  validateUsername(username);
  validateGroups(groups);
  if (typeof shell !== 'string' || !path.isAbsolute(shell) || shell.includes('\0')) {
    throw new Error('shell must be an absolute path');
  }

  const { stdout: idOut } = await secureExec(['id', username], identity).catch(() => ({ stdout: '' }));
  if (idOut) throw new Error(`User '${username}' already exists`);

  const args = [username];
  if (createHome) args.push('-m');
  if (shell) args.push('-s', shell);
  if (comment) args.push('-c', comment);
  if (groups) args.push('-G', groups); // comma-separated supplementary groups

  const { stdout, stderr } = await secureExec(['useradd', ...args], identity, { timeout: 15000 }).catch(err => ({
    stdout: '',
    stderr: err.stderr || err.message,
  }));

  if (stderr && !stdout) {
    // Check if it's a fatal error
    const { stdout: idOutPost } = await secureExec(['id', username], identity).catch(() => ({ stdout: '' }));
    if (!idOutPost) throw new Error(`Failed to create user: ${stderr}`);
  }

  // Set password if provided
  if (password) {
    try {
      await setUserPassword({ username, password }, identity);
    } catch (err) {
      await secureExec(['userdel', username], identity).catch(() => {});
      throw err;
    }
  }

  const passwdLine = await fs
    .readFile('/etc/passwd', 'utf8')
    .then(c => c.split('\n').find(l => l.startsWith(username + ':')))
    .catch(() => '');
  const actualHome = passwdLine ? passwdLine.split(':')[5] : `/home/${username}`;

  return {
    success: true,
    username,
    message: `User '${username}' created successfully`,
    home: actualHome,
  };
}

// ── Tool: delete_user ─────────────────────────────────────

export async function deleteUser({ username, removeHome = false }, identity) {
  requireAdmin(identity);
  validateUsername(username);

  const args = [username];
  if (removeHome) args.push('-r');

  const { stdout, stderr } = await secureExec(['userdel', ...args], identity, { timeout: 15000 }).catch(err => {
    throw new Error(`Failed to delete user: ${err.stderr || err.message}`);
  });

  return {
    success: true,
    username,
    home_removed: removeHome,
    message: `User '${username}' deleted`,
  };
}

// ── Tool: set_user_password ────────────────────────────────

export async function setUserPassword({ username, password }, identity) {
  requireAdmin(identity);
  if (!username || !password) throw new Error('username and password are required');
  validateUsername(username);

  if (/[\n\r\0:]/.test(password)) {
    throw new Error('Password contains invalid characters (newline, carriage return, null, colon)');
  }

  // Use chpasswd to set password securely
  const input = `${username}:${password}`;

  return new Promise((resolve, reject) => {
    const child = execFile('chpasswd', [], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ success: true, username, message: `Password updated for '${username}'` });
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

// ── Tool: modify_user ─────────────────────────────────────

export async function modifyUser(
  { username, addGroups, removeGroups, shell, lockAccount, unlockAccount, expireDate },
  identity
) {
  requireAdmin(identity);
  validateUsername(username);
  validateGroups(addGroups, 'addGroups');
  validateGroups(removeGroups, 'removeGroups');
  if (shell !== undefined && (typeof shell !== 'string' || !path.isAbsolute(shell) || shell.includes('\0'))) {
    throw new Error('shell must be an absolute path');
  }
  if (expireDate !== undefined && expireDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(expireDate)) {
    throw new Error('expireDate must be YYYY-MM-DD or an empty string');
  }

  const results = [];

  if (lockAccount && unlockAccount) {
    throw new Error('Cannot lock and unlock account simultaneously');
  }

  if (addGroups) {
    await secureExec(['usermod', '-aG', addGroups, username], identity);
    results.push(`Added to groups: ${addGroups}`);
  }

  if (removeGroups) {
    // Get current groups, remove specified ones
    const { stdout } = await secureExec(['id', '-nG', username], identity);
    const currentGroups = stdout.trim().split(' ');
    const toRemove = removeGroups.split(',');
    const newGroups = currentGroups.filter(g => !toRemove.includes(g) && g !== username);
    await secureExec(['usermod', '-G', newGroups.join(','), username], identity);
    results.push(`Removed from groups: ${removeGroups}`);
  }

  if (shell) {
    await secureExec(['usermod', '-s', shell, username], identity);
    results.push(`Shell set to: ${shell}`);
  }

  if (lockAccount) {
    await secureExec(['usermod', '-L', username], identity);
    results.push('Account locked');
  }

  if (unlockAccount) {
    await secureExec(['usermod', '-U', username], identity);
    results.push('Account unlocked');
  }

  if (expireDate !== undefined) {
    await secureExec(['usermod', '-e', expireDate === '' ? '' : expireDate, username], identity);
    results.push(`Expiry set to: ${expireDate || 'never'}`);
  }

  return { success: true, username, changes: results };
}

// ── Tool: manage_ssh_keys ─────────────────────────────────

export async function manageSshKeys({ username, action, publicKey, keyIndex }, identity) {
  if (identity.role !== 'admin' && username !== identity.userId) {
    throw new Error('You can only manage your own SSH keys');
  }

  if (!username || !action) throw new Error('username and action are required');
  validateExistingUsername(username);

  const homeDir = await getUserHome(username);
  const sshDir = path.join(homeDir, '.ssh');
  const authKeysPath = path.join(sshDir, 'authorized_keys');

  try {
    const stat = await fs.lstat(sshDir);
    if (stat.isSymbolicLink()) throw new Error('.ssh is a symlink');
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  if (action === 'add') {
    if (!publicKey) throw new Error('publicKey is required for add action');
    if (publicKey.includes('\n') || publicKey.includes('\r')) throw new Error('Key must be a single line');
    if (publicKey.length > 8192) throw new Error('Key too long');

    const normalizedKey = publicKey.trim();
    const keyParts = normalizedKey.split(/\s+/);
    const validTypes = [
      'ssh-rsa',
      'ssh-ed25519',
      'ecdsa-sha2-nistp256',
      'ecdsa-sha2-nistp384',
      'ecdsa-sha2-nistp521',
      'sk-ssh-ed25519@openssh.com',
    ];
    if (!validTypes.includes(keyParts[0])) {
      throw new Error(`Invalid SSH key type: '${keyParts[0]}'`);
    }
    if (keyParts.length < 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(keyParts[1])) {
      throw new Error('Invalid SSH public key payload');
    }

    await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
    const sshStat = await fs.lstat(sshDir);
    if (!sshStat.isDirectory() || sshStat.isSymbolicLink()) throw new Error('.ssh must be a directory, not a symlink');
    const file = await fs.open(
      authKeysPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_APPEND | O_NOFOLLOW,
      0o600
    );
    try {
      await file.writeFile(`${normalizedKey}\n`);
    } finally {
      await file.close();
    }
    await secureExec(['chown', '-R', username, sshDir], { role: 'admin' });
    await secureExec(['chmod', '700', sshDir], { role: 'admin' });
    await secureExec(['chmod', '600', authKeysPath], { role: 'admin' });

    return { success: true, action: 'add', username, message: 'SSH key added' };
  }

  if (action === 'list') {
    try {
      const content = await fs.readFile(authKeysPath, 'utf8');
      const keys = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((k, i) => ({
          index: i,
          type: k.split(' ')[0],
          comment: k.split(' ')[2] || '(no comment)',
          preview: k.split(' ')[1]?.slice(0, 20) + '...',
          fingerprint: sshFingerprint(k),
        }));
      return { username, keys, count: keys.length };
    } catch {
      return { username, keys: [], count: 0, message: 'No authorized_keys file found' };
    }
  }

  if (action === 'remove') {
    if (!publicKey && keyIndex === undefined)
      throw new Error('publicKey (exact key or fingerprint) or keyIndex is required for remove action');

    const content = await fs.readFile(authKeysPath, 'utf8');
    const keys = content.trim().split('\n').filter(Boolean);

    const targetKeyIndex =
      keyIndex !== undefined
        ? keyIndex
        : keys.findIndex(k => {
            const fp = sshFingerprint(k);
            return k === publicKey.trim() || fp === publicKey || `SHA256:${fp}` === publicKey;
          });

    if (!Number.isInteger(targetKeyIndex) || targetKeyIndex < 0 || targetKeyIndex >= keys.length) {
      throw new Error(`Key not found in authorized_keys`);
    }

    const removed = keys.splice(targetKeyIndex, 1)[0];

    const newContent = keys.join('\n') + (keys.length ? '\n' : '');
    const sshStat = await fs.lstat(sshDir);
    if (!sshStat.isDirectory() || sshStat.isSymbolicLink()) throw new Error('.ssh must be a directory, not a symlink');
    const file = await fs.open(authKeysPath, fsConstants.O_WRONLY | fsConstants.O_TRUNC | O_NOFOLLOW);
    try {
      await file.writeFile(newContent);
    } finally {
      await file.close();
    }

    return { success: true, action: 'remove', removed_key_preview: removed.split(' ')[2] || removed.slice(0, 30) };
  }

  throw new Error(`Invalid action: '${action}'. Use: add, list, remove`);
}
