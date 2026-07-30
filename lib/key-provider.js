import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

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

export function createKeyProvider(options = {}) {
  if (options.provider && typeof options.provider.get === 'function' && typeof options.provider.rotate === 'function')
    return options.provider;
  return new LocalKeyProvider(options.directory);
}
