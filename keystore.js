import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_FILE = process.env.KEYSTORE_FILE || path.join(__dirname, 'keys.json');

let keyStore = {};

export async function loadKeystore() {
  try {
    const data = await fs.readFile(KEYS_FILE, 'utf8');
    const parsed = JSON.parse(data);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('keys.json must contain an object');
    }
    keyStore = parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      keyStore = {};
      return;
    }
    throw new Error(`Unable to load keystore: ${err.message}`);
  }
}

async function saveKeystore() {
  await fs.writeFile(KEYS_FILE, JSON.stringify(keyStore, null, 2), { mode: 0o600 });
  await fs.chmod(KEYS_FILE, 0o600);
}

export function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export async function addKeyEntry(key, entryData) {
  const hash = hashKey(key);
  if (keyStore[hash]) {
    throw new Error('An entry for this API key already exists');
  }
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

export async function revokeKeyEntryById(keyId) {
  const entry = Object.values(keyStore).find(candidate => candidate.keyId === keyId);
  if (!entry || entry.active === false) return false;
  entry.active = false;
  entry.version++;
  await saveKeystore();
  return true;
}

export function getKeyEntry(key) {
  const hash = hashKey(key);
  return keyStore[hash];
}

export function getKeyById(keyId) {
  return Object.values(keyStore).find(k => k.keyId === keyId);
}

export function getKeys() {
  return Object.values(keyStore).map(
    ({
      active,
      createdAt,
      role,
      userId,
      scopes,
      label,
      keyId,
      requireApproval,
      projectIds,
      organizationId,
      teamId,
    }) => ({
      keyId,
      active,
      createdAt,
      role,
      userId,
      scopes,
      label,
      requireApproval: requireApproval === true,
      projectIds: Array.isArray(projectIds) ? projectIds : [],
      organizationId: organizationId || null,
      teamId: teamId || null,
    })
  );
}
