import "../test-env.js";
/* c8 ignore start */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalKeyProvider, createKeyProvider } from "../../lib/key-provider.js";

let directory;

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-key-provider-'));
});

after(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
});

test('writes, reads, and rotates protected 32-byte keys', () => {
  const provider = new LocalKeyProvider(directory);
  const initial = 'a'.repeat(64);
  provider.put('state-v1', initial);
  assert.equal(provider.get('state-v1').value, initial);
  const rotated = provider.rotate('state-v1');
  assert.equal(rotated.keyId, 'state-v1');
  assert.notEqual(provider.get('state-v1').value, initial);
});

test('rejects invalid IDs, values, and permissive files', async () => {
  const provider = new LocalKeyProvider(directory);
  assert.throws(() => provider.put('../unsafe', 'a'.repeat(64)), /ID/);
  assert.throws(() => provider.put('bad', 'not-a-key'), /hexadecimal/);
  assert.throws(() => provider.put('bad', undefined), /hexadecimal/); // covers value || ''

  await fs.writeFile(path.join(directory, 'loose'), `${'b'.repeat(64)}\n`, { mode: 0o644 });
  assert.throws(() => provider.get('loose'), /permissive/);

  await fs.mkdir(path.join(directory, 'not-a-file'));
  assert.throws(() => provider.get('not-a-file'), /64-byte hexadecimal/);

  await fs.writeFile(path.join(directory, 'small'), 'a', { mode: 0o600 });
  assert.throws(() => provider.get('small'), /64-byte hexadecimal/);

  await fs.writeFile(path.join(directory, 'large'), 'a'.repeat(66), { mode: 0o600 });
  assert.throws(() => provider.get('large'), /64-byte hexadecimal/);

  await fs.writeFile(path.join(directory, 'invalid-hex'), 'z'.repeat(64), { mode: 0o600 });
  assert.throws(() => provider.get('invalid-hex'), /invalid/);
});

test('instantiates LocalKeyProvider with default directories', () => {
  const origKeyDir = process.env.MCP_KEY_DIRECTORY;
  const origCredDir = process.env.CREDENTIALS_DIRECTORY;

  delete process.env.MCP_KEY_DIRECTORY;
  delete process.env.CREDENTIALS_DIRECTORY;
  assert.equal(new LocalKeyProvider().directory, path.resolve('/etc/mcp-sentinel/credentials'));

  process.env.CREDENTIALS_DIRECTORY = '/tmp/cred';
  assert.equal(new LocalKeyProvider().directory, path.resolve('/tmp/cred'));

  process.env.MCP_KEY_DIRECTORY = '/tmp/mcp';
  assert.equal(new LocalKeyProvider().directory, path.resolve('/tmp/mcp'));

  /* c8 ignore next 4 */
  if (origKeyDir === undefined) delete process.env.MCP_KEY_DIRECTORY;
  else process.env.MCP_KEY_DIRECTORY = origKeyDir;
  if (origCredDir === undefined) delete process.env.CREDENTIALS_DIRECTORY;
  else process.env.CREDENTIALS_DIRECTORY = origCredDir;
});

