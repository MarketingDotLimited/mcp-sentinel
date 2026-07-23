import path from 'path';

export const MAX_RELEASE_ENTRIES = 20_000;
export const MAX_RELEASE_EXPANDED_BYTES = 1024 * 1024 * 1024;

export function parseEnvironment(contents) {
  const values = {};
  for (const [index, sourceLine] of contents.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`Invalid environment entry on line ${index + 1}`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid environment key on line ${index + 1}`);
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate environment key '${key}'`);
    values[key] = line.slice(separator + 1).trim();
  }
  return values;
}

export function validateReleaseManifest(manifest, artifactName, artifactHash) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid release manifest');
  const keys = Object.keys(manifest).sort();
  if (keys.join(',') !== 'artifact,commit,sha256,version') throw new Error('Release manifest contains unknown fields');
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(manifest.version)) throw new Error('Invalid release version');
  if (!/^[a-f0-9]{40}$/i.test(manifest.commit)) throw new Error('Invalid release commit');
  if (!/^[a-f0-9]{64}$/i.test(manifest.sha256) || manifest.sha256 !== artifactHash)
    throw new Error('Release artifact hash does not match the signed manifest');
  if (manifest.artifact !== artifactName) throw new Error('Release artifact name does not match the signed manifest');
  return `${manifest.version}-${manifest.commit.slice(0, 12)}`;
}

export function validateSigningFingerprint(actual, expectedContents) {
  const expected = String(expectedContents || '')
    .trim()
    .replaceAll(' ', '')
    .toUpperCase();
  const normalizedActual = String(actual || '')
    .trim()
    .toUpperCase();
  if (!/^[A-F0-9]{40}(?:[A-F0-9]{24})?$/.test(expected))
    throw new Error('Trusted release signing fingerprint must contain 40 or 64 hexadecimal characters');
  if (normalizedActual !== expected) throw new Error('Release signature was made by an untrusted key');
  return expected;
}

export function parseValidSignatureFingerprint(statusOutput) {
  const payload = String(statusOutput || '').match(/^\[GNUPG:\] VALIDSIG (.+)$/m)?.[1];
  if (!payload) throw new Error('No valid release signature status was returned');
  const fields = payload.trim().split(/\s+/);
  const signingFingerprint = fields[0]?.toUpperCase();
  const primaryFingerprint = fields.at(-1)?.toUpperCase();
  if (!/^[A-F0-9]{40}(?:[A-F0-9]{24})?$/.test(signingFingerprint || ''))
    throw new Error('Release signature status contains an invalid signing fingerprint');
  return /^[A-F0-9]{40}(?:[A-F0-9]{24})?$/.test(primaryFingerprint || '') ? primaryFingerprint : signingFingerprint;
}

export function validateArchiveEntries(entries, version) {
  const prefix = `mcp-sentinel-${version}/`;
  if (!entries.length) throw new Error('Release archive is empty');
  if (entries.length > MAX_RELEASE_ENTRIES) throw new Error('Release archive contains too many entries');
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || entry.startsWith('/') || entry.includes('\0'))
      throw new Error(`Unsafe release archive entry '${entry}'`);
    const normalized = path.posix.normalize(entry);
    if (entry.split('/').includes('..') || normalized === '..' || normalized.startsWith('../'))
      throw new Error(`Release archive entry escapes its version root: '${entry}'`);
  }
  return prefix;
}

export function validateArchiveListing(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Release archive listing is empty');
  if (lines.length > MAX_RELEASE_ENTRIES) throw new Error('Release archive contains too many entries');
  let expandedBytes = 0;
  for (const line of lines) {
    const match = String(line).match(/^([-d])\S*\s+\S+\/\S+\s+(\d+)\s+/);
    if (!match) throw new Error('Release archive contains an unsupported entry or listing format');
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Release archive contains an invalid file size');
    expandedBytes += size;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > MAX_RELEASE_EXPANDED_BYTES)
      throw new Error('Release archive expands beyond the permitted size');
  }
  return { entries: lines.length, expandedBytes };
}
