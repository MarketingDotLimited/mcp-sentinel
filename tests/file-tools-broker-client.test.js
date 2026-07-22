import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-file-tools-'));
const socketPath = path.join(directory, 'broker.sock');
const stateFile = path.join(directory, 'state.json');
const projectRoot = path.join(directory, 'project');
const projectId = '33333333-3333-4333-8333-333333333333';
await fs.mkdir(projectRoot);
await fs.writeFile(
  stateFile,
  JSON.stringify({
    version: 1,
    approvals: [],
    projects: [{ id: projectId, name: 'Example', rootPath: projectRoot, repoPath: projectRoot }],
  })
);
process.env.CONTROL_PLANE_STATE_FILE = stateFile;
delete process.env.MCP_STATE_DB;
process.env.MCP_BROKER_SOCKET = socketPath;
const files = await import(`../tools/files.js?test=${Date.now()}`);
const users = await import(`../tools/users.js?test=${Date.now()}`);
const identity = { userId: 'developer', role: 'developer', projectIds: [projectId] };
let server;

before(async () => {
  server = net.createServer(socket => {
    let request = '';
    let handled = false;
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      request += chunk;
      if (handled || !request.includes('\n')) return;
      handled = true;
      const parsed = JSON.parse(request);
      socket.end(JSON.stringify({ requestId: parsed.requestId, ok: true, result: parsed }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});

describe('project file tool broker client', () => {
  it('routes every operation with a project UUID and relative path', async () => {
    assert.equal((await files.readFile({ projectId, filePath: 'src/a.js' }, identity)).operation, 'project.file.read');
    assert.equal(
      (await files.writeFile({ projectId, filePath: 'src/a.js', content: 'x' }, identity)).operation,
      'project.file.write'
    );
    assert.equal(
      (await files.deleteFile({ projectId, filePath: 'src/a.js' }, identity)).operation,
      'project.file.delete'
    );
    assert.equal((await files.listDirectory({ projectId, dirPath: 'src' }, identity)).operation, 'project.file.list');
    assert.equal(
      (await files.moveFile({ projectId, sourcePath: 'a', destPath: 'b' }, identity)).operation,
      'project.file.move'
    );
    assert.equal(
      (await files.copyFile({ projectId, sourcePath: 'a', destPath: 'b' }, identity)).operation,
      'project.file.copy'
    );
    assert.equal((await files.getFileInfo({ projectId, filePath: 'a' }, identity)).operation, 'project.file.info');
    assert.equal(
      (await files.searchFiles({ projectId, searchPath: '.', pattern: '*.js' }, identity)).operation,
      'project.file.search'
    );
  });

  it('supports only exact assigned absolute paths during compatibility', async () => {
    const result = await files.readFile({ filePath: path.join(projectRoot, 'src/a.js') }, identity);
    assert.match(result.warning, /deprecated/);
    assert.equal(result.parameters.path, 'src/a.js');
    await assert.rejects(files.readFile({ filePath: '/etc/shadow' }, identity), /not permitted/);
    await assert.rejects(files.readFile({ projectId, filePath: '/absolute' }, identity), /must be relative/);
    await assert.rejects(files.readFile({ projectId, filePath: 'a', encoding: 'base64' }, identity), /Only utf8/);
  });
});

describe('typed user administration broker client', () => {
  const admin = { userId: 'admin', role: 'admin' };
  it('routes fixed user and SSH-key operations', async () => {
    assert.equal((await users.listUsers({}, admin)).operation, 'user.list');
    assert.equal((await users.getUserInfo({ username: 'developer' }, admin)).operation, 'user.info');
    assert.equal(
      (
        await users.createUser(
          { username: 'example', groups: 'developers,operators', shell: '/bin/bash', comment: 'Example' },
          admin
        )
      ).operation,
      'user.create'
    );
    assert.equal(
      (await users.setUserPassword({ username: 'example', password: 'a'.repeat(16) }, admin)).operation,
      'user.password'
    );
    assert.equal(
      (await users.modifyUser({ username: 'example', addGroups: 'developers', lockAccount: true }, admin)).operation,
      'user.modify'
    );
    assert.equal(
      (
        await users.manageSshKeys(
          { username: 'example', action: 'add', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest key' },
          admin
        )
      ).operation,
      'user.ssh'
    );
    assert.equal((await users.deleteUser({ username: 'example' }, admin)).operation, 'user.delete');
  });

  it('rejects non-admin mutation and malformed user payloads locally', async () => {
    const developer = { userId: 'developer', role: 'developer' };
    await assert.rejects(users.listUsers({}, developer), /requires admin/);
    await assert.rejects(users.getUserInfo({ username: 'another' }, developer), /only view your own/);
    await assert.rejects(users.createUser({ username: 'root' }, admin), /reserved/);
    await assert.rejects(
      users.setUserPassword({ username: 'example', password: 'bad\npassword' }, admin),
      /invalid characters/
    );
    await assert.rejects(
      users.modifyUser({ username: 'example', lockAccount: true, unlockAccount: true }, admin),
      /simultaneously/
    );
    await assert.rejects(
      users.manageSshKeys({ username: 'developer', action: 'add', publicKey: 'not-a-key' }, developer),
      /Invalid SSH/
    );
  });
});
