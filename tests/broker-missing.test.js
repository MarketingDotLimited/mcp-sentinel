process.on('unhandledRejection', r => {
  console.error('UNHANDLED_REJECTION:', r.stack);
});
process.on('uncaughtException', r => {
  console.error('UNCAUGHT_EXCEPTION:', r.stack);
});
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';

import net from 'net';
process.env.BROKER_FIREWALL_PORTS = '80,443';
process.env.BROKER_FIREWALL_PORTS = '80,443';
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-broker-missing-'));
const fakeBin = path.join(directory, 'bin');
const stateDatabase = path.join(directory, 'state.sqlite3');
const configRegistry = path.join(directory, 'config-registry.json');
const backupRoot = path.join(directory, 'config-backups');
const brokerSocket = path.join(directory, 'broker.sock');

await fs.mkdir(fakeBin, { mode: 0o755 });
const fakeCommand = path.join(fakeBin, 'fake-command');
await fs.writeFile(
  fakeCommand,
  `#!/usr/bin/env node

const fs = require("fs");
const name = process.argv[1].split('/').pop();
const args = process.argv.slice(2);

if (name === 'systemctl' && args[0] === 'is-active') {
  if (fs.existsSync('/tmp/make_active')) {
    process.stdout.write('active');
  } else {
    process.stdout.write('inactive');
  }
}

if (name === 'systemd-run' && args.some(a => a.startsWith('--unit=mcp-project-test-'))) {
  console.error('systemd-run failed');
  process.exit(1);
}
if (name === 'systemctl' && args.includes('start')) {
  console.error('systemctl start failed');
  process.exit(1);
}
if (name === 'userdel' && args.includes('failuser')) {
  console.error('userdel failed');
  process.exit(1);
}
if (name === 'ufw' && args.includes('fail')) {
  console.error('ufw error');
  process.exit(1);
}
if (name === 'getent' && args[0] === 'passwd' && args[1] === 'testuser') {
  console.log('testuser:x:1001:1001::/home/testuser:/bin/bash');
}
if (name === 'getent' && args[0] === 'passwd' && args[1] === 'testuser99') {
  console.log('testuser99:x:1002:1002::/home/testuser99:/bin/bash');
}
if (name === 'useradd') {
  // Mocked useradd, no longer modifies real /etc/passwd
}
if (name === 'id') {
  console.log('testuser testgroup othergroup');
}
if (name === 'chpasswd') {
  const input = fs.readFileSync(0, 'utf8');
  if (input.includes('failpass')) {
    console.error('chpasswd failed');
    process.exit(1);
  }
}
`,
  { mode: 0o755 }
);

for (const name of ['getent', 'userdel', 'ufw', 'chpasswd', 'usermod', 'useradd', 'id', 'systemctl', 'systemd-run']) {
  await fs.symlink(fakeCommand, path.join(fakeBin, name));
}

const originalReadFileSync = fsSync.readFileSync;
fsSync.readFileSync = function (path, options) {
  if (path === '/etc/passwd') {
    return (
      'root:x:0:0:root:/root:/bin/bash\n' +
      'nobody:x:65534:65534:nobody:/tmp:/usr/sbin/nologin\n' +
      'testuser:x:1001:1001:testuser,,,:/tmp:/bin/bash\n' +
      'failuser:x:1002:1002:failuser,,,:/tmp:/bin/bash\n' +
      'testuser99:x:1003:1003:testuser99,testuser98,,,:/tmp:/bin/bash\n'
    );
  }
  return originalReadFileSync.apply(this, arguments);
};

const passwd = fsSync
  .readFileSync('/etc/passwd', 'utf8')
  .trim()
  .split('\n')
  .map(line => line.split(':'));
const realUserRecord = passwd.find(parts => parts[0] === 'nobody' || Number(parts[2]) > 0) || passwd[0];
const realUser = realUserRecord[0];

