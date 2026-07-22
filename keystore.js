import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_FILE = path.join(__dirname, 'keys.json');

let keyStore = {};

export async function loadKeystore() {
  try {
    const data = await fs.readFile(KEYS_FILE, 'utf8');
    keyStore = JSON.parse(data);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Error reading keys.json:', err.message);
    keyStore = {};
  }
}

async function saveKeystore() {
  await fs.writeFile(KEYS_FILE, JSON.stringify(keyStore, null, 2), { mode: 0o600 });
}

export function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function addKeyEntry(key, entryData) {
  const hash = hashKey(key);
  keyStore[hash] = {
    keyId: crypto.randomUUID(),
    version: 1,
    createdAt: new Date().toISOString(),
    ...entryData,
  };
  await saveKeystore();
  return keyStore[hash];
}

export async function revokeKeyEntry(key) {
  const hash = hashKey(key);
  if (keyStore[hash] && keyStore[hash].active !== false) {
    keyStore[hash].active = false;
    keyStore[hash].version++;
    await saveKeystore();
    return true;
  }
  return false;
}

export function getKeyEntry(key) {
  const hash = hashKey(key);
  return keyStore[hash];
}

export function getKeyById(keyId) {
  return Object.values(keyStore).find(k => k.keyId === keyId);
}

export function getKeys() {
  return Object.values(keyStore).map(({ active, createdAt, role, userId, scopes, label, keyId }) => ({
    keyId,
    active,
    createdAt,
    role,
    userId,
    scopes,
    label
  }));
}
