import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalKeyProvider } from '../lib/key-provider.js';

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
});
