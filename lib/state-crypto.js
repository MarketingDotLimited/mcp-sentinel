import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadCredentialSecret } from './credentials.js';

const SECRET_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'clientsecret',
  'privatekey',
  'webhooksecret',
  's3secret',
  'databasepassword',
]);

export function isEncryptedStateValue(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.v === 1 &&
    typeof value.keyId === 'string' &&
    typeof value.iv === 'string' &&
    typeof value.tag === 'string' &&
    typeof value.ciphertext === 'string'
  );
}

function currentKey() {
  const keyHex = loadCredentialSecret('CONTROL_PLANE_KEY', 'state-key');
  if (!keyHex) {
    if (process.env.NODE_ENV === 'production') throw new Error('Production state encryption credential is missing');
    return null;
  }
  if (!/^[a-f0-9]{64}$/i.test(keyHex))
    throw new Error('State encryption credential must contain 64 hexadecimal characters');
  const keyId = process.env.CONTROL_PLANE_KEY_ID || 'state-v1';
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(keyId)) throw new Error('CONTROL_PLANE_KEY_ID is invalid');
  return { keyId, key: Buffer.from(keyHex, 'hex') };
}

export function stateEncryptionConfigured() {
  return currentKey() !== null;
}

function keyForId(keyId) {
  const current = currentKey();
  if (!current) return null;
  if (current.keyId === keyId) return current.key;
  const directory = process.env.CREDENTIALS_DIRECTORY;
  if (!directory) throw new Error(`Archived state key '${keyId}' is unavailable`);
  const file = path.join(directory, `state-key-${keyId}`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const value = fs.readFileSync(descriptor, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`Archived state key '${keyId}' is invalid`);
    return Buffer.from(value, 'hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

export function encryptStateValue(value) {
  if (isEncryptedStateValue(value)) return value;
  const current = currentKey();
  if (!current) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current.key, iv);
  const plaintext = Buffer.from(JSON.stringify(value));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    v: 1,
    keyId: current.keyId,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptStateValue(value) {
  if (!isEncryptedStateValue(value)) return value;
  const key = keyForId(value.keyId);
  if (!key) throw new Error('Encrypted state cannot be read without the state credential');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}

export function encryptSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(encryptSensitiveFields);
  if (!value || typeof value !== 'object' || isEncryptedStateValue(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SECRET_FIELDS.has(key.toLowerCase()) && child !== undefined && child !== null && child !== ''
        ? encryptStateValue(child)
        : encryptSensitiveFields(child),
    ])
  );
}

export function decryptSensitiveFields(value) {
  if (isEncryptedStateValue(value)) return decryptStateValue(value);
  if (Array.isArray(value)) return value.map(decryptSensitiveFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, decryptSensitiveFields(child)]));
}
