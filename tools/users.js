// ============================================================
//  tools/users.js - User Management (Admin Only)
// ============================================================
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

function requireAdmin(identity) {
  if (identity.role !== 'admin') {
    throw new Error('User management requires admin role');
  }
}

function validateUsername(username) {
  if (!username || !/^[a-z_][a-z0-9_\-]{0,31}$/.test(username)) {
    throw new Error(`Invalid username: '${username}'. Use lowercase letters, digits, underscore, hyphen. Max 32 chars.`);
  }
  // Prevent dangerous reserved names
  const reserved = ['root', 'daemon', 'bin', 'sys', 'nobody', 'www-data'];
  if (reserved.includes(username)) {
    throw new Error(`Cannot modify reserved system user: '${username}'`);
  }
}

// ── Tool: list_users ──────────────────────────────────────

export async function listUsers({ includeSystem = false }, identity) {
  requireAdmin(identity);

  const passwd = await fs.readFile('/etc/passwd', 'utf8');
  const lines = passwd.trim().split('\n');

  const users = lines.map(line => {
    const [username, , uid, gid, comment, home, shell] = line.split(':');
    return {
      username,
      uid: parseInt(uid),
      gid: parseInt(gid),
      comment: comment || '',
      home,
      shell,
      is_system: parseInt(uid) < 1000,
    };
  });

  const filtered = includeSystem ? users : users.filter(u => !u.is_system);

  // Get last login for each
  const result = await Promise.all(
    filtered.map(async user => {
      try {
        const { stdout } = await execFileAsync('lastlog', ['-u', user.username]);
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

  const [idOut, groupsOut, lastlogOut, passwdEntry] = await Promise.allSettled([
    execFileAsync('id', [username]),
    execFileAsync('groups', [username]),
    execFileAsync('lastlog', ['-u', username]),
    fs.readFile('/etc/passwd', 'utf8').then(c =>
      c.split('\n').find(l => l.startsWith(username + ':'))
    ),
  ]);

  const entry = passwdEntry.value;
  const [, , uid, gid, comment, home, shell] = (entry || ':::::/:').split(':');

  // Check SSH keys
  let sshKeys = [];
  try {
    const authKeysPath = path.join(home || `/home/${username}`, '.ssh', 'authorized_keys');
    const keyContent = await fs.readFile(authKeysPath, 'utf8');
    sshKeys = keyContent.trim().split('\n').filter(Boolean).map((k, i) => ({
      index: i,
      type: k.split(' ')[0],
      comment: k.split(' ')[2] || '',
      truncated_key: k.split(' ')[1]?.slice(0, 20) + '...',
    }));
  } catch { /* no SSH keys or no access */ }

  return {
    username,
    uid: parseInt(uid) || null,
    gid: parseInt(gid) || null,
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

export async function createUser({ username, password, groups, shell = '/bin/bash', comment, createHome = true }, identity) {
  requireAdmin(identity);
  validateUsername(username);

  const args = [username];
  if (createHome) args.push('-m');
  if (shell) args.push('-s', shell);
  if (comment) args.push('-c', comment);
  if (groups) args.push('-G', groups); // comma-separated supplementary groups

  const { stdout, stderr } = await execFileAsync('useradd', args, { timeout: 15000 })
    .catch(err => ({ stdout: '', stderr: err.stderr || err.message }));

  if (stderr && !stdout) {
    // Check if it's a fatal error
    const { stdout: idOut } = await execFileAsync('id', [username]).catch(() => ({ stdout: '' }));
    if (!idOut) throw new Error(`Failed to create user: ${stderr}`);
  }

  // Set password if provided
  if (password) {
    await setUserPassword({ username, password }, identity);
  }

  return {
    success: true,
    username,
    message: `User '${username}' created successfully`,
    home: `/home/${username}`,
  };
}

// ── Tool: delete_user ─────────────────────────────────────

export async function deleteUser({ username, removeHome = false }, identity) {
  requireAdmin(identity);
  validateUsername(username);

  const args = [username];
  if (removeHome) args.push('-r');

  const { stdout, stderr } = await execFileAsync('userdel', args, { timeout: 15000 })
    .catch(err => ({ stdout: '', stderr: err.stderr || err.message }));

  if (stderr && stderr.includes('does not exist')) {
    throw new Error(`User '${username}' does not exist`);
  }

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

export async function modifyUser({ username, addGroups, removeGroups, shell, lockAccount, unlockAccount, expireDate }, identity) {
  requireAdmin(identity);
  validateUsername(username);

  const results = [];

  if (addGroups) {
    await execFileAsync('usermod', ['-aG', addGroups, username]);
    results.push(`Added to groups: ${addGroups}`);
  }

  if (removeGroups) {
    // Get current groups, remove specified ones
    const { stdout } = await execFileAsync('id', ['-nG', username]);
    const currentGroups = stdout.trim().split(' ');
    const toRemove = removeGroups.split(',');
    const newGroups = currentGroups.filter(g => !toRemove.includes(g) && g !== username);
    await execFileAsync('usermod', ['-G', newGroups.join(','), username]);
    results.push(`Removed from groups: ${removeGroups}`);
  }

  if (shell) {
    await execFileAsync('usermod', ['-s', shell, username]);
    results.push(`Shell set to: ${shell}`);
  }

  if (lockAccount) {
    await execFileAsync('usermod', ['-L', username]);
    results.push('Account locked');
  }

  if (unlockAccount) {
    await execFileAsync('usermod', ['-U', username]);
    results.push('Account unlocked');
  }

  if (expireDate) {
    await execFileAsync('usermod', ['-e', expireDate, username]);
    results.push(`Expiry set to: ${expireDate}`);
  }

  return { success: true, username, changes: results };
}

// ── Tool: manage_ssh_keys ─────────────────────────────────

export async function manageSshKeys({ username, action, publicKey, keyIndex }, identity) {
  // Users can manage their own SSH keys; admin can manage any
  if (identity.role !== 'admin' && username !== identity.userId) {
    throw new Error('You can only manage your own SSH keys');
  }

  if (!username || !action) throw new Error('username and action are required');

  const homeDir = `/home/${username}`;
  const sshDir = path.join(homeDir, '.ssh');
  const authKeysPath = path.join(sshDir, 'authorized_keys');

  if (action === 'add') {
    if (!publicKey) throw new Error('publicKey is required for add action');

    // Basic SSH key validation
    const keyParts = publicKey.trim().split(' ');
    const validTypes = ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'sk-ssh-ed25519@openssh.com'];
    if (!validTypes.includes(keyParts[0])) {
      throw new Error(`Invalid SSH key type: '${keyParts[0]}'`);
    }

    await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });
    await fs.appendFile(authKeysPath, publicKey.trim() + '\n', { mode: 0o600 });

    // Fix permissions
    await execFileAsync('chown', ['-R', `${username}:${username}`, sshDir]);
    await execFileAsync('chmod', ['700', sshDir]);
    await execFileAsync('chmod', ['600', authKeysPath]);

    return { success: true, action: 'add', username, message: 'SSH key added' };
  }

  if (action === 'list') {
    try {
      const content = await fs.readFile(authKeysPath, 'utf8');
      const keys = content.trim().split('\n').filter(Boolean).map((k, i) => ({
        index: i,
        type: k.split(' ')[0],
        comment: k.split(' ')[2] || '(no comment)',
        preview: k.split(' ')[1]?.slice(0, 20) + '...',
      }));
      return { username, keys, count: keys.length };
    } catch {
      return { username, keys: [], count: 0, message: 'No authorized_keys file found' };
    }
  }

  if (action === 'remove') {
    if (keyIndex === undefined) throw new Error('keyIndex is required for remove action');

    const content = await fs.readFile(authKeysPath, 'utf8');
    const keys = content.trim().split('\n').filter(Boolean);

    if (keyIndex < 0 || keyIndex >= keys.length) {
      throw new Error(`Invalid keyIndex: ${keyIndex}. Valid range: 0-${keys.length - 1}`);
    }

    const removed = keys.splice(keyIndex, 1)[0];
    await fs.writeFile(authKeysPath, keys.join('\n') + (keys.length ? '\n' : ''));

    return { success: true, action: 'remove', removed_key_preview: removed.split(' ')[2] || removed.slice(0, 30) };
  }

  throw new Error(`Invalid action: '${action}'. Use: add, list, remove`);
}