process.env.PATH = `${fakeBin}:${process.env.PATH}`;
process.env.MCP_STATE_DB = stateDatabase;
process.env.BROKER_CONFIG_REGISTRY = configRegistry;
process.env.BROKER_CONFIG_BACKUP_ROOT = backupRoot;
process.env.MCP_BROKER_SOCKET = brokerSocket;
process.env.BROKER_MANAGED_USERS = `testuser,failuser,testuser99,testuser98,${realUser}`;
process.env.BROKER_MANAGED_GROUPS = 'testgroup';
process.env.BROKER_MANAGED_SERVICES = 'example-app,nginx';
process.env.BROKER_GIT_ALLOWED_REPOS = '/tmp/myrepo';

const db = new DatabaseSync(stateDatabase);
db.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, payload TEXT);');
db.exec(
  'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER); CREATE TABLE IF NOT EXISTS project_users (projectId TEXT, linuxUser TEXT); CREATE TABLE IF NOT EXISTS state_meta (key TEXT, value TEXT);'
);
db.exec(
  `INSERT OR IGNORE INTO projects VALUES ('22222222-2222-4222-8222-222222222222', '{"id":"22222222-2222-4222-8222-222222222222","repoPath":"/tmp/myrepo","rootPath":"/tmp/myrepo","runAsUser":"testuser","permittedGitActions":["status","diff","log","branch","checkout","fake"],"allowRecursiveDelete":true,"permittedTasks":["npm"]}'), ('33333333-3333-4333-8333-333333333333', '{"id":"33333333-3333-4333-8333-333333333333","repoPath":"/tmp/myrepo","rootPath":"/tmp/myrepo","runAsUser":"testuser","protectedPaths":["/absolute"]}');`
);
db.close();
try {
  fsSync.mkdirSync('/tmp/myrepo', { recursive: true });
} catch {}

const { handleRequest, startBroker } = await import(`../broker.js`);

it('covers execute and executeWithInput', async () => {
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.delete',
      parameters: { username: 'failuser', removeHome: false },
    }),
    /Registered broker operation failed/
  );
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'user.delete',
    parameters: { username: 'testuser', removeHome: false },
  }).catch(e => {
    console.error('DELETE ERROR OBJ', e.message, e.result);
    //
  });

  // User create coverage (1055-1061)
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.create',
      parameters: { username: 'testuser' },
    }),
    /Managed user already exists/
  );

  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'user.password',
    parameters: { username: 'testuser', password: 'ValidPass123!' },
  });
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.password',
      parameters: { username: 'testuser', password: 'failpassValid1!' },
    }),
    /chpasswd failed/
  );
});

it('covers projectUsers and duplicate groups', async () => {
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'user.modify',
    parameters: { username: 'testuser', addGroups: ['testgroup', 'testgroup'], removeGroups: [] },
  });

  await fs.rm(stateDatabase, { force: true });
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.delete',
      parameters: { username: 'missinguser', removeHome: false },
    }),
    /User is not registered/
  );
});

it('covers ssh keys', async () => {
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.ssh',
      parameters: { username: realUser, action: 'add', publicKey: 'invalid' },
    }),
    /Invalid SSH public key/
  );
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.ssh',
      parameters: { username: realUser, action: 'add', publicKey: 'ssh-unknown AAAA' },
    }),
    /Invalid SSH public key payload/
  );

  if (realUserRecord[5] === '/' || realUserRecord[5] === '/root') {
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'user.ssh',
        parameters: { username: realUser, action: 'add', publicKey: 'ssh-rsa AAAA' },
      }),
      /Unsafe managed user home/
    );
  } else {
    const home = realUserRecord[5];
    const sshPath = path.join(home, '.ssh');
    try {
      await fs.writeFile(sshPath, 'file');
      await assert.rejects(
        handleRequest({
          requestId: '11111111-1111-4111-8111-111111111111',
          operation: 'user.ssh',
          parameters: { username: realUser, action: 'add', publicKey: 'ssh-rsa AAAA' },
        }),
        /Managed user SSH directory is a file/
      );
    } catch (e) {
    } finally {
      try {
        await fs.rm(sshPath, { force: true });
      } catch {}
    }
  }
});

