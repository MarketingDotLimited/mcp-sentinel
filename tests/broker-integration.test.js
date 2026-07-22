import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import net from 'net';
import { spawn } from 'child_process';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-broker-integration-'));
const projectRoot = path.join(directory, 'project');
const fakeBin = path.join(directory, 'bin');
const stateDatabase = path.join(directory, 'state.sqlite3');
const configFile = path.join(directory, 'application.json');
const configRegistry = path.join(directory, 'config-registry.json');
const backupRoot = path.join(directory, 'config-backups');
const projectId = '11111111-1111-4111-8111-111111111111';
const brokerSocket = path.join(directory, 'broker.sock');
const passwd = fsSync
  .readFileSync('/etc/passwd', 'utf8')
  .trim()
  .split('\n')
  .map(line => line.split(':'));
const current = passwd.find(parts => Number(parts[2]) === process.getuid());
const fallback = passwd.find(parts => parts[0] === 'nobody') || passwd.find(parts => Number(parts[2]) > 0);
const runAsUser = current?.[0] === 'root' ? fallback[0] : current[0];

await fs.mkdir(projectRoot, { recursive: true, mode: 0o755 });
await fs.mkdir(fakeBin, { mode: 0o755 });
await fs.writeFile(path.join(projectRoot, 'source.txt'), 'hello', { mode: 0o644 });
await fs.writeFile(path.join(projectRoot, 'target.test'), 'test', { mode: 0o644 });
await fs.writeFile(path.join(projectRoot, '.env.testing'), 'APP_ENV=testing\nDB_DATABASE=project_test\n', {
  mode: 0o600,
});
await fs.writeFile(configFile, '{"version":1}\n', { mode: 0o600 });
await fs.writeFile(
  configRegistry,
  JSON.stringify({
    configs: {
      application: { path: configFile, service: 'example-app', validator: 'json' },
      nginx_test: { path: configFile, service: 'example-app', validator: 'nginx' },
      systemd_test: { path: configFile, service: 'example-app', validator: 'systemd' },
      authelia_test: { path: configFile, service: 'example-app', validator: 'authelia' },
    },
  })
);
const fakeCommand = path.join(fakeBin, 'fake-command');
await fs.writeFile(
  fakeCommand,
  `#!/usr/bin/env node
const name = process.argv[1].split('/').pop();
const args = process.argv.slice(2);
if (name === 'systemctl' && args[0] === 'is-active') process.stdout.write('active\\n');
else if (name === 'systemctl' && args[0] === 'is-enabled') process.stdout.write('enabled\\n');
else if (name === 'systemctl' && args[0] === 'status') process.stdout.write('service status\\n');
else if (name === 'journalctl') process.stdout.write('journal entry\\n');
else if (name === 'ufw') process.stdout.write('Status: active\\n');
else if (name === 'systemd-run') process.stdout.write('managed command\\n');
`,
  { mode: 0o755 }
);
for (const name of ['systemctl', 'journalctl', 'ufw', 'systemd-run', 'nginx', 'systemd-analyze', 'authelia'])
  await fs.symlink(fakeCommand, path.join(fakeBin, name));

const database = new DatabaseSync(stateDatabase);
database.exec(`
  CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
  CREATE TABLE state_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  CREATE TABLE projects(id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
  INSERT INTO schema_migrations VALUES (3, '2026-01-01T00:00:00.000Z');
`);
database.prepare('INSERT INTO projects VALUES (?, ?, ?)').run(
  projectId,
  JSON.stringify({
    id: projectId,
    rootPath: projectRoot,
    repoPath: projectRoot,
    runAsUser,
    testDatabase: 'project_test',
    permittedTasks: [
      'artisan',
      'phpunit',
      'npm',
      'composer-validate',
      'pest',
      'frontend',
      'playwright',
      'python',
      'go',
      'rust',
    ],
    permittedGitActions: ['status', 'diff', 'log', 'branch', 'checkout', 'add', 'commit', 'pull', 'push'],
    allowFullSuite: false,
  }),
  new Date().toISOString()
);
database.close();
await fs.chmod(stateDatabase, 0o600);

process.env.PATH = `${fakeBin}:${process.env.PATH}`;
process.env.MCP_STATE_DB = stateDatabase;
process.env.BROKER_MANAGED_SERVICES = 'example-app';
process.env.BROKER_PROTECTED_SERVICES = 'mcp-sentinel,authelia';
process.env.BROKER_GIT_ALLOWED_REPOS = projectRoot;
process.env.BROKER_CONFIG_REGISTRY = configRegistry;
process.env.BROKER_CONFIG_BACKUP_ROOT = backupRoot;
process.env.MCP_BROKER_SOCKET = brokerSocket;
process.env.BROKER_FIREWALL_SNAPSHOT_ROOT = path.join(directory, 'firewall-snapshots');
const { handleRequest, startBroker } = await import(`../broker.js?integration=${Date.now()}`);
let sequence = 0;
const call = (operation, parameters = {}) =>
  handleRequest({
    requestId: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    operation,
    parameters,
  }).then(response => response.result);

