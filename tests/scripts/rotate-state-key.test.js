import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/rotate-state-key.js', import.meta.url));

test('rotate-state-key.js', async t => {
  let stdoutWrites = [];
  const originalEnv = { ...process.env };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotate-state-test-'));
  const dbFile = path.join(tempDir, 'state.sqlite3');
  const credDir = path.join(tempDir, 'credentials');

  t.mock.method(process.stdout, 'write', data => {
    stdoutWrites.push(data);
  });

  t.beforeEach(() => {
    fs.mkdirSync(credDir, { recursive: true });

    const oldKey = crypto.randomBytes(32).toString('hex');
    const newKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(path.join(credDir, 'state-key'), newKey);
    fs.writeFileSync(path.join(credDir, 'state-key-old-v1'), oldKey);

    process.env.MCP_ROTATE_OFFLINE = 'true';
    process.env.MCP_STATE_DB = dbFile;
    process.env.CREDENTIALS_DIRECTORY = credDir;
    process.env.CONTROL_PLANE_KEY_ID = 'new-v2';
  });

  t.afterEach(() => {
    process.env = { ...originalEnv };
    stdoutWrites = [];
    mock.reset();
    try {
      fs.rmSync(dbFile);
    } catch (e) {
      void e;
    }
    try {
      fs.rmSync(credDir, { recursive: true });
    } catch (e) {
      void e;
    }
  });

  t.after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      void e;
    }
  });

  await t.test('throws if not offline', async () => {
    delete process.env.MCP_ROTATE_OFFLINE;
    await assert.rejects(
      () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
      /State-key rotation requires MCP_ROTATE_OFFLINE=true/
    );
  });

  await t.test('throws if new key ID missing', async () => {
    delete process.env.CONTROL_PLANE_KEY_ID;
    await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /CONTROL_PLANE_KEY_ID must name the new key/);
  });

  await t.test('throws if new key invalid', async () => {
    fs.writeFileSync(path.join(credDir, 'state-key'), 'invalid');
    await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /Current state-key credential is invalid/);
  });

  await t.test('rotates keys for tables', async () => {
    const db = new DatabaseSync(dbFile);
    db.exec(`
            CREATE TABLE approvals (id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);
            CREATE TABLE state_meta (key TEXT PRIMARY KEY, value TEXT);
        `);

    const oldKeyHex = fs.readFileSync(path.join(credDir, 'state-key-old-v1'), 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(oldKeyHex, 'hex'), iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from('secret payload')), cipher.final()]);

    const encryptedPayload = {
      v: 1,
      keyId: 'old-v1',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };

    db.prepare('INSERT INTO approvals (id, payload) VALUES (?, ?)').run(
      'app-1',
      JSON.stringify({
        some_field: 'public',
        nested: [encryptedPayload],
        null_field: null,
      })
    );
    db.close();

    await import(`${SCRIPT_PATH}?t=${Date.now()}`);

    const resultDb = new DatabaseSync(dbFile);
    const rotated = resultDb.prepare('SELECT payload FROM approvals WHERE id = ?').get('app-1');
    const parsed = JSON.parse(rotated.payload);

    assert.equal(parsed.nested[0].keyId, 'new-v2');
    assert.equal(parsed.null_field, null);
    assert.equal(parsed.some_field, 'public');

    const newKeyHex = fs.readFileSync(path.join(credDir, 'state-key'), 'utf8');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(newKeyHex, 'hex'),
      Buffer.from(parsed.nested[0].iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(parsed.nested[0].tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.nested[0].ciphertext, 'base64')),
      decipher.final(),
    ]);

    assert.equal(plaintext.toString(), 'secret payload');
    resultDb.close();

    assert.equal(stdoutWrites.length, 1);
    const output = JSON.parse(stdoutWrites[0]);
    assert.equal(output.rotated, true);
    assert.equal(output.records, 1);
  });

  await t.test('handles rollback on error', async t => {
    const db = new DatabaseSync(dbFile);
    db.exec(`CREATE TABLE approvals (id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);`);
    db.prepare('INSERT INTO approvals (id, payload) VALUES (?, ?)').run(
      'app-1',
      JSON.stringify({
        v: 1,
        keyId: 'invalid-id!', // Will cause error in keyFor
        iv: 'AAA=',
        tag: 'AAA=',
        ciphertext: 'AAA=',
      })
    );
    db.close();

    await assert.rejects(() => import(`${SCRIPT_PATH}?t=${Date.now()}`), /Invalid stored key ID 'invalid-id!'/);
  });

  await t.test('throws if archived key invalid', async t => {
    fs.writeFileSync(path.join(credDir, 'state-key-bad-archived'), 'invalid');
    const db = new DatabaseSync(dbFile);
    db.exec(`CREATE TABLE approvals (id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT);`);
    db.prepare('INSERT INTO approvals (id, payload) VALUES (?, ?)').run(
      'app-1',
      JSON.stringify({
        v: 1,
        keyId: 'bad-archived',
        iv: 'AAA=',
        tag: 'AAA=',
        ciphertext: 'AAA=',
      })
    );
    db.close();

    await assert.rejects(
      () => import(`${SCRIPT_PATH}?t=${Date.now()}`),
      /Archived state key 'bad-archived' is invalid/
    );
  });
});
