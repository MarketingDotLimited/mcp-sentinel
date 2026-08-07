import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";

describe('keystore rollbacks', async () => {
  let tmpDir;
  
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-keystore-rollback-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loadKeystore rollback', async () => {
    const keysFile = path.join(tmpDir, 'api-keys.json');
    const dbFile = path.join(tmpDir, 'state.sqlite3');
    await fs.writeFile(keysFile, JSON.stringify({
      hash1: { keyId: 'throw-me' }
    }));
    
    process.env.KEYSTORE_FILE = keysFile;
    process.env.MCP_STATE_DB = dbFile;
    
    const keystore = await import(`../keystore.js?test=${Date.now()}`);
    
    const originalStringify = JSON.stringify;
    JSON.stringify = function(val) {
      if (val && val.keyId === 'throw-me') throw new Error('fake stringify error');
      return originalStringify(val);
    };
    
    try {
      await keystore.loadKeystore();
      assert.fail('should have thrown');
    } catch(err) {
      assert.match(err.message, /fake stringify error/);
    } finally {
      JSON.stringify = originalStringify;
    }
  });

  it('saveKeystore rollback', async () => {
    const keysFile = path.join(tmpDir, 'api-keys2.json');
    const dbFile = path.join(tmpDir, 'state2.sqlite3');
    await fs.writeFile(keysFile, JSON.stringify({}));
    
    process.env.KEYSTORE_FILE = keysFile;
    process.env.MCP_STATE_DB = dbFile;
    
    const keystore = await import(`../keystore.js?test=${Date.now()}`);
    await keystore.loadKeystore(); 
    
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbFile);
    db.exec('DROP TABLE api_keys');
    db.close();
    
    await assert.rejects(keystore.addKeyEntry('new-key', {}), /no such table: api_keys/);
  });

  it('legacy mode success', async () => {
    const keysFile = path.join(tmpDir, 'api-keys-legacy.json');
    await fs.writeFile(keysFile, JSON.stringify({
      hash1: { keyId: 'legacy-success' }
    }));
    
    process.env.KEYSTORE_FILE = keysFile;
    delete process.env.MCP_STATE_DB; // Enable legacy mode
    
    const keystore = await import(`../keystore.js?test=${Date.now()}`);
    await keystore.loadKeystore();
  });

  it('legacy mode throw non-ENOENT', async () => {
    const keysFile = path.join(tmpDir, 'api-keys-legacy-err.json');
    await fs.writeFile(keysFile, 'invalid-json'); // This will throw SyntaxError on parse
    
    process.env.KEYSTORE_FILE = keysFile;
    delete process.env.MCP_STATE_DB; // Enable legacy mode
    
    const keystore = await import(`../keystore.js?test=${Date.now()}`);
    await assert.rejects(keystore.loadKeystore(), /Unable to load keystore/);
  });
});


describe('keystore.js branches', async () => {
  it('covers missing branches', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-ks-b-'));
    const keysFile = path.join(tmp, 'keys.json');
    const dbFile = path.join(tmp, 'state.sqlite');

    // line 36
    process.env.KEYSTORE_FILE = keysFile;
    delete process.env.MCP_STATE_DB;
    await fs.writeFile(keysFile, '[]');
    let keystore = await import(`../keystore.js?test=${Date.now()}`);
    await assert.rejects(keystore.loadKeystore(), /Unable to load keystore/);

    // line 51
    process.env.MCP_STATE_DB = dbFile;
    await fs.writeFile(keysFile, '[]');
    keystore = await import(`../keystore.js?test=${Date.now()}`);
    await assert.rejects(keystore.loadKeystore(), /API key migration failed/);
    
    // reset
    await fs.rm(dbFile, { force: true });
    await fs.rm(keysFile, { force: true });
    
    keystore = await import(`../keystore.js?test=${Date.now()}`);
    await keystore.loadKeystore();
    
    const key = await keystore.addKeyEntry('testkey', { role: 'admin' });
    
    // line 109
    await assert.rejects(keystore.addKeyEntry('testkey', { role: 'admin' }), /already exists/);

    // line 162
    // manually manipulate keyStore to have non-array projectIds
    // We can't access keyStore directly, so let's just add one
    await keystore.addKeyEntry('testkey2', { role: 'admin', projectIds: 'not-array' });
    const keys = keystore.getKeys();
    assert.deepEqual(keys.find(k => k.keyId === key.keyId).projectIds, []);

    // line 172
    await keystore.revokeKeyEntryById(key.keyId);
    await assert.rejects(keystore.updateKeyEntry(key.keyId, { label: 'foo' }), /Cannot update a revoked key/);
  });
});

describe('keystore.js missing branches part 2', async () => {
  let tmpDir;
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-ks-b2-'));
  });
  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('covers migration branch with missing keyId', async () => {
    const keysFile = path.join(tmpDir, 'keys.json');
    const dbFile = path.join(tmpDir, 'state.sqlite');
    
    // line 58: migration with missing keyId
    process.env.KEYSTORE_FILE = keysFile;
    process.env.MCP_STATE_DB = dbFile;
    await fs.writeFile(keysFile, JSON.stringify({
      hash_without_id: { role: 'admin' }
    }));
    let keystore = await import(`../keystore.js?test=${Date.now()}`);
    await keystore.loadKeystore();
  });

  it('covers getKeys with array projectIds', async () => {
    const keysFile = path.join(tmpDir, 'keys2.json');
    const dbFile = path.join(tmpDir, 'state2.sqlite');
    process.env.KEYSTORE_FILE = keysFile;
    process.env.MCP_STATE_DB = dbFile;
    let keystore = await import(`../keystore.js?test=${Date.now()}`);
    await keystore.loadKeystore();

    // line 162: getKeys with array projectIds
    await keystore.addKeyEntry('array-project-ids', { role: 'admin', projectIds: ['p1'] });
    const keys = keystore.getKeys();
    assert.deepEqual(keys.find(k => k.projectIds?.includes('p1'))?.projectIds, ['p1']);
  });
});