test('loads a private, explicitly rooted external provider module', async () => {
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
    /* c8 ignore next 4 */
    if (previousRoot === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE_ROOT;
    else process.env.MCP_KEY_PROVIDER_MODULE_ROOT = previousRoot;
    if (previousModule === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE;
    else process.env.MCP_KEY_PROVIDER_MODULE = previousModule;
  }
});

test('handles options.provider directly', () => {
  const custom = { get: () => ({}), rotate: () => ({}) };
  assert.equal(createKeyProvider({ provider: custom }), custom);
  assert.ok(createKeyProvider({ provider: custom, mode: 'local' }) === custom);
});

test('defaults to LocalKeyProvider', () => {
  const provider = createKeyProvider({ directory });
  assert.ok(provider instanceof LocalKeyProvider);

  // Invalid provider objects should fall through the explicit options.provider branch
  const invalidCustom = { get: () => ({}) }; // missing rotate
  const provider2 = createKeyProvider({ provider: invalidCustom, directory });
  assert.ok(provider2 instanceof LocalKeyProvider);
});

test('rejects module providers with missing or invalid paths', () => {
  const previousRoot = process.env.MCP_KEY_PROVIDER_MODULE_ROOT;
  const previousModule = process.env.MCP_KEY_PROVIDER_MODULE;
  try {
    delete process.env.MCP_KEY_PROVIDER_MODULE;
    assert.throws(() => createKeyProvider({ mode: 'module' }), /MCP_KEY_PROVIDER_MODULE is required/);

    process.env.MCP_KEY_PROVIDER_MODULE_ROOT = '/some/root';
    process.env.MCP_KEY_PROVIDER_MODULE = '/other/path/module.cjs';
    assert.throws(() => createKeyProvider({ mode: 'module' }), /must be under the provider root/);
  } finally {
    /* c8 ignore next 4 */
    if (previousRoot === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE_ROOT;
    else process.env.MCP_KEY_PROVIDER_MODULE_ROOT = previousRoot;
    if (previousModule === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE;
    else process.env.MCP_KEY_PROVIDER_MODULE = previousModule;
  }
});

test('rejects symbolic links for provider modules', async () => {
  const moduleRoot = path.join(directory, 'providers-symlink');
  await fs.mkdir(moduleRoot, { mode: 0o700 });

  const targetFile = path.join(moduleRoot, 'target.cjs');
  await fs.writeFile(targetFile, 'module.exports = { get: () => ({}), rotate: () => ({}) };\n', { mode: 0o600 });

  const linkFile = path.join(moduleRoot, 'link.cjs');
  await fs.symlink(targetFile, linkFile);

  const previousRoot = process.env.MCP_KEY_PROVIDER_MODULE_ROOT;
  const previousModule = process.env.MCP_KEY_PROVIDER_MODULE;
  process.env.MCP_KEY_PROVIDER_MODULE_ROOT = moduleRoot;
  process.env.MCP_KEY_PROVIDER_MODULE = linkFile;
  try {
    assert.throws(() => createKeyProvider({ mode: 'module' }), /private regular file/);
  } finally {
    /* c8 ignore next 4 */
    if (previousRoot === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE_ROOT;
    else process.env.MCP_KEY_PROVIDER_MODULE_ROOT = previousRoot;
    if (previousModule === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE;
    else process.env.MCP_KEY_PROVIDER_MODULE = previousModule;
  }
});

test('supports factory functions and default exports for module providers', async () => {
  const moduleRoot = path.join(directory, 'providers-factories');
  await fs.mkdir(moduleRoot, { mode: 0o700 });

  const factoryFile = path.join(moduleRoot, 'factory.cjs');
  await fs.writeFile(
    factoryFile,
    'module.exports = { createKeyProvider: () => ({ get: () => ({}), rotate: () => ({}) }) };\n',
    { mode: 0o600 }
  );

  const defaultFile = path.join(moduleRoot, 'default.cjs');
  await fs.writeFile(defaultFile, 'module.exports = { default: { get: () => ({}), rotate: () => ({}) } };\n', {
    mode: 0o600,
  });

  const funcFile = path.join(moduleRoot, 'func.cjs');
  await fs.writeFile(funcFile, 'module.exports = () => ({ get: () => ({}), rotate: () => ({}) });\n', { mode: 0o600 });

  const invalidFile = path.join(moduleRoot, 'invalid.cjs');
  await fs.writeFile(invalidFile, 'module.exports = { get: () => ({}) };\n', { mode: 0o600 });

  const previousRoot = process.env.MCP_KEY_PROVIDER_MODULE_ROOT;
  const previousModule = process.env.MCP_KEY_PROVIDER_MODULE;
  process.env.MCP_KEY_PROVIDER_MODULE_ROOT = moduleRoot;
  try {
    process.env.MCP_KEY_PROVIDER_MODULE = factoryFile;
    assert.ok(createKeyProvider({ mode: 'module' }));

    process.env.MCP_KEY_PROVIDER_MODULE = defaultFile;
    assert.ok(createKeyProvider({ mode: 'module' }));

    process.env.MCP_KEY_PROVIDER_MODULE = funcFile;
    assert.ok(createKeyProvider({ mode: 'module' }));

    process.env.MCP_KEY_PROVIDER_MODULE = invalidFile;
    assert.throws(() => createKeyProvider({ mode: 'module' }), /Configured key provider must implement get and rotate/);
  } finally {
    /* c8 ignore next 4 */
    if (previousRoot === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE_ROOT;
    else process.env.MCP_KEY_PROVIDER_MODULE_ROOT = previousRoot;
    if (previousModule === undefined) delete process.env.MCP_KEY_PROVIDER_MODULE;
    else process.env.MCP_KEY_PROVIDER_MODULE = previousModule;
  }
});
/* c8 ignore stop */
