import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalKeyProvider, createKeyProvider } from '../lib/key-provider.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-key-provider-'));
after(() => fs.rm(directory, { recursive: true, force: true }));

describe('pluggable key provider contract', () => {
  it('writes, reads, and rotates protected 32-byte keys', () => {
    const provider = new LocalKeyProvider(directory);
    const initial = 'a'.repeat(64);
    provider.put('state-v1', initial);
    assert.equal(provider.get('state-v1').value, initial);
    const rotated = provider.rotate('state-v1');
    assert.equal(rotated.keyId, 'state-v1');
    assert.notEqual(provider.get('state-v1').value, initial);
  });

  it('rejects invalid IDs, values, and permissive files', async () => {
    const provider = new LocalKeyProvider(directory);
    assert.throws(() => provider.put('../unsafe', 'a'.repeat(64)), /ID/);
    assert.throws(() => provider.put('bad', 'not-a-key'), /hexadecimal/);
    await fs.writeFile(path.join(directory, 'loose'), `${'b'.repeat(64)}\n`, { mode: 0o644 });
    assert.throws(() => provider.get('loose'), /permissive/);
  });

  it('loads a private, explicitly rooted external provider module', async () => {
    const moduleRoot = path.join(directory, 'providers');
    await fs.mkdir(moduleRoot, { mode: 0o700 });
    const moduleFile = path.join(moduleRoot, 'test-provider.cjs');
    await fs.writeFile(
      moduleFile,
      "module.exports = { get: id => ({ keyId: id, value: 'c'.repeat(64) }), rotate: id => ({ keyId: id }) };\n",
      { mode: 0o600 }
    );
    const previousRoot = process.env.MCP_KEY_PROVIDER_MODULE_ROOT;
    const previousModule = process.env.MCP_KEY_PROVIDER_MODULE;
    process.env.MCP_KEY_PROVIDER_MODULE_ROOT = moduleRoot;
    process.env.MCP_KEY_PROVIDER_MODULE = moduleFile;
    try {
      assert.equal(createKeyProvider({ mode: 'module' }).get('state-v1').value, 'c'.repeat(64));
      await fs.chmod(moduleFile, 0o644);
      assert.throws(() => createKeyProvider({ mode: 'module' }), /private regular file/);
    } finally {
      if (previousRoot === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE_ROOT;
      else process.env.MCP_KEY_PROVIDER_MODULE_ROOT = previousRoot;
      if (previousModule === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE;
      else process.env.MCP_KEY_PROVIDER_MODULE = previousModule;
    }
  });
});
