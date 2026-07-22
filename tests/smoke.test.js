import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from '../tools/files.js';
import { getProcesses } from '../tools/system.js';
import { setUserPassword, manageSshKeys } from '../tools/users.js';
import { runSandboxedCode } from '../tools/docker.js';

describe('MCP Sentinel Security Sandbox Tests', () => {
  
  it('Should reject reading /etc/shadow for non-admin', async () => {
    try {
      await readFile({ filePath: '/etc/shadow' }, { userId: 'testuser', role: 'user' });
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.match(err.message, /forbidden|not permitted/);
    }
  });

  it('Should reject reading /etc/shadow via path traversal', async () => {
    try {
      await readFile({ filePath: '/tmp/../../etc/shadow' }, { userId: 'testuser', role: 'user' });
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.match(err.message, /forbidden|not permitted/);
    }
  });

  it('Should successfully run getProcesses without shell escape', async () => {
    const result = await getProcesses({ filter: 'bash' }, { userId: 'root', role: 'user' });
    assert.ok(typeof result.processes === 'string');
  });

  it('Rejects passwords containing a real newline before invoking chpasswd', async () => {
    await assert.rejects(
      setUserPassword({ username: 'testuser', password: 'line1\nline2' }, { role: 'admin' }),
      /invalid characters/
    );
  });

  it('Rejects SSH key payloads that could be interpreted by a shell', async () => {
    await assert.rejects(
      manageSshKeys({ username: 'root', action: 'add', publicKey: 'ssh-ed25519 AAAA$(id)' }, { role: 'admin' }),
      /Invalid SSH public key payload/
    );
  });

  it('Rejects invalid sandbox file maps before Docker is invoked', async () => {
    await assert.rejects(
      runSandboxedCode({ language: 'node', code: 'console.log(1)', files: { '../escape': 'no' } }, { role: 'user' }),
      /Invalid filename/
    );
  });

});
