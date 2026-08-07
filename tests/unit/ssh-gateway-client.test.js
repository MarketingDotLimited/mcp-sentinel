import "../test-env.js";
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearSshConnectionCache, sshGatewayCall, validateSshConnection } from "../../lib/ssh-gateway-client.js";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-ssh-gateway-'));
const credentials = path.join(directory, 'credentials');
const runtime = path.join(directory, 'runtime');
const connection = {
  id: '45d823a1-0b8d-40d1-bc09-95f82cf96368',
  host: 'node.example.test',
  port: 2222,
  username: 'mcp_node',
  credentialId: 'node-example',
  hostKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestPinnedHostKey',
};

before(async () => {
  await fs.mkdir(credentials, { recursive: true });
  await fs.writeFile(path.join(credentials, 'ssh-node-example'), 'test-private-key', { mode: 0o600 });
  process.env.MCP_SSH_CREDENTIAL_DIR = credentials;
  process.env.MCP_SSH_RUNTIME_DIR = runtime;
});

after(async () => {
  delete process.env.MCP_SSH_CREDENTIAL_DIR;
  delete process.env.MCP_SSH_RUNTIME_DIR;
  clearSshConnectionCache();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('SSH node gateway client', () => {
  it('pins the host key, disables SSH side channels, and sends only typed NDJSON', async () => {
    clearSshConnectionCache();
    const calls = [];
    const runner = async (args, options = {}) => {
      calls.push({ args, options });
      if (args.includes('-O')) return { exitCode: 255, stdout: '', stderr: '' };
      if (args.includes('-MNf')) return { exitCode: 0, stdout: '', stderr: '' };
      const request = JSON.parse(options.input);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ requestId: request.requestId, ok: true, result: { operation: request.operation } }),
        stderr: '',
      };
    };
    const result = await sshGatewayCall(
      connection,
      'project.file.read',
      { projectId: 'project', path: 'a' },
      { runner }
    );
    assert.equal(result.operation, 'project.file.read');
    assert.equal(calls.filter(call => call.args.includes('-MNf')).length, 1);
    const invocation = calls.at(-1);
    assert.ok(invocation.args.includes('StrictHostKeyChecking=yes'));
    assert.ok(invocation.args.includes('ClearAllForwardings=yes'));
    assert.ok(invocation.args.includes('ForwardAgent=no'));
    assert.ok(invocation.args.includes('RequestTTY=no'));
    assert.equal(invocation.args.at(-1), 'mcp_node@node.example.test');
    assert.deepEqual(invocation.args.slice(invocation.args.lastIndexOf('--')), ['--', 'mcp_node@node.example.test']);
    const knownHostFiles = (await fs.readdir(runtime)).filter(name => name.startsWith(`known-hosts-${connection.id}-`));
    assert.equal(knownHostFiles.length, 1);
    const knownHosts = await fs.readFile(path.join(runtime, knownHostFiles[0]), 'utf8');
    assert.equal(knownHosts, `[node.example.test]:2222 ${connection.hostKey}\n`);
  });

  it('coalesces connection establishment for concurrent calls', async () => {
    clearSshConnectionCache();
    let masters = 0;
    const runner = async (args, options = {}) => {
      if (args.includes('-O')) return { exitCode: 255, stdout: '', stderr: '' };
      if (args.includes('-MNf')) {
        masters += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      const request = JSON.parse(options.input);
      return {
        exitCode: 0,
        stdout: JSON.stringify({ requestId: request.requestId, ok: true, result: true }),
        stderr: '',
      };
    };
    await Promise.all([
      sshGatewayCall(connection, 'broker.health', {}, { runner }),
      sshGatewayCall(connection, 'broker.health', {}, { runner }),
    ]);
    assert.equal(masters, 1);
  });

  it('fails closed for unsafe records, private-key permissions, operations, and response identities', async () => {
    assert.throws(() => validateSshConnection({ ...connection, username: 'root' }), /non-root/);
    assert.throws(() => validateSshConnection({ ...connection, hostKey: '' }), /pinned/);
    await assert.rejects(sshGatewayCall(connection, 'shell.exec', {}), /not permitted/);

    clearSshConnectionCache();
    await fs.chmod(path.join(credentials, 'ssh-node-example'), 0o644);
    await assert.rejects(sshGatewayCall(connection, 'broker.health', {}), /private/);
    await fs.chmod(path.join(credentials, 'ssh-node-example'), 0o600);

    clearSshConnectionCache();
    const runner = async (args, options = {}) => {
      if (args.includes('-O')) return { exitCode: 0, stdout: '', stderr: '' };
      return {
        exitCode: 0,
        stdout: JSON.stringify({ requestId: '00000000-0000-4000-8000-000000000000', ok: true, result: {} }),
        stderr: '',
      };
    };
    await assert.rejects(sshGatewayCall(connection, 'broker.health', {}, { runner }), /ID mismatch/);
  });

  it('classifies connection, transport, and typed gateway failures', async () => {
    clearSshConnectionCache();
    await assert.rejects(
      sshGatewayCall(
        connection,
        'broker.health',
        {},
        {
          runner: async args =>
            args.includes('-O')
              ? { exitCode: 255, stdout: '', stderr: '' }
              : { exitCode: 255, stdout: '', stderr: 'public key denied' },
        }
      ),
      /public key denied/
    );

    for (const response of [
      { exitCode: 255, stdout: 'not-json', stderr: 'transport closed', error: /transport closed/ },
      { exitCode: 0, stdout: 'not-json', stderr: '', error: /invalid response/ },
    ]) {
      clearSshConnectionCache();
      await assert.rejects(
        sshGatewayCall(
          connection,
          'broker.health',
          {},
          {
            runner: async (args, options = {}) =>
              args.includes('-O') ? { exitCode: 0, stdout: '', stderr: '' } : { ...response, input: options.input },
          }
        ),
        response.error
      );
    }

    clearSshConnectionCache();
    await assert.rejects(
      sshGatewayCall(
        connection,
        'broker.health',
        {},
        {
          runner: async (args, options = {}) => {
            if (args.includes('-O')) return { exitCode: 0, stdout: '', stderr: '' };
            const request = JSON.parse(options.input);
            return {
              exitCode: 1,
              stdout: JSON.stringify({ requestId: request.requestId, ok: false, error: 'typed request denied' }),
              stderr: '',
            };
          },
        }
      ),
      /typed request denied/
    );
  });

  it('covers runner catch block during master connection check', async () => {
    clearSshConnectionCache();
    const runner = async (args, options = {}) => {
      if (args.includes('-O')) throw new Error('mock check failure');
      if (args.includes('-MNf')) return { exitCode: 0, stdout: '', stderr: '' };
      return {
        exitCode: 0,
        stdout: JSON.stringify({ requestId: JSON.parse(options.input).requestId, ok: true, result: {} }),
        stderr: '',
      };
    };
    const result = await sshGatewayCall(connection, 'broker.health', { projectId: 'p' }, { runner });
    assert.equal(result.ok, undefined); // result is just the result object itself since we return ok:true
  });

  it('handles parameters edge cases', async () => {
    // Array parameters
    await assert.rejects(sshGatewayCall(connection, 'broker.health', []), /must be an object/);
    // Null parameters
    await assert.rejects(sshGatewayCall(connection, 'broker.health', null), /must be an object/);
    // Request too large
    const huge = { data: 'a'.repeat(64 * 1024) };
    await assert.rejects(sshGatewayCall(connection, 'broker.health', huge), /too large/);
    // Connection format
    assert.throws(() => validateSshConnection(null), /required/);
    assert.throws(() => validateSshConnection('str'), /required/);
    assert.throws(() => validateSshConnection([]), /required/);
    // Connection ID
    assert.throws(() => validateSshConnection({ ...connection, id: 123 }), /UUID/);
    assert.throws(() => validateSshConnection({ ...connection, id: 'invalid-uuid' }), /UUID/);
    // Invalid username format
    assert.throws(() => validateSshConnection({ ...connection, username: '1abc' }), /non-root/);
    assert.throws(() => validateSshConnection({ ...connection, username: '' }), /non-root/);
    assert.throws(() => validateSshConnection({ ...connection, username: undefined }), /non-root/);
    // Invalid host
    assert.throws(() => validateSshConnection({ ...connection, host: 123 }), /Invalid SSH host/);
    assert.throws(() => validateSshConnection({ ...connection, host: 'a'.repeat(254) }), /Invalid SSH host/);
    assert.throws(() => validateSshConnection({ ...connection, host: 'inv@lid' }), /Invalid SSH host/);
    // Invalid port
    assert.throws(() => validateSshConnection({ ...connection, port: 'abc' }), /Invalid SSH connection limit/);
    assert.throws(() => validateSshConnection({ ...connection, port: 0 }), /Invalid SSH connection limit/);
    assert.throws(() => validateSshConnection({ ...connection, port: 100000 }), /Invalid SSH connection limit/);
    // Invalid credential ID
    assert.throws(() => validateSshConnection({ ...connection, credentialId: 'inv@lid' }), /Invalid SSH credential ID/);
    assert.throws(() => validateSshConnection({ ...connection, credentialId: '' }), /Invalid SSH credential ID/);
    assert.throws(() => validateSshConnection({ ...connection, credentialId: undefined }), /Invalid SSH credential ID/);
  });

  it('handles port 22 and runner fallback', async () => {
    clearSshConnectionCache();
    // Port 22 should not include the port in the known hosts file label
    const port22Connection = { ...connection, port: 22, host: 'port22.example.test' };
    const ac = new AbortController();
    // Use the real runSshProcess by omitting runner in options.
    // We expect it to fail quickly due to a timeout.
    const p = sshGatewayCall(port22Connection, 'broker.health', {}, { timeoutMs: 1000 });
    await assert.rejects(p, /SSH connection failed/);

    // Verify the known host file was written for port 22
    const knownHostFiles = (await fs.readdir(runtime)).filter(name =>
      name.startsWith(`known-hosts-${port22Connection.id}-`)
    );
    let found = false;
    for (const file of knownHostFiles) {
      const knownHosts = await fs.readFile(path.join(runtime, file), 'utf8');
      if (knownHosts.includes('port22.example.test ssh-ed')) found = true;
    }
    assert.ok(found);
  });

  it('covers catch block fallbacks', async () => {
    clearSshConnectionCache();
    await assert.rejects(
      sshGatewayCall(
        connection,
        'broker.health',
        {},
        {
          runner: async args => {
            if (args.includes('-O')) return { exitCode: 0, stdout: '', stderr: '' };
            // Invalid JSON, exitCode != 0, empty stderr -> falls back to "exit CODE"
            return { exitCode: 255, stdout: 'not-json', stderr: '' };
          },
        }
      ),
      /exit 255/
    );

    clearSshConnectionCache();
    await assert.rejects(
      sshGatewayCall(
        connection,
        'broker.health',
        {},
        {
          runner: async (args, options = {}) => {
            if (args.includes('-O')) return { exitCode: 0, stdout: '', stderr: '' };
            // ok: false but no error message -> falls back to "rejected the request"
            const req = JSON.parse(options.input);
            return { exitCode: 0, stdout: JSON.stringify({ requestId: req.requestId, ok: false }), stderr: '' };
          },
        }
      ),
      /rejected the request/
    );
  });

  it('covers credential directory fallbacks', async () => {
    clearSshConnectionCache();
    const origCred = process.env.MCP_SSH_CREDENTIAL_DIR;
    const origRun = process.env.MCP_SSH_RUNTIME_DIR;
    delete process.env.MCP_SSH_CREDENTIAL_DIR;
    delete process.env.MCP_SSH_RUNTIME_DIR;
    process.env.CREDENTIALS_DIRECTORY = credentials;
    try {
      await assert.rejects(sshGatewayCall(connection, 'broker.health', {}));
    } finally {
      delete process.env.CREDENTIALS_DIRECTORY;
      process.env.MCP_SSH_CREDENTIAL_DIR = origCred;
      process.env.MCP_SSH_RUNTIME_DIR = origRun;
    }

    // Test the absolute fallback '/etc/mcp-sentinel/credentials'
    delete process.env.MCP_SSH_CREDENTIAL_DIR;
    try {
      await assert.rejects(sshGatewayCall(connection, 'broker.health', {}));
    } finally {
      process.env.MCP_SSH_CREDENTIAL_DIR = origCred;
    }
  });

  it('covers known hosts read non-ENOENT error', async () => {
    clearSshConnectionCache();
    const fp = connection.id + '-mock';
    // We can just create a directory in place of known hosts file so it fails with EISDIR
    const files = await fs.readdir(runtime);
    for (const f of files)
      if (f.startsWith('known-hosts-')) await fs.rm(path.join(runtime, f), { recursive: true, force: true });

    // we need to know the fingerprint, let's just make ALL possible ones directories
    // Wait, the easiest way is to mock fs.readFile in a subtest, but we can't easily mock it.
    // Instead we can just make a dummy directory with the exact name.
    // Since we don't have connectionFingerprint exported, we can just intercept via runner? No, connectionFiles runs before runner.
    // Let's just create 10,000 directories? No.
    // Let's monkeypatch fs.readFile briefly!
    const originalReadFile = fs.readFile;
    fs.readFile = async (...args) => {
      const err = new Error('mock EACCES');
      err.code = 'EACCES';
      throw err;
    };
    try {
      await assert.rejects(sshGatewayCall(connection, 'broker.health', {}), /mock EACCES/);
    } finally {
      fs.readFile = originalReadFile;
    }
  });

  it('covers master connection fallback to authentication failed', async () => {
    clearSshConnectionCache();
    await assert.rejects(
      sshGatewayCall(
        connection,
        'broker.health',
        {},
        {
          runner: async args => {
            if (args.includes('-O')) return { exitCode: 255, stdout: '', stderr: '' };
            return { exitCode: 255, stdout: '', stderr: '' }; // no stderr
          },
        }
      ),
      /authentication failed/
    );
  });
});

