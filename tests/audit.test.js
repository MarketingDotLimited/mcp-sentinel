import test, { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

function importAuditModule(env = {}) {
  const originalEnv = { ...process.env };
  Object.assign(process.env, env);
  const m = import(`../audit.js?t=${Date.now()}${Math.random()}`);
  return m
    .then(mod => {
      process.env = originalEnv;
      return mod;
    })
    .catch(err => {
      process.env = originalEnv;
      throw err;
    });
}

describe('Audit Module', () => {
  let tmpDir;
  let logDir;
  let checkpointFile;
  const validHmac = 'a'.repeat(64);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-test-'));
    logDir = path.join(tmpDir, 'logs');
    checkpointFile = path.join(tmpDir, 'audit-chain.json');
    // Ensure fresh state
    delete process.env.NODE_ENV;
    delete process.env.AUDIT_HMAC_KEY;
    delete process.env.CREDENTIALS_DIRECTORY;
  });

  it('creates log directory if it does not exist', async () => {
    const audit = await importAuditModule({ AUDIT_LOG_DIR: logDir, AUDIT_CONSOLE: 'false' });
    assert.strictEqual(fs.existsSync(logDir), true);
  });

  it('throws on invalid HMAC key', async () => {
    await assert.rejects(
      importAuditModule({ AUDIT_HMAC_KEY: 'invalid' }),
      /must contain exactly 32 bytes encoded as hexadecimal/
    );
  });

  it('loads valid HMAC and handles missing checkpoint (ENOENT)', async () => {
    const audit = await importAuditModule({
      AUDIT_HMAC_KEY: validHmac,
      AUDIT_LOG_DIR: logDir,
      AUDIT_CHECKPOINT_FILE: checkpointFile,
      AUDIT_CONSOLE: 'false',
    });
    const status = audit.getAuditChainStatus();
    assert.strictEqual(status.sequence, 0);
    assert.strictEqual(status.protection, 'hmac-checkpointed');
  });

  it('throws on non-ENOENT checkpoint read error', async () => {
    fs.mkdirSync(checkpointFile); // Create dir so readFileSync throws EISDIR
    await assert.rejects(
      importAuditModule({
        AUDIT_HMAC_KEY: validHmac,
        AUDIT_LOG_DIR: logDir,
        AUDIT_CHECKPOINT_FILE: checkpointFile,
      }),
      /Invalid audit checkpoint:/
    );
  });

  it('throws when checkpoint exists but log missing', async () => {
    fs.writeFileSync(checkpointFile, JSON.stringify({ seqNo: 1, hash: 'b'.repeat(64) }));
    fs.mkdirSync(logDir); // Log dir exists, but empty
    await assert.rejects(
      importAuditModule({
        AUDIT_HMAC_KEY: validHmac,
        AUDIT_LOG_DIR: logDir,
        AUDIT_CHECKPOINT_FILE: checkpointFile,
      }),
      /Audit checkpoint exists but the audit log is missing/
    );
  });

  it('throws when log exists but does not match checkpoint', async () => {
    fs.writeFileSync(checkpointFile, JSON.stringify({ seqNo: 1, hash: 'b'.repeat(64) }));
    fs.mkdirSync(logDir);
    fs.writeFileSync(
      path.join(logDir, 'audit-2023-01-01.log'),
      JSON.stringify({ seqNo: 2, hash: 'c'.repeat(64) }) + '\n'
    );
    await assert.rejects(
      importAuditModule({
        AUDIT_HMAC_KEY: validHmac,
        AUDIT_LOG_DIR: logDir,
        AUDIT_CHECKPOINT_FILE: checkpointFile,
      }),
      /does not match the durable audit log tail/
    );
  });

  it('loads checkpoint and verifies uncompressed log tail', async () => {
    fs.writeFileSync(checkpointFile, JSON.stringify({ seqNo: 1, hash: 'b'.repeat(64) }));
    fs.mkdirSync(logDir);
    fs.writeFileSync(
      path.join(logDir, 'audit-2023-01-01.log'),
      JSON.stringify({ seqNo: 1, hash: 'b'.repeat(64) }) + '\n'
    );
    const audit = await importAuditModule({
      AUDIT_HMAC_KEY: validHmac,
      AUDIT_LOG_DIR: logDir,
      AUDIT_CHECKPOINT_FILE: checkpointFile,
      AUDIT_CONSOLE: 'false',
    });
    const status = audit.getAuditChainStatus();
    assert.strictEqual(status.sequence, 1);
    assert.strictEqual(status.hash, 'b'.repeat(64));
  });

  it('loads checkpoint and verifies compressed (.gz) log tail', async () => {
    fs.writeFileSync(checkpointFile, JSON.stringify({ seqNo: 1, hash: 'b'.repeat(64) }));
    fs.mkdirSync(logDir);
    const gzData = zlib.gzipSync(JSON.stringify({ seqNo: 1, hash: 'b'.repeat(64) }) + '\n');
    fs.writeFileSync(path.join(logDir, 'audit-2023-01-01.log.gz'), gzData);
    const audit = await importAuditModule({
      AUDIT_HMAC_KEY: validHmac,
      AUDIT_LOG_DIR: logDir,
      AUDIT_CHECKPOINT_FILE: checkpointFile,
      AUDIT_CONSOLE: 'false',
    });
    const status = audit.getAuditChainStatus();
    assert.strictEqual(status.sequence, 1);
  });

  it('loads checkpoint but ignores invalid seqNo/hash', async () => {
    fs.writeFileSync(checkpointFile, JSON.stringify({ seqNo: 'invalid', hash: 'b' }));
    fs.mkdirSync(logDir);
    const audit = await importAuditModule({
      AUDIT_HMAC_KEY: validHmac,
      AUDIT_LOG_DIR: logDir,
      AUDIT_CHECKPOINT_FILE: checkpointFile,
      AUDIT_CONSOLE: 'false',
    });
    const status = audit.getAuditChainStatus();
    assert.strictEqual(status.sequence, 0);
  });

  it('persists checkpoint on writeAudit when persistentAuditChain=true', async () => {
    const audit = await importAuditModule({
      AUDIT_HMAC_KEY: validHmac,
      AUDIT_LOG_DIR: logDir,
      AUDIT_CHECKPOINT_FILE: checkpointFile,
      AUDIT_CONSOLE: 'false',
    });
    audit.logAccess({
      ip: '127.0.0.1',
      apiKey: 'secretkey',
      userId: 'user',
      tool: 'test',
      args: null,
      result: 'success',
      duration: 10,
    });
    assert.strictEqual(fs.existsSync(checkpointFile), true);
    const data = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    assert.strictEqual(data.seqNo, 1);
  });

  it('tests various log functions', async () => {
    const audit = await importAuditModule({
      AUDIT_LOG_DIR: logDir,
      AUDIT_CONSOLE: 'false',
    });

    // default.info
    audit.default.info('test default info', { extra: 'data' });

    // logAccess with API key and complex args
    audit.logAccess({
      ip: '10.0.0.1',
      apiKey: 'short', // tests maskKey short
      userId: 'user1',
      tool: 'complexTool',
      args: {
        normal: 'string',
        nested: { password: 'secret123' },
        arr: [{ some_secret_key: 'hide_me' }, 123, null],
        password: 'root',
        secret_value: 'xyz',
        token123: 'abc',
        myToken: 'qwe',
        command: '-pSecretPass mysql://user:pass@host/db Bearer tokenxyz',
        content: 'a'.repeat(250),
        largeCommand: 'c'.repeat(510),
      },
      result: 'failure',
      duration: 50,
    });

    // logAccess with long API key
    audit.logAccess({
      ip: '10.0.0.1',
      apiKey: 'long_api_key_that_is_masked',
      userId: 'user1',
      tool: 'test',
      args: undefined,
      result: 'success',
      duration: 10,
    });

    // logAuth
    audit.logAuth({ ip: '127.0.0.1', apiKey: 'key123', userId: 'u1', event: 'AUTH_SUCCESS', reason: 'ok' });
    audit.logAuth({ ip: '127.0.0.1', apiKey: null, userId: 'u1', event: 'AUTH_FAIL', reason: 'bad' });

    // logSecurityEvent
    audit.logSecurityEvent({ ip: '1.2.3.4', event: 'BRUTE_FORCE', detail: 'too many retries' });

    // logError (writes to error log)
    audit.logError({ ip: '127.0.0.1', userId: 'u1', tool: 't1', error: new Error('test err') });
    audit.logError({ ip: '127.0.0.1', userId: 'u1', tool: 't1', error: 'string error' });
    audit.logError({ ip: '127.0.0.1', userId: 'u1', tool: 't1', error: null });

    // logServerStart
    audit.logServerStart({ port: 8080, host: '0.0.0.0', https: false });

    // verify some files were created
    assert.strictEqual(fs.existsSync(logDir), true);

    // shutdownLoggers
    await new Promise(resolve => audit.shutdownLoggers(resolve));
  });

  it('tests sanitizeArgs directly', async () => {
    const audit = await importAuditModule({
      AUDIT_LOG_DIR: logDir,
      AUDIT_CONSOLE: 'false',
    });

    // Test function args to bypass [REDACTED] and hit length truncation
    const f = () => {};
    f.content = 'x'.repeat(300);
    f.command = 'y'.repeat(600);
    const res2 = audit.sanitizeArgs(f);
    assert.strictEqual(res2.content.length, 114);
    assert.strictEqual(res2.command.length, 514);

    const res = audit.sanitizeArgs({
      password: 'test',
      a: null,
      b: [1, null, { secret: 'x' }],
      c: { d: 'e' },
      str: '-p 123 --password=456 mysql://u:p@db Bearer abcdef',
      content: 'x'.repeat(201),
      command: 'y'.repeat(501),
    });

    assert.strictEqual(res.password, '[REDACTED]');
    assert.strictEqual(res.a, null);
    assert.strictEqual(res.b[2].secret, '[REDACTED]');
  });

  it('throws when log exists but is empty', async () => {
    fs.writeFileSync(checkpointFile, JSON.stringify({ seqNo: 1, hash: 'b'.repeat(64) }));
    fs.mkdirSync(logDir);
    fs.writeFileSync(path.join(logDir, 'audit-2023-01-01.log'), '');
    await assert.rejects(
      importAuditModule({
        AUDIT_HMAC_KEY: validHmac,
        AUDIT_LOG_DIR: logDir,
        AUDIT_CHECKPOINT_FILE: checkpointFile,
      }),
      /does not match the durable audit log tail/
    );
  });

  it('handles ephemeral unanchored status', async () => {
    const audit = await importAuditModule({
      AUDIT_LOG_DIR: logDir,
      AUDIT_CONSOLE: 'false',
    });
    const status = audit.getAuditChainStatus();
    assert.strictEqual(status.protection, 'ephemeral-unanchored');
  });

  it('handles logAccess with no apiKey', async () => {
    const audit = await importAuditModule({
      AUDIT_LOG_DIR: logDir,
      AUDIT_CONSOLE: 'false',
    });
    audit.logAccess({
      ip: '10.0.0.1',
      userId: 'user1',
      tool: 'test',
      args: undefined,
      result: 'success',
      duration: 10,
    });
  });
});
