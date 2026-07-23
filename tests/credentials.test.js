import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { loadCredentialSecret } from '../lib/credentials.js';

const originalDirectory = process.env.CREDENTIALS_DIRECTORY;
const originalSecret = process.env.TEST_CREDENTIAL_SECRET;

afterEach(() => {
  if (originalDirectory === undefined) delete process.env.CREDENTIALS_DIRECTORY;
  else process.env.CREDENTIALS_DIRECTORY = originalDirectory;
  if (originalSecret === undefined) delete process.env.TEST_CREDENTIAL_SECRET;
  else process.env.TEST_CREDENTIAL_SECRET = originalSecret;
});

describe('systemd credential loading', () => {
  it('prefers an explicit development environment value', () => {
    process.env.TEST_CREDENTIAL_SECRET = 'development-secret';
    delete process.env.CREDENTIALS_DIRECTORY;
    assert.equal(loadCredentialSecret('TEST_CREDENTIAL_SECRET', 'test-key'), 'development-secret');
  });

  it('reads a bounded credential without following symlinks', async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mcp-credentials-'));
    process.env.CREDENTIALS_DIRECTORY = directory;
    delete process.env.TEST_CREDENTIAL_SECRET;
    await fsPromises.writeFile(path.join(directory, 'test-key'), 'credential-value\n', { mode: 0o600 });
    assert.equal(loadCredentialSecret('TEST_CREDENTIAL_SECRET', 'test-key'), 'credential-value');

    await fsPromises.rm(path.join(directory, 'test-key'));
    await fsPromises.symlink('/etc/passwd', path.join(directory, 'test-key'));
    assert.throws(() => loadCredentialSecret('TEST_CREDENTIAL_SECRET', 'test-key'), /symbolic link|ELOOP/i);
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  it('rejects empty and oversized credential files', async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mcp-credentials-'));
    process.env.CREDENTIALS_DIRECTORY = directory;
    delete process.env.TEST_CREDENTIAL_SECRET;
    const credential = path.join(directory, 'test-key');
    await fsPromises.writeFile(credential, '');
    assert.throws(() => loadCredentialSecret('TEST_CREDENTIAL_SECRET', 'test-key'), /bounded regular file/);
    fs.truncateSync(credential, 64 * 1024 + 1);
    assert.throws(() => loadCredentialSecret('TEST_CREDENTIAL_SECRET', 'test-key'), /bounded regular file/);
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  it('loads JWT and audit signing keys through the production credential directory', async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mcp-production-credentials-'));
    await fsPromises.writeFile(path.join(directory, 'jwt-key'), 'a'.repeat(64), { mode: 0o600 });
    await fsPromises.writeFile(path.join(directory, 'audit-key'), 'b'.repeat(64), { mode: 0o600 });
    const environment = {
      ...process.env,
      CREDENTIALS_DIRECTORY: directory,
      KEYSTORE_FILE: path.join(directory, 'keys.json'),
      CONTROL_PLANE_STATE_FILE: path.join(directory, 'state.json'),
      JWT_REVOCATION_FILE: path.join(directory, 'revocations.json'),
      AUDIT_LOG_DIR: path.join(directory, 'logs'),
      OAUTH_RESOURCE_URL: 'https://mcp.example.test',
    };
    delete environment.JWT_SECRET;
    delete environment.AUDIT_HMAC_KEY;
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "const security = await import('./security.js'); console.log(security.jwtSecretIsConfigured())",
      ],
      { cwd: path.resolve('.'), env: environment, encoding: 'utf8' }
    );
    assert.equal(output.trim(), 'true');

    await fsPromises.writeFile(path.join(directory, 'audit-key'), 'invalid', { mode: 0o600 });
    assert.throws(
      () =>
        execFileSync(process.execPath, ['--input-type=module', '--eval', "await import('./audit.js')"], {
          cwd: path.resolve('.'),
          env: environment,
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      error => error.stderr.includes('Audit HMAC credential must contain exactly 32 bytes')
    );
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  it('refuses a random audit-chain key when production credentials are absent', async () => {
    const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'mcp-audit-missing-'));
    const environment = {
      ...process.env,
      NODE_ENV: 'production',
      AUDIT_LOG_DIR: path.join(directory, 'logs'),
    };
    delete environment.CREDENTIALS_DIRECTORY;
    delete environment.AUDIT_HMAC_KEY;
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ['--input-type=module', '--eval', `await import('./audit.js?missing=${Date.now()}')`],
          { cwd: path.resolve('.'), env: environment, encoding: 'utf8', stdio: 'pipe' }
        ),
      error => error.stderr.includes('Audit HMAC credential must contain exactly 32 bytes')
    );
    await fsPromises.rm(directory, { recursive: true, force: true });
  });
});