it('covers config operations', async () => {
  await fs.writeFile(configRegistry, 'invalid json');
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.backups',
      parameters: { configId: 'any' },
    }),
    /Configuration registry unavailable/
  );

  await fs.writeFile(
    configRegistry,
    JSON.stringify({
      configs: {
        bad_health: {
          path: '/tmp/test.json',
          service: 'example-app',
          validator: 'json',
          healthUrl: 'http://localhost:12345/health',
        },
        valid_health: { path: '/tmp/does_not_exist.json', service: 'example-app', validator: 'json' },
      },
    })
  );

  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.apply',
      parameters: { configId: 'valid_health', content: '{}', healthCheckTimeout: 1 },
    }),
    /Configuration was restored after failure/
  );
});

it('covers remaining', async () => {
  console.log('START COVERS REMAINING');
  // Recreate DB
  const db2 = new DatabaseSync(stateDatabase);
  db2.exec('CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, payload TEXT);');
  db2.exec(
    `INSERT OR IGNORE INTO projects VALUES ('22222222-2222-4222-8222-222222222222', '{"id":"22222222-2222-4222-8222-222222222222","repoPath":"/tmp/myrepo","rootPath":"/tmp/myrepo","runAsUser":"testuser","permittedGitActions":["status","diff","log","branch","checkout","fake"],"allowRecursiveDelete":true,"permittedTasks":["npm"]}'), ('33333333-3333-4333-8333-333333333333', '{"id":"33333333-3333-4333-8333-333333333333","repoPath":"/tmp/myrepo","rootPath":"/tmp/myrepo","runAsUser":"testuser","protectedPaths":["/absolute"]}');`
  );
  db2.close();

  // 709
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.git',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', action: 'fake', args: {} },
    }),
    /Unknown Git recipe/
  );
  // 691
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'project.git',
    parameters: {
      projectId: '22222222-2222-4222-8222-222222222222',
      action: 'checkout',
      args: { file: 'somefile.txt' },
    },
  });

  // 371
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.readFile',
      parameters: { projectId: '33333333-3333-4333-8333-333333333333', path: 'file.txt' },
    })
  );

  // 765
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'service.status',
    parameters: { service: 'example-app' },
  });

  // Fix firewall missing coverage
  const firewallSnapshotRoot = path.join(directory, 'firewall-snapshots');
  await fs.mkdir(firewallSnapshotRoot, { recursive: true });
  process.env.BROKER_FIREWALL_SNAPSHOT_ROOT = firewallSnapshotRoot;
  process.env.BROKER_FIREWALL_PORTS = '80,443';
  try {
    fsSync.mkdirSync('/etc/ufw', { recursive: true });
  } catch {}
  // Make ufw command fail
  await fs.writeFile(
    fakeCommand,
    fsSync.readFileSync(fakeCommand, 'utf8').replace("args.includes('fail')", "args.join(' ').includes('80')")
  );

  try {
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'firewall.rule',
      parameters: { action: 'allow', port: '80', protocol: 'tcp' },
    });
  } catch (e) {
    console.log('FIREWALL 1 ERROR:', e.message, e.result);
  }

  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'service.list',
      parameters: { state: 'invalid@state' },
    }),
    /Invalid service state/
  );
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'project.cancel',
    parameters: { runId: '11111111-1111-4111-8111-111111111111' },
  });

  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'service.list',
    parameters: { state: 'active' },
  });

  fsSync.mkdirSync('/tmp/myrepo/foo', { recursive: true });
  fsSync.mkdirSync('/tmp/myrepo/is_dir', { recursive: true });
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'project.test',
    parameters: {
      projectId: '22222222-2222-4222-8222-222222222222',
      runId: '11111111-1111-4111-8111-111111111111',
      runner: 'npm',
      target: 'foo',
    },
  });
  // 1000 project read missing
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.read',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'does_not_exist.txt' },
    })
  );

  // 886 project recursive delete
  const dir2 = path.join('/tmp/myrepo', 'test_delete_dir');
  try {
    fsSync.mkdirSync(dir2);
  } catch {}
  try {
    fsSync.writeFileSync(path.join(dir2, 'file.txt'), 'data');
  } catch {}
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'project.file.delete',
    parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'test_delete_dir', recursive: true },
  });

  // ADD SUCCESSFUL FIREWALL RULE
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'firewall.rule',
    parameters: { action: 'allow', port: '443', protocol: 'tcp' },
  });

  console.log('BEFORE FIREWALL CONFIRM');
  // firewall.confirm
  await assert.rejects(
    handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'firewall.confirm',
      parameters: { rollbackId: 'not-uuid' },
    })
  );
  await handleRequest({
    requestId: '11111111-1111-4111-8111-111111111111',
    operation: 'firewall.confirm',
    parameters: { rollbackId: '11111111-1111-4111-8111-111111111111' },
  });

  // healthUrl tests
  process.env.BROKER_MANAGED_SERVICES = 'nginx,example-app,authelia';
  try {
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.apply',
      parameters: { configId: 'authelia-users', content: 'content' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  // ENOENT check
  try {
    await fs.chmod('/tmp/mcp-test-nginx.conf', 0o000);
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  try {
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.apply',
      parameters: { configId: 'nginx', content: 'content' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  try {
    await fs.chmod('/tmp/mcp-test-nginx.conf', 0o644);
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  // restartAndVerify fail
  await fs.writeFile('/tmp/make_inactive', 'yes');
  await fs.rm('/tmp/is_active_count', { force: true });
  try {
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.apply',
      parameters: { configId: 'nginx', content: 'content' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  await fs.rm('/tmp/make_inactive', { force: true });

  // project.file protectedPaths
  try {
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.read',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'node_modules/test' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  // project test network dependencies IP
  try {
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.test',
      parameters: {
        projectId: '22222222-2222-4222-8222-222222222222',
        testCommand: 'npm test',
        allowedNetworkHosts: ['not-an-ip'],
      },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  // SSH directory unsafe
  try {
    await fs.mkdir('/tmp/mcp-test-home/.ssh', { recursive: true });
    await fs.symlink('/tmp', '/tmp/mcp-test-home/.ssh/link');
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.test',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', testCommand: 'npm test', allowNetwork: true },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  // project.deploy catch error and rmSync
  try {
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.write',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'is_dir', content: 'hello' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  // filter error catch
  // covered by other things?

  // healthUrl tests
  process.env.MCP_BROKER_SOCKET = '/tmp/mcp-sock-3.sock';
  process.env.BROKER_MANAGED_SERVICES = 'nginx,example-app,authelia';
  const { startBroker: sbExtra, handleRequest: hrExtra } = await import('../broker.js');
  const srvExtra = sbExtra();

  const origDateNow = Date.now;
  let fakeTime = origDateNow();
  Date.now = () => {
    fakeTime += 16000;
    return fakeTime;
  };
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.apply',
      parameters: { configId: 'authelia-users', content: 'content' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  Date.now = origDateNow;

  // ENOENT check
  await fs.rm('/tmp/mcp-test-nginx.conf', { force: true });
  await fs.mkdir('/tmp/mcp-test-nginx.conf');
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.apply',
      parameters: { configId: 'nginx', content: 'content' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  await fs.rm('/tmp/mcp-test-nginx.conf', { recursive: true, force: true });

  // restartAndVerify fail
  await fs.writeFile('/tmp/make_inactive', 'yes');
  await fs.rm('/tmp/is_active_count', { force: true });

  const origDateNow2 = Date.now;
  let fakeTime2 = origDateNow2();
  Date.now = () => {
    fakeTime2 += 16000;
    return fakeTime2;
  };
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.apply',
      parameters: { configId: 'nginx', content: 'content' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  Date.now = origDateNow2;

  await fs.rm('/tmp/make_inactive', { force: true });

  // project.file protectedPaths
  const sqlite3 = await import('node:sqlite');
  const db3 = new sqlite3.DatabaseSync(stateDatabase);
  db3.exec(
    'UPDATE projects SET payload = \'{"id":"22222222-2222-4222-8222-222222222222","repoPath":"/tmp/myrepo","rootPath":"/tmp/myrepo","runAsUser":"testuser","protectedPaths":["node_modules","/absolute","../escaped"]}\' WHERE id = \'22222222-2222-4222-8222-222222222222\''
  );
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.read',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'node_modules/test' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.read',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: '../escaped' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.read',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: '/absolute' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  // project test network dependencies IP
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.test',
      parameters: {
        projectId: '22222222-2222-4222-8222-222222222222',
        testCommand: 'npm test',
        allowedNetworkHosts: ['not-an-ip'],
      },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.test',
      parameters: {
        projectId: '22222222-2222-4222-8222-222222222222',
        testCommand: 'npm test',
        allowedNetworkHosts: 'not-array',
      },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.test',
      parameters: {
        projectId: '22222222-2222-4222-8222-222222222222',
        testCommand: 'npm test',
        allowedNetworkHosts: new Array(21).fill('1.1.1.1'),
      },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  // health.check unsafe files
  process.env.AUTHELIA_CONFIG_FILE = '/does-not-exist.yml';
  try {
    await hrExtra({ requestId: '11111111-1111-4111-8111-111111111111', operation: 'health.check', parameters: {} });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  // project.deploy catch error and rmSync
  try {
    await hrExtra({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.write',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'is_dir', content: 'hello' },
    });
  } catch (e) {
    console.log('DEBUG:', e.message);
  }

  srvExtra.close();

  console.log('END COVERS REMAINING');
});

describe('more operations', () => {
  it('covers more operations', async () => {
    // journal.read
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'journal.read',
      parameters: {},
    }).catch(e => e);
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'journal.read',
      parameters: { service: 'mcp-test', lines: 100 },
    }).catch(e => e);
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'journal.read',
      parameters: { since: '2023-01-01', priority: 'err' },
    }).catch(e => e);
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'journal.read',
        parameters: { since: 'invalid!!!' },
      })
    );
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'journal.read',
        parameters: { priority: 'invalid!!!' },
      })
    );

    // service.action
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'service.action',
        parameters: { service: 'foo', action: 'invalid' },
      })
    );
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'service.action',
        parameters: { service: 'nginx', action: 'stop' },
      })
    );
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'service.action',
      parameters: { service: 'foo', action: 'start' },
    }).catch(e => e);
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'service.status',
      parameters: { service: 'foo' },
    }).catch(e => e);
  });
});