after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('broker operational integration', () => {
  it('reports schema, project identity, and state health', async () => {
    const health = await call('broker.health');
    assert.equal(health.healthy, true);
    assert.equal(health.projectCount, 1);
    assert.equal(health.stateMode, '0600');
  });

  it('performs bounded project file operations without following protected paths or symlinks', async () => {
    assert.equal((await call('project.file.read', { projectId, path: 'source.txt', maxBytes: 3 })).content, 'hel');
    await call('project.file.write', { projectId, path: 'created.txt', content: 'one', mode: 'overwrite' });
    await call('project.file.write', { projectId, path: 'created.txt', content: 'two', mode: 'append' });
    assert.equal((await call('project.file.read', { projectId, path: 'created.txt' })).content, 'onetwo');
    await call('project.file.copy', { projectId, source: 'created.txt', destination: 'copy.txt' });
    await call('project.file.move', { projectId, source: 'copy.txt', destination: 'moved.txt' });
    assert.equal((await call('project.file.info', { projectId, path: 'moved.txt' })).type, 'file');
    assert.ok((await call('project.file.list', { projectId, path: '.', showHidden: false })).count >= 4);
    assert.deepEqual((await call('project.file.search', { projectId, path: '.', pattern: '*.txt' })).results.sort(), [
      'created.txt',
      'moved.txt',
      'source.txt',
    ]);
    await call('project.file.delete', { projectId, path: 'moved.txt', recursive: false });
    await assert.rejects(call('project.file.read', { projectId, path: '.env.testing' }), /protected/);
    await fs.symlink('/etc/passwd', path.join(projectRoot, 'escape'));
    await assert.rejects(call('project.file.read', { projectId, path: 'escape' }), /Symbolic links/);
    await assert.rejects(call('project.file.read', { projectId, path: '../escape' }), /cannot traverse/);
    await assert.rejects(call('project.file.write', { projectId, path: '.', content: 'x' }), /root cannot/);
    await assert.rejects(
      call('project.file.search', { projectId, path: '.', pattern: '[bad]' }),
      /Invalid project search/
    );
    await fs.mkdir(path.join(projectRoot, 'directory'));
    await assert.rejects(
      call('project.file.delete', { projectId, path: 'directory', recursive: true }),
      /Recursive deletion is not registered/
    );
  });

  it('applies and restores registered JSON configuration with health checks', async () => {
    const applied = await call('config.apply', { configId: 'application', content: '{"version":2}\n' });
    assert.equal(applied.healthy, true);
    const backups = await call('config.backups', { configId: 'application' });
    assert.equal(backups.backups.length, 1);
    await call('config.restore', { configId: 'application', timestamp: backups.backups[0].timestamp });
    assert.equal(JSON.parse(await fs.readFile(configFile, 'utf8')).version, 1);
    await assert.rejects(call('config.apply', { configId: 'application', content: '{invalid' }), /validator rejected/);
    for (const configId of ['nginx_test', 'systemd_test', 'authelia_test'])
      assert.equal((await call('config.apply', { configId, content: '{"version":3}\n' })).healthy, true);
    await assert.rejects(call('config.apply', { configId: 'missing', content: '{}' }), /not registered/);
  });

  it('uses fixed service, journal, test, cancellation, and Git recipes', async () => {
    assert.equal((await call('service.status', { service: 'example-app' })).active, 'active');
    assert.equal((await call('service.action', { service: 'example-app', action: 'reload' })).exitCode, 0);
    assert.match((await call('service.list', {})).stdout, /service status|^$/);
    assert.match((await call('journal.read', { service: 'example-app', lines: 5 })).stdout, /journal entry/);
    assert.match((await call('journal.read', { lines: 1, priority: 'err', since: '1 hour ago' })).stdout, /journal/);
    await assert.rejects(call('journal.read', { priority: 'invalid' }), /Invalid journal priority/);
    await assert.rejects(call('service.action', { service: 'example-app', action: 'destroy' }), /Unsupported/);
    const test = await call('project.test', {
      runId: '22222222-2222-4222-8222-222222222222',
      projectId,
      runner: 'artisan',
      target: 'target.test',
    });
    assert.match(test.stdout, /managed command/);
    assert.equal((await call('project.cancel', { runId: '22222222-2222-4222-8222-222222222222' })).exitCode, 0);
    assert.match((await call('project.git', { projectId, action: 'status', args: {} })).stdout, /managed command/);
    await assert.rejects(
      call('project.git', { projectId, action: 'add', args: { files: ['.'] } }),
      /Whole-repository staging/
    );
    for (const [action, args] of [
      ['diff', {}],
      ['log', { n: 5 }],
      ['branch', {}],
      ['checkout', { branch: 'feature/test', create: true }],
      ['add', { files: ['source.txt'] }],
      ['commit', { message: 'test commit' }],
      ['pull', {}],
      ['push', {}],
    ])
      assert.match((await call('project.git', { projectId, action, args })).stdout, /managed command/);
    assert.match(
      (
        await call('project.test', {
          runId: '55555555-5555-4555-8555-555555555555',
          projectId,
          runner: 'composer-validate',
        })
      ).stdout,
      /managed command/
    );
    assert.match(
      (
        await call('project.test', {
          runId: '66666666-6666-4666-8666-666666666666',
          projectId,
          runner: 'rust',
          target: 'target.test',
          filter: 'example',
        })
      ).stdout,
      /managed command/
    );
    await assert.rejects(
      call('project.test', {
        runId: '77777777-7777-4777-8777-777777777777',
        projectId,
        runner: 'npm',
      }),
      /target is required/
    );
  });

  it('handles safe user reads, process ownership, firewall status, and confirmation', async () => {
    assert.ok((await call('user.list', { includeSystem: true })).count >= 1);
    assert.equal((await call('user.info', { username: runAsUser })).username, runAsUser);
    assert.match((await call('firewall.status')).stdout, /Status: active/);
    const rollbackId = '88888888-8888-4888-8888-888888888888';
    assert.equal((await call('firewall.confirm', { rollbackId })).confirmed, true);
    await assert.rejects(call('firewall.confirm', { rollbackId: 'bad' }), /Invalid firewall rollback/);
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    try {
      assert.equal((await call('process.signal', { pid: child.pid, signal: 'TERM' })).signal, 'TERM');
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('rejects malformed typed operations across every privileged boundary', async () => {
    await assert.rejects(
      handleRequest({ requestId: 'invalid', operation: 'broker.health', parameters: {} }),
      /Invalid request ID/
    );
    await assert.rejects(
      handleRequest({
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        operation: 'broker.health',
        parameters: null,
      }),
      /parameters must be an object/
    );
    await assert.rejects(
      handleRequest({
        requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        operation: 'broker.health',
        parameters: { extra: true },
      }),
      /unknown field/
    );

    const denials = [
      ['service.status', { service: 42 }, /Invalid service/],
      ['service.status', { service: 'bad..service' }, /Invalid service/],
      ['service.list', { state: 'BAD!' }, /Invalid service state/],
      ['journal.read', { since: 'yesterday; reboot' }, /Invalid journal time/],
      ['process.signal', { pid: 1, signal: 'TERM' }, /Invalid process ID/],
      ['process.signal', { pid: 99999999, signal: 'INVALID' }, /Invalid process signal/],
      ['process.signal', { pid: 99999999, signal: 'TERM', owner: 'bad user' }, /Invalid process owner/],
      ['project.file.read', { projectId: 'invalid', path: 'source.txt' }, /Invalid project ID/],
      [
        'project.file.read',
        { projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', path: 'source.txt' },
        /not registered/,
      ],
      ['project.file.read', { projectId, path: projectRoot }, /relative/],
      ['project.file.read', { projectId, path: 'directory' }, /regular file/],
      ['project.file.write', { projectId, path: 'bad.txt', content: 7 }, /content must be a string/],
      ['project.file.write', { projectId, path: 'bad.txt', content: 'x', mode: 'merge' }, /write mode/],
      ['project.file.list', { projectId, path: 'source.txt' }, /must be a directory/],
      ['project.file.search', { projectId, path: 'source.txt', pattern: '*' }, /must be a directory/],
      ['project.file.search', { projectId, path: '.', pattern: '*', fileType: 'link' }, /search file type/],
      ['project.file.copy', { projectId, source: 'directory', destination: 'dir-copy' }, /regular project files/],
      ['project.file.move', { projectId, source: 'directory', destination: 'dir-move' }, /regular project files/],
      ['project.file.copy', { projectId, source: 'source.txt', destination: 'target.test' }, /already exists/],
      ['project.file.move', { projectId, source: 'source.txt', destination: 'target.test' }, /already exists/],
      ['config.apply', { configId: 'INVALID!', content: '{}' }, /Invalid configuration ID/],
      ['config.restore', { configId: 'application', timestamp: 'bad' }, /Invalid configuration backup timestamp/],
      ['project.test', { runId: 'bad', projectId, runner: 'npm', target: 'target.test' }, /Invalid run ID/],
      [
        'project.test',
        { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', projectId, runner: 'unknown', target: 'target.test' },
        /recipe is not registered/,
      ],
      [
        'project.test',
        { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', projectId, runner: 'npm', target: projectRoot },
        /relative project path/,
      ],
      [
        'project.test',
        {
          runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          projectId,
          runner: 'composer-validate',
          target: 'target.test',
        },
        /does not accept a target/,
      ],
      [
        'project.test',
        { runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', projectId, runner: 'npm', target: 'target.test', filter: 'x' },
        /does not accept a filter/,
      ],
      [
        'project.test',
        {
          runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          projectId,
          runner: 'python',
          target: 'target.test',
          filter: ' ',
        },
        /Invalid test filter/,
      ],
      [
        'project.test',
        {
          runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          projectId,
          runner: 'python',
          target: 'target.test',
          filter: 'safe\nunsafe',
        },
        /Invalid test filter/,
      ],
      ['project.git', { projectId, action: 'log', args: { n: 101 } }, /Git log count/],
      ['project.git', { projectId, action: 'add', args: { files: [] } }, /requires 1-100/],
      ['project.git', { projectId, action: 'add', args: { files: ['-all'] } }, /non-option relative/],
      ['project.git', { projectId, action: 'add', args: { files: ['../outside'] } }, /escapes repository/],
      ['project.git', { projectId, action: 'checkout', args: {} }, /exactly one/],
      ['project.git', { projectId, action: 'checkout', args: { branch: 'main', file: 'source.txt' } }, /exactly one/],
      ['project.git', { projectId, action: 'checkout', args: { branch: 'bad..ref' } }, /Invalid Git ref/],
      ['project.git', { projectId, action: 'commit', args: { message: 'bad\nmessage' } }, /Commit message/],
      ['project.git', { projectId, action: 'merge', args: {} }, /not registered/],
      ['user.info', { username: 'root' }, /Invalid managed username/],
      ['user.info', { username: 'not-managed' }, /not registered/],
      ['user.create', { username: 'not-managed' }, /not registered/],
      ['user.delete', { username: runAsUser, removeHome: true }, /offline recovery/],
      ['user.password', { username: runAsUser, password: 'short' }, /Password does not satisfy/],
      ['user.modify', { username: runAsUser, lockAccount: true, unlockAccount: true }, /Cannot lock and unlock/],
      ['user.modify', { username: runAsUser, addGroups: ['unregistered'] }, /Every group/],
      ['user.modify', { username: runAsUser, shell: '/bin/false' }, /shell is not registered/],
      ['user.modify', { username: runAsUser, expireDate: 'tomorrow' }, /Invalid account expiry/],
      ['user.ssh', { username: runAsUser, action: 'replace' }, /Invalid SSH key action/],
      ['project.cancel', { runId: 'bad' }, /Invalid run ID/],
    ];
    for (const [operation, parameters, message] of denials) await assert.rejects(call(operation, parameters), message);

    const allEntries = await call('project.file.list', { projectId, path: '.', showHidden: true });
    assert.ok(allEntries.entries.some(entry => entry.name === '.env.testing'));
    assert.equal((await call('project.file.info', { projectId, path: 'directory' })).type, 'directory');
  });

  it('serves newline-delimited typed requests on the protected Unix socket', async () => {
    const brokerServer = startBroker();
    await new Promise(resolve => (brokerServer.listening ? resolve() : brokerServer.once('listening', resolve)));
    const exchange = payload =>
      new Promise((resolve, reject) => {
        const socket = net.createConnection({ path: brokerSocket });
        let data = '';
        socket.setEncoding('utf8');
        socket.on('connect', () => socket.write(`${payload}\n`));
        socket.on('data', chunk => (data += chunk));
        socket.on('end', () => resolve(JSON.parse(data)));
        socket.on('error', reject);
      });
    const valid = await exchange(
      JSON.stringify({
        requestId: '99999999-9999-4999-8999-999999999999',
        operation: 'broker.health',
        parameters: {},
      })
    );
    assert.equal(valid.ok, true);
    const invalid = await exchange('{bad json');
    assert.equal(invalid.ok, false);
    await new Promise(resolve => brokerServer.close(resolve));
  });
});