import { runSshProcess, killTree } from "../../lib/ssh-gateway-client.js";

describe('SSH runSshProcess', () => {
  it('executes successfully and captures stdout/stderr', async () => {
    const res = await runSshProcess(['-V']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stderr, /OpenSSH/);
  });

  it('aborts on signal', async () => {
    const ac = new AbortController();
    const p = runSshProcess(['-o', 'ConnectTimeout=10', '192.0.2.1'], { signal: ac.signal });
    ac.abort();
    await assert.rejects(p, /cancelled/);
  });

  it('aborts immediately if signal already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(runSshProcess(['-V'], { signal: ac.signal }), /cancelled/);
  });

  it('enforces timeout', async () => {
    await assert.rejects(runSshProcess(['-o', 'ConnectTimeout=10', '192.0.2.1'], { timeoutMs: 1 }), /timed out/);
  });

  it('enforces maxOutputBytes limit', async () => {
    await assert.rejects(runSshProcess(['-V'], { maxOutputBytes: 1 }), /exceeded the output limit/);
  });

  it('falls back to child.kill if process.kill fails during abort', async () => {
    const originalKill = process.kill;
    process.kill = () => {
      throw new Error('mock');
    };
    try {
      const ac = new AbortController();
      const p = runSshProcess(['-o', 'ConnectTimeout=10', '192.0.2.1'], { signal: ac.signal });
      ac.abort();
      await assert.rejects(p, /cancelled/);
    } finally {
      process.kill = originalKill;
    }
  });

  it('returns gracefully when killTree is called without child pid', async () => {
    killTree({});
    killTree(null);
  });
});