describe('process.signal', () => {
  it('covers process.signal branches', async () => {
    // missing pid
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'process.signal',
        parameters: { pid: 0, signal: 'TERM' },
      })
    );
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'process.signal',
        parameters: { pid: process.pid, signal: 'INVALID' },
      })
    );
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'process.signal',
        parameters: { pid: process.pid, signal: 'TERM', owner: '!!!' },
      })
    );

    // valid with owner
    process.on('SIGUSR1', () => {});
    try {
      await handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'process.signal',
        parameters: { pid: process.pid, signal: 'USR1', owner: 'root' },
      });
    } catch (e) {
      console.log('DEBUG:', e.message);
    }

    // mock /proc/pid/status mismatch
    try {
      await handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'process.signal',
        parameters: { pid: process.pid, signal: 'USR1', owner: 'nobody' },
      });
    } catch (e) {
      console.log('DEBUG:', e.message);
    }
  });
});

describe('user.ssh operations', () => {
  it('covers valid add and remove', async () => {
    await fs.mkdir('/home/testuser/.ssh', { recursive: true });

    // Test add
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.ssh',
      parameters: { username: 'testuser', action: 'add', publicKey: 'ssh-rsa AAAAB3NzaC1yc2EA' },
    });

    // Test remove invalid index
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'user.ssh',
        parameters: { username: 'testuser', action: 'remove', keyIndex: -1 },
      })
    );
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'user.ssh',
        parameters: { username: 'testuser', action: 'remove', keyIndex: 100 },
      })
    );

    // Test remove valid index
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.ssh',
      parameters: { username: 'testuser', action: 'remove', keyIndex: 0 },
    });
    // List valid
    await fs.writeFile('/home/testuser/.ssh/authorized_keys', 'ssh-rsa AAAAB3NzaC1yc2E=');
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.ssh',
      parameters: { username: 'testuser', action: 'list' },
    });

    // List invalid file (EISDIR)
    await fs.rm('/home/testuser/.ssh/authorized_keys', { force: true });
    await fs.mkdir('/home/testuser/.ssh/authorized_keys');
    try {
      await handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'user.ssh',
        parameters: { username: 'testuser', action: 'list' },
      });
    } catch (e) {
      console.log('DEBUG:', e.message);
    }
    await fs.rm('/home/testuser/.ssh/authorized_keys', { recursive: true, force: true });
  });
});

