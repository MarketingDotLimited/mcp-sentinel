import { brokerCall } from '../lib/broker-client.js';

function requireAdmin(identity) {
  if (identity.role !== 'admin') throw new Error('User management requires admin role');
}

function validateUsername(username, { allowRoot = false } = {}) {
  if (typeof username !== 'string' || !/^[a-z_][a-z0-9_.-]{0,31}$/i.test(username)) throw new Error('Invalid username');
  if (!allowRoot && username === 'root') throw new Error('Cannot modify reserved system user');
  return username;
}

function groups(value, field) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !value.split(',').every(group => /^[a-z_][a-z0-9_-]*$/i.test(group)))
    throw new Error(`${field} must contain valid group names`);
  return value.split(',');
}

function validatePublicKey(publicKey) {
  if (typeof publicKey !== 'string' || publicKey.length > 8192 || /[\r\n]/.test(publicKey))
    throw new Error('Invalid SSH public key payload');
  const parts = publicKey.trim().split(/\s+/);
  const validTypes = new Set([
    'ssh-rsa',
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'sk-ssh-ed25519@openssh.com',
  ]);
  if (!validTypes.has(parts[0]) || !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[1] || ''))
    throw new Error('Invalid SSH public key payload');
  return publicKey.trim();
}

export async function listUsers({ includeSystem = false }, identity) {
  requireAdmin(identity);
  return brokerCall('user.list', { includeSystem });
}

export async function getUserInfo({ username }, identity) {
  if (identity.role !== 'admin' && username !== identity.userId)
    throw new Error('You can only view your own user info');
  return brokerCall('user.info', { username: validateUsername(username, { allowRoot: identity.role === 'admin' }) });
}

export async function createUser({ username, groups: groupList, shell, comment, createHome = true }, identity) {
  requireAdmin(identity);
  return brokerCall('user.create', {
    username: validateUsername(username),
    ...(groupList ? { groups: groups(groupList, 'groups') } : {}),
    ...(shell ? { shell } : {}),
    ...(comment ? { comment } : {}),
    createHome,
  });
}

export async function deleteUser({ username, removeHome = false }, identity) {
  requireAdmin(identity);
  return brokerCall('user.delete', { username: validateUsername(username), removeHome });
}

export async function setUserPassword({ username, password }, identity) {
  requireAdmin(identity);
  validateUsername(username);
  if (typeof password !== 'string' || /[\n\r\0:]/.test(password))
    throw new Error('Password contains invalid characters (newline, carriage return, null, colon)');
  if (password.length < 12 || password.length > 1024) throw new Error('Password must be 12-1024 characters');
  return brokerCall('user.password', { username, password });
}

export async function modifyUser(
  { username, addGroups, removeGroups, shell, lockAccount, unlockAccount, expireDate },
  identity
) {
  requireAdmin(identity);
  validateUsername(username);
  if (lockAccount && unlockAccount) throw new Error('Cannot lock and unlock account simultaneously');
  if (expireDate !== undefined && expireDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(expireDate))
    throw new Error('expireDate must be YYYY-MM-DD or empty');
  return brokerCall('user.modify', {
    username,
    ...(addGroups ? { addGroups: groups(addGroups, 'addGroups') } : {}),
    ...(removeGroups ? { removeGroups: groups(removeGroups, 'removeGroups') } : {}),
    ...(shell ? { shell } : {}),
    ...(lockAccount ? { lockAccount: true } : {}),
    ...(unlockAccount ? { unlockAccount: true } : {}),
    ...(expireDate !== undefined ? { expireDate } : {}),
  });
}

export async function manageSshKeys({ username, action, publicKey, keyIndex }, identity) {
  if (identity.role !== 'admin' && username !== identity.userId)
    throw new Error('You can only manage your own SSH keys');
  validateUsername(username, { allowRoot: identity.role === 'admin' });
  if (!['list', 'add', 'remove'].includes(action)) throw new Error('Invalid SSH key action');
  return brokerCall('user.ssh', {
    username,
    action,
    ...(action === 'add' ? { publicKey: validatePublicKey(publicKey) } : {}),
    ...(action === 'remove' ? { keyIndex } : {}),
  });
}
