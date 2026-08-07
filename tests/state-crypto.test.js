import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const originalEnv = { ...process.env };

function setupEnv() {
  process.env = { ...originalEnv };
  // Provide a valid key so `currentKey()` does not throw before we test decryptStateValue
  process.env.CONTROL_PLANE_KEY_ID = 'state-v1';
  process.env.CONTROL_PLANE_KEY = 'a'.repeat(64);
}

test('state-crypto tests', async (t) => {
  mock.module('../lib/key-provider.js', {
    namedExports: {
      createKeyProvider: () => {
        return {
          get: (id) => {
            if (id === 'state-v1') return { value: undefined };
            if (id === 'archived-key-invalid') return { value: 'bad' };
            if (id === 'archived-key-valid') return { value: 'b'.repeat(64) };
            if (id === 'throw-error') throw new Error('Provider Error');
            throw new Error('Not found');
          }
        }
      }
    }
  });

  const stateCrypto = await import('../lib/state-crypto.js?' + Date.now());

  await t.test('currentKey throws in production if missing', () => {
    setupEnv();
    process.env.NODE_ENV = 'production';
    delete process.env.CONTROL_PLANE_KEY_ID;
    delete process.env.CONTROL_PLANE_KEY;
    delete process.env.CREDENTIALS_DIRECTORY;
    delete process.env.MCP_KEY_DIRECTORY;
    
    assert.throws(() => stateCrypto.stateEncryptionConfigured(), /Production state encryption credential is missing/);
  });

  await t.test('currentKey catches error and rethrows in production', () => {
    setupEnv();
    process.env.NODE_ENV = 'production';
    process.env.CONTROL_PLANE_KEY_ID = 'throw-error';
    delete process.env.CONTROL_PLANE_KEY;
    
    assert.throws(() => stateCrypto.stateEncryptionConfigured(), /Provider Error/);
  });

  await t.test('currentKey catches error and returns null in non-production', () => {
    setupEnv();
    process.env.NODE_ENV = 'development';
    process.env.CONTROL_PLANE_KEY_ID = 'throw-error';
    delete process.env.CONTROL_PLANE_KEY;
    
    assert.equal(stateCrypto.stateEncryptionConfigured(), false);
  });

  await t.test('currentKey throws if keyHex is invalid length/format', () => {
    setupEnv();
    process.env.CONTROL_PLANE_KEY = 'bad';
    assert.throws(() => stateCrypto.stateEncryptionConfigured(), /must contain 64 hexadecimal characters/);
  });

  await t.test('currentKey throws if keyId is invalid', () => {
    setupEnv();
    process.env.CONTROL_PLANE_KEY_ID = 'invalid/key';
    assert.throws(() => stateCrypto.stateEncryptionConfigured(), /CONTROL_PLANE_KEY_ID is invalid/);
  });

  await t.test('keyForId with MCP_KEY_PROVIDER !== local (invalid key)', () => {
    setupEnv();
    process.env.MCP_KEY_PROVIDER = 'module';
    const encValue = {
      v: 1,
      keyId: 'archived-key-invalid',
      iv: 'dummy',
      tag: 'dummy',
      ciphertext: 'dummy'
    };
    assert.throws(() => stateCrypto.decryptStateValue(encValue), /Archived state key 'archived-key-invalid' is invalid/);
  });

  await t.test('keyForId with MCP_KEY_PROVIDER !== local (valid key)', () => {
    setupEnv();
    process.env.MCP_KEY_PROVIDER = 'module';
    const encValue = {
      v: 1,
      keyId: 'archived-key-valid',
      iv: Buffer.alloc(12).toString('base64'),
      tag: Buffer.alloc(16).toString('base64'),
      ciphertext: Buffer.alloc(10).toString('base64')
    };
    assert.throws(() => stateCrypto.decryptStateValue(encValue), /Unsupported state or unable to authenticate data/);
  });

  await t.test('keyForId with local provider, no directory', () => {
    setupEnv();
    delete process.env.CREDENTIALS_DIRECTORY;
    delete process.env.MCP_KEY_PROVIDER;
    const encValue = { v: 1, keyId: 'archived-key', iv: 'd', tag: 'd', ciphertext: 'd' };
    assert.throws(() => stateCrypto.decryptStateValue(encValue), /Archived state key 'archived-key' is unavailable/);
  });

  await t.test('keyForId with local provider, with directory (invalid key)', () => {
    setupEnv();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-crypto-'));
    process.env.CREDENTIALS_DIRECTORY = dir;
    delete process.env.MCP_KEY_PROVIDER;
    fs.writeFileSync(path.join(dir, 'state-key-archived-key'), 'bad');
    const encValue = { v: 1, keyId: 'archived-key', iv: 'd', tag: 'd', ciphertext: 'd' };
    try {
      assert.throws(() => stateCrypto.decryptStateValue(encValue), /Archived state key 'archived-key' is invalid/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('keyForId with local provider, with directory (valid key)', () => {
    setupEnv();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-crypto-'));
    process.env.CREDENTIALS_DIRECTORY = dir;
    delete process.env.MCP_KEY_PROVIDER;
    fs.writeFileSync(path.join(dir, 'state-key-archived-key'), 'b'.repeat(64));
    const encValue = { v: 1, keyId: 'archived-key', 
      iv: Buffer.alloc(12).toString('base64'), 
      tag: Buffer.alloc(16).toString('base64'), 
      ciphertext: Buffer.alloc(10).toString('base64') 
    };
    try {
      assert.throws(() => stateCrypto.decryptStateValue(encValue), /Unsupported state or unable to authenticate data/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('encryptStateValue when not configured', () => {
    setupEnv();
    process.env.CONTROL_PLANE_KEY_ID = 'state-v1';
    delete process.env.CONTROL_PLANE_KEY;
    const val = 'test';
    assert.equal(stateCrypto.encryptStateValue(val), val);
  });

  await t.test('encryptStateValue on already encrypted value', () => {
    setupEnv();
    const val = 'test';
    const encrypted = stateCrypto.encryptStateValue(val);
    assert.equal(stateCrypto.encryptStateValue(encrypted), encrypted);
  });

  await t.test('decryptStateValue when not configured', () => {
    setupEnv();
    process.env.CONTROL_PLANE_KEY_ID = 'state-v1';
    delete process.env.CONTROL_PLANE_KEY;
    const encValue = { v: 1, keyId: 'archived-key', iv: 'd', tag: 'd', ciphertext: 'd' };
    assert.throws(() => stateCrypto.decryptStateValue(encValue), /Encrypted state cannot be read without the state credential/);
  });

  await t.test('decryptStateValue on unencrypted value', () => {
    setupEnv();
    const val = 'unencrypted';
    assert.equal(stateCrypto.decryptStateValue(val), val);
  });

  await t.test('encryptSensitiveFields and decryptSensitiveFields', () => {
    setupEnv();
    const val = {
      password: 'my-password',
      normal: 'plaintext',
      nested: {
        token: 'my-token',
        empty: '',
        nullVal: null,
        undef: undefined
      },
      arr: [{ secret: 'arr-secret' }]
    };
    const encrypted = stateCrypto.encryptSensitiveFields(val);
    assert.equal(encrypted.normal, 'plaintext');
    assert.ok(stateCrypto.isEncryptedStateValue(encrypted.password));
    assert.ok(stateCrypto.isEncryptedStateValue(encrypted.nested.token));
    assert.equal(encrypted.nested.empty, '');
    assert.equal(encrypted.nested.nullVal, null);
    assert.equal(encrypted.nested.undef, undefined);
    assert.ok(stateCrypto.isEncryptedStateValue(encrypted.arr[0].secret));

    const decrypted = stateCrypto.decryptSensitiveFields(encrypted);
    assert.deepEqual(decrypted, val);

    // Also test null/non-object values
    assert.equal(stateCrypto.encryptSensitiveFields(null), null);
    assert.equal(stateCrypto.encryptSensitiveFields('string'), 'string');
    assert.equal(stateCrypto.decryptSensitiveFields(null), null);
    assert.equal(stateCrypto.decryptSensitiveFields('string'), 'string');

    // Test already encrypted values
    const alreadyEncrypted = stateCrypto.encryptStateValue('double');
    assert.equal(stateCrypto.encryptSensitiveFields(alreadyEncrypted), alreadyEncrypted);
    assert.equal(stateCrypto.decryptSensitiveFields(alreadyEncrypted), 'double');
  });
});
