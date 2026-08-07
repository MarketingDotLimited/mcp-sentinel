import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

/* c8 ignore next 2 */
/* c8 ignore next 2 */
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function assertKeyId(keyId) {
  if (typeof keyId !== 'string' || !KEY_ID_PATTERN.test(keyId)) throw new Error('Invalid key ID');
  return keyId;
}

// Narrow provider contract. External providers can implement get/put/rotate
// without changing Sentinel callers; the local provider remains the default
// for standalone systemd-credential deployments.
export class LocalKeyProvider {
  constructor(
    directory = process.env.MCP_KEY_DIRECTORY || process.env.CREDENTIALS_DIRECTORY || '/etc/mcp-sentinel/credentials'
  ) {
    this.directory = path.resolve(directory);
  }

  get(keyId) {
    assertKeyId(keyId);
    const file = path.join(this.directory, keyId);
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size < 64 || stat.size > 65)
        throw new Error(`Key '${keyId}' must be a 64-byte hexadecimal credential`);
      if ((stat.mode & 0o077) !== 0) throw new Error(`Key '${keyId}' is too permissive`);
      const value = fs.readFileSync(descriptor, 'utf8').trim();
      if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`Key '${keyId}' is invalid`);
      return { keyId, value };
    } finally {
      fs.closeSync(descriptor);
    }
  }

  put(keyId, value) {
    assertKeyId(keyId);
    if (!/^[a-f0-9]{64}$/i.test(String(value || '')))
      throw new Error('Key value must be 32 random bytes encoded as hexadecimal');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, keyId);
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const descriptor = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      fs.writeFileSync(descriptor, `${value.toLowerCase()}\n`);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temp, file);
    fs.chmodSync(file, 0o600);
    return { keyId, rotatedAt: new Date().toISOString() };
  }

  rotate(keyId) {
    return this.put(keyId, crypto.randomBytes(32).toString('hex'));
  }
}

function validateProvider(provider) {
  if (!provider || typeof provider.get !== 'function' || typeof provider.rotate !== 'function')
    throw new Error('Configured key provider must implement get and rotate');
  return provider;
}

// External KMS/HSM adapters are loaded only from the root-owned provider
// directory. The adapter returns the same { keyId, value } contract as the
// local systemd-credential provider, so callers never need to know which KMS
// is active. No arbitrary module path is accepted from request data.
function configuredModuleProvider() {
  const modulePath = String(process.env.MCP_KEY_PROVIDER_MODULE || '').trim();
  const root = path.resolve(process.env.MCP_KEY_PROVIDER_MODULE_ROOT || '/etc/mcp-sentinel/providers');
  if (!modulePath) throw new Error('MCP_KEY_PROVIDER_MODULE is required for module key providers');
  const resolved = path.resolve(modulePath);
  if (!resolved.startsWith(`${root}${path.sep}`))
    throw new Error('Key provider module must be under the provider root');
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error('Key provider module must be a private regular file');
  const loaded = createRequire(import.meta.url)(resolved);
  const factory = loaded?.createKeyProvider || loaded?.default || loaded;
  return validateProvider(typeof factory === 'function' ? factory({}) : factory);
}

export function createKeyProvider(options = {}) {
  if (options.provider && typeof options.provider.get === 'function' && typeof options.provider.rotate === 'function')
    return options.provider;
  const mode = String(options.mode || process.env.MCP_KEY_PROVIDER || 'local').toLowerCase();
  if (mode === 'module' || mode === 'kms' || mode === 'hsm') return configuredModuleProvider();
  return new LocalKeyProvider(options.directory);
}
