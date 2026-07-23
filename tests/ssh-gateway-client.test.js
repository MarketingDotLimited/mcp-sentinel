import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearSshConnectionCache, sshGatewayCall, validateSshConnection } from '../lib/ssh-gateway-client.js';

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
    await assert.rejects(sshGatewayCall(connection, 'broker.health', {}, { runner: async () => ({}) }), /private/);
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
});