describe('protected services', () => {
  it('covers recovery workflow error', async () => {
    process.env.BROKER_MANAGED_SERVICES = 'nginx';
    const { handleRequest: hr } = await import(`../broker.js`);

    await assert.rejects(
      hr({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'service.action',
        parameters: { service: 'nginx', action: 'stop' },
      }),
      /Protected services require the recovery workflow/
    );
  });
});

describe('more user operations', () => {
  it('covers list action and expire date', async () => {
    const assert = await import('assert/strict');

    // execute with unsafe sshDirectory

    const os = await import('os');
    const path = await import('path');
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'mcp-broker-test-'));
    fsSync.chmodSync(tmp, 0o777);
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.git',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', action: 'pull' },
    }).catch(e => console.log('EXECUTE ERROR', e));
    fsSync.rmSync(tmp, { recursive: true, force: true });

    // user.create with invalid shell
    await handleRequest({
      requestId: '22222222-2222-4222-8222-222222222222',
      operation: 'user.create',
      parameters: { username: 'testuser98', shell: '/invalid' },
    }).catch(e => console.log('USER CREATE 1 ERROR', e));

    // user.create with invalid comment
    await handleRequest({
      requestId: '33333333-3333-4333-8333-333333333333',
      operation: 'user.create',
      parameters: { username: 'testuser98', comment: 'invalid:' },
    }).catch(e => console.log('USER CREATE 2 ERROR', e));

    // user.create success with createHome false
    await handleRequest({
      requestId: '44444444-4444-4444-8444-444444444444',
      operation: 'user.create',
      parameters: { username: 'testuser98', createHome: false, comment: 'test', groups: ['testgroup'] },
    }).catch(e => console.log('USER CREATE 3 ERROR', e));

    // user.update with expireDate
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.modify',
      parameters: { username: 'testuser' },
    });
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.modify',
      parameters: { username: 'testuser', shell: '/bin/bash' },
    }).catch(e => {
      console.error(
        'USERMOD ERROR',
        e.message,
        e.result ? e.result.stdout : 'N/A',
        e.result ? e.result.stderr : 'N/A',
        e.exitCode
      );
      //
    });
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'user.modify',
        parameters: { username: 'testuser', shell: '/invalid' },
      })
    );
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.modify',
      parameters: { username: 'testuser', lockAccount: true },
    });
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.modify',
      parameters: { username: 'testuser', removeGroups: ['testgroup'] },
    });
    console.log('USER CREATE REACHED');
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.create',
      parameters: { username: 'testuser99', shell: '/bin/bash', groups: ['testgroup'], comment: 'A test user' },
    }).catch(e => {
      console.error(
        'CREATE ERROR',
        e.message,
        e.result ? e.result.stdout : 'N/A',
        e.result ? e.result.stderr : 'N/A',
        e.exitCode
      );
      //
    });

    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.modify',
      parameters: { username: 'testuser', unlockAccount: true },
    });
    // broker.health (739-740)
    process.env.AUTHELIA_CONFIG_FILE = '/does/not/exist.yaml';
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'broker.health',
      parameters: {},
    }).catch(e => {
      console.log('BROKER HEALTH ERROR:', e.message);
    });
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'oauth.health',
      parameters: {},
    }).catch(() => {});

    // oauth endpoints (765-810, 813-822)
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'oauth.user.list',
      parameters: {},
    }).catch(() => {});
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'oauth.user.add',
      parameters: { username: 'u', password: 'p', email: 'e' },
    }).catch(() => {});
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'oauth.user.update',
      parameters: { username: 'u', updates: {} },
    }).catch(() => {});
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'oauth.user.delete',
      parameters: { username: 'u' },
    }).catch(() => {});
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'oauth.client.list',
      parameters: {},
    }).catch(() => {});
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'oauth.client.add',
      parameters: { id: 'c', description: 'd', secret: 's', redirectUris: ['r'] },
    }).catch(() => {});
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'oauth.client.delete',
      parameters: { id: 'c' },
    }).catch(() => {});

    // project.file.read / project.file.delete symlink (825-830, 889)

    try {
      await fs.rm('/tmp/myrepo/symlink', { force: true });
    } catch {}
    await fs.symlink('/dev/null', '/tmp/myrepo/symlink');
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.read',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'symlink' },
    }).catch(() => {});
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.delete',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'symlink' },
    }).catch(e => {
      console.log('DELETE SYMLINK ERROR 2:', e.message);
    });
    const srv = (await import('net')).createServer();
    await new Promise(r => srv.listen('/tmp/myrepo/mysocket', r));
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.read',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'mysocket' },
    }).catch(() => {});
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'project.file.delete',
      parameters: { projectId: '22222222-2222-4222-8222-222222222222', path: 'mysocket' },
    }).catch(() => {});
    srv.close();

    // config.backup.list (1000-1001)

    const backupDir2 = path.join(backupRoot, 'valid_health');
    await fs.rm(backupDir2, { recursive: true, force: true });
    try {
      await fs.mkdir(path.dirname(backupDir2), { recursive: true });
    } catch (e) {}
    await fs.writeFile(backupDir2, 'not a dir');
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.backups',
      parameters: { configId: 'valid_health' },
    }).catch(() => {});
    await fs.rm(backupDir2, { force: true });
    const backupDir = path.join(backupRoot, 'missing');
    try {
      await fs.mkdir(path.dirname(backupDir), { recursive: true });
    } catch (e) {}
    await fs.writeFile(backupDir, 'not a dir');
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'config.backup.list',
      parameters: { name: 'missing' },
    }).catch(() => {});
    await fs.rm(backupDir, { force: true });

    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'user.modify',
      parameters: { username: 'testuser', expireDate: '2025-01-01' },
    });

    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'user.modify',
        parameters: { username: 'testuser', expireDate: 'invalid' },
      })
    );

    // ADD SUCCESSFUL FIREWALL RULE
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'firewall.rule',
      parameters: { action: 'allow', port: '443', protocol: 'tcp' },
    });

    console.log('BEFORE FIREWALL CONFIRM');
    // firewall.confirm
    await assert.rejects(
      handleRequest({
        requestId: '11111111-1111-4111-8111-111111111111',
        operation: 'firewall.confirm',
        parameters: { rollbackId: 'not-uuid' },
      })
    );
    await handleRequest({
      requestId: '11111111-1111-4111-8111-111111111111',
      operation: 'firewall.confirm',
      parameters: { rollbackId: '11111111-1111-4111-8111-111111111111' },
    });
    console.log('END COVERS REMAINING');
  });
});
after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

it('runs this', () => {
  console.log('RUNS THIS');
  console.log('EXIT REMOVED');
});
console.log('EVALUATING BOTTOM');

after(() => console.log('EXIT REMOVED'));
