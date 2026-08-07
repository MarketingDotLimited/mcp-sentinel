import '../test-env.js';
import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import originalFs from 'fs/promises';
import originalOs from 'node:os';

let realpathCallCount = 0;
let forceEmptyExec = false;
let mockOsNetwork = false;

mock.module('fs/promises', {
  namedExports: {
    stat: async p => {
      if (p === '/fake/file-project') return { isDirectory: () => false };
      if (
        p === '/fake/real-project' ||
        p === '/fake/real-allowed' ||
        p === '/fake/eacces-project' ||
        p === '/fake/wrong-env' ||
        p === '/fake/wrong-db' ||
        p === '/fake/missing-env' ||
        p === '/fake/fallback-db'
      )
        return { isDirectory: () => true };
      return originalFs.stat(p);
    },
    realpath: async p => {
      if (p === path.resolve('/fake/requested') || p === '/fake/requested') {
        realpathCallCount++;
        if (realpathCallCount === 1) return '/fake/real-project';
        return '/fake/real-allowed';
      }
      if (p === path.join('/fake/real-project', 'symlink-outside')) return '/fake/outside';
      if (
        p === '/fake/real-project' ||
        p === '/fake/real-allowed' ||
        p === '/fake/real-project/t1' ||
        p === path.resolve('/fake/real-project/t1') ||
        p === '/fake/eacces-project' ||
        p === '/fake/wrong-env' ||
        p === '/fake/wrong-db' ||
        p === '/fake/missing-env' ||
        p === '/fake/fallback-db' ||
        p === '/fake/file-project'
      )
        return p;
      return originalFs.realpath(p);
    },
    readFile: async (p, encoding) => {
      if (p === path.join('/fake/real-project', '.env.testing')) {
        return 'APP_ENV=testing\nDB_DATABASE=fake_db\n';
      }
      if (p === path.join('/fake/wrong-env', '.env.testing')) {
        return 'APP_ENV=production\nDB_DATABASE=fake_db\n';
      }
      if (p === path.join('/fake/missing-env', '.env.testing')) {
        return 'DB_DATABASE=fake_db\n';
      }
      if (p === path.join('/fake/fallback-db', '.env.testing')) {
        return 'DATABASE_DATABASE=fake_db\n';
      }
      if (p === path.join('/fake/wrong-db', '.env.testing')) {
        return 'APP_ENV=testing\nDB_DATABASE=wrong_db\n';
      }
      if (p === path.join('/fake/eacces-project', '.env.testing')) {
        const err = new Error('EACCES');
        err.code = 'EACCES';
        throw err;
      }
      return originalFs.readFile(p, encoding);
    },
  },
});

mock.module('node:os', {
  namedExports: {
    ...originalOs,
    cpus: () => (forceEmptyExec ? [] : originalOs.cpus()),
    networkInterfaces: () => {
      if (mockOsNetwork) {
        return { eth0: [{ address: '127.0.0.1', family: 'IPv4' }] }; // missing cidr
      }
      return originalOs.networkInterfaces();
    },
  },
});

mock.module('../../lib/exec.js', {
  namedExports: {
    secureExec: async (args, identity) => {
      if (forceEmptyExec === true) {
        if (args[0] === 'ps') return { stdout: 'HEADER\n' };
        throw new Error('fail');
      }
      if (forceEmptyExec === 'empty_string') {
        if (args[0] === 'cat' && args[1] === '/proc/loadavg') return { stdout: ' ' };
        return { stdout: '   ' };
      }
      if (args[0] === 'uptime') return { stdout: 'up 1 hour\n' };
      if (args[0] === 'free') return { stdout: 'Mem: 16G\n' };
      if (args[0] === 'cat' && args[1] === '/proc/loadavg') return { stdout: '0.00 0.01 0.05\n' };
      if (args[0] === 'df') return { stdout: 'source\n/dev/sda1\n' };
      if (args[0] === 'who') return { stdout: 'user1\n' };
      if (args[0] === 'ps') {
        return { stdout: 'HEADER\nps1 cmd1\nps2 cmd2 filterme\n' };
      }
      return { stdout: '' };
    },
  },
});

mock.module('../../lib/broker-client.js', {
  namedExports: {
    brokerCall: async () => ({}),
  },
});

mock.module('../../lib/project-operation-dispatcher.js', {
  namedExports: {
    dispatchProjectOperation: async (projectId, identity, operation, payload, options) => {
      if (operation === 'project.cancel') return { exitCode: 0 };
      if (payload.runner === 'artisan' && payload.target === 'fail_with_stderr')
        return { exitCode: 1, stderr: 'Custom error' };
      if (payload.runner === 'artisan' && payload.target === 'exit_2') return { exitCode: 2 };
      if (payload.runner === 'artisan' && payload.target === 'unsafe')
        return { exitCode: 1, stderr: '.env.testing is missing' };
      if (payload.runner === 'artisan') return { exitCode: 1 };
      if (payload.runner === 'npm' && payload.target === 'timeout') {
        const err = new Error('timeout');
        err.code = 'ETIMEDOUT';
        err.stdout = 'A'.repeat(1048577);
        throw err;
      }
      if (payload.runner === 'npm') {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 100);
          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              const err = new Error('abort');
              err.signal = 'SIGTERM';
              reject(err);
            });
          }
        });
      }
      return { exitCode: 0, stdout: 'Tests passed', stderr: '' };
    },
  },
});

mock.module('../../lib/control-plane.js', {
  namedExports: {
    getProject: async () => ({ id: 'default-project' }),
    loadTaskRunState: async runId => {
      if (runId === 'found-db')
        return {
          runId: 'found-db',
          projectId: 'p1',
          state: 'completed',
          stdout: 'loaded',
          stderr: '',
          exitCode: 0,
          owner: JSON.stringify({ subject: 'u1', clientId: null, userId: 'u1' }),
        };
      return null;
    },
    resolveProjectTransport: async projectId => {
      if (projectId === 'p2')
        return {
          kind: 'ssh-gateway',
          project: { id: 'p2', runAsUser: 'u1', permittedTasks: ['unknown_runner', 'npm'], allowFullSuite: true },
        };
      if (projectId === 'p3')
        return {
          kind: 'local',
          project: {
            id: 'p3',
            runAsUser: 'u1',
            permittedTasks: ['npm'],
            repoPath: '/fake/requested',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p4')
        return { kind: 'local', project: { id: 'p4', runAsUser: 'u1', rootPath: '/fake/requested' } }; // no permittedTasks
      if (projectId === 'p10') return { project: { id: 'p10', permittedTasks: ['npm'] } }; // no transport, no runAsUser
      if (projectId === 'p11')
        return {
          kind: 'local',
          project: {
            id: 'p11',
            runAsUser: 'u1',
            permittedTasks: ['artisan'],
            testDatabase: 'fake_db',
            rootPath: '/fake/wrong-env',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p12')
        return {
          kind: 'local',
          project: {
            id: 'p12',
            runAsUser: 'u1',
            permittedTasks: ['artisan'],
            testDatabase: 'fake_db',
            rootPath: '/fake/wrong-db',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p13')
        return {
          kind: 'local',
          project: {
            id: 'p13',
            runAsUser: 'u1',
            permittedTasks: ['artisan'],
            testDatabase: 'fake_db',
            rootPath: '/fake/missing-env',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p14')
        return {
          kind: 'local',
          project: {
            id: 'p14',
            runAsUser: 'u1',
            permittedTasks: ['artisan'],
            rootPath: '/fake/real-allowed',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p15')
        return {
          kind: 'local',
          project: { id: 'p15', runAsUser: 'u1', permittedTasks: ['npm'], allowFullSuite: true },
        }; // no rootPath/repoPath
      if (projectId === 'p16')
        return {
          kind: 'local',
          project: {
            id: 'p16',
            runAsUser: 'u1',
            permittedTasks: ['npm'],
            rootPath: '/fake/file-project',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p17')
        return {
          kind: 'local',
          project: {
            id: 'p17',
            runAsUser: 'u1',
            permittedTasks: ['artisan'],
            testDatabase: 'fake_db',
            rootPath: '/fake/fallback-db',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p5')
        return {
          kind: 'local',
          project: {
            id: 'p5',
            runAsUser: 'u1',
            permittedTasks: ['artisan'],
            testDatabase: 'fake_db',
            rootPath: '/fake/requested',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p6')
        return {
          kind: 'local',
          project: { id: 'p6', runAsUser: 'u1', permittedTasks: ['npm'], rootPath: '/fake/requested' },
        }; // no allowFullSuite
      if (projectId === 'p7')
        return {
          kind: 'local',
          project: {
            id: 'p7',
            runAsUser: 'u1',
            permittedTasks: ['python'],
            rootPath: '/fake/requested',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p8')
        return {
          kind: 'local',
          project: {
            id: 'p8',
            runAsUser: 'u1',
            permittedTasks: ['rust'],
            rootPath: '/fake/requested',
            allowFullSuite: true,
          },
        };
      if (projectId === 'p9')
        return {
          kind: 'local',
          project: {
            id: 'p9',
            runAsUser: 'u1',
            permittedTasks: ['artisan'],
            testDatabase: 'fake_db',
            rootPath: '/fake/eacces-project',
            allowFullSuite: true,
          },
        };
      return {
        kind: 'local',
        project: {
          id: 'p1',
          runAsUser: 'u1',
          permittedTasks: ['npm', 'artisan'],
          allowFullSuite: true,
          rootPath: '/fake/requested',
        },
      };
    },
    persistTaskRun: async () => ({}),
  },
});

const {
  getSystemInfo,
  getProcesses,
  killProcess,
  startProjectTestRun,
  cancelProjectTestRun,
  buildProjectTestInvocation,
  pruneProjectTestRuns,
  getProjectTestRun,
  runProjectTests,
} = await import('../../tools/system.js');
const { secureExec } = await import('../../lib/exec.js');

describe('system tools', () => {
  it('getSystemInfo as admin', async () => {
    forceEmptyExec = false;
    mockOsNetwork = false;
    const info = await getSystemInfo({}, { role: 'admin' });
    assert.strictEqual(info.disk_usage, 'source\n/dev/sda1');
  });

  it('getSystemInfo as admin with fallbacks', async () => {
    forceEmptyExec = true;
    mockOsNetwork = true;
    const info = await getSystemInfo({}, { role: 'admin' });
    assert.strictEqual(info.disk_usage, 'N/A');
    assert.strictEqual(info.uptime, 'N/A');
    assert.strictEqual(info.memory_usage, 'N/A');
    assert.strictEqual(info.cpu_model, 'Unknown');
    assert.ok(info.load_avg);
    assert.strictEqual(info.logged_in_users, 'N/A');
    assert.strictEqual(info.network_interfaces.eth0[0], '127.0.0.1/? (IPv4)');
    forceEmptyExec = false;
    mockOsNetwork = false;
  });

  it('getSystemInfo as admin with empty strings', async () => {
    forceEmptyExec = 'empty_string';
    const info = await getSystemInfo({}, { role: 'admin' });
    assert.strictEqual(info.uptime, 'N/A');
    assert.strictEqual(info.memory_usage, 'N/A');
    forceEmptyExec = false;
  });

  it('getSystemInfo as non-admin', async () => {
    const info = await getSystemInfo({}, { role: 'user' });
    assert.strictEqual(info.disk_usage, 'Access Denied');
  });

  it('getProcesses as admin without asUser', async () => {
    const p = await getProcesses({}, { role: 'admin' });
    assert.ok(p.processes.includes('ps1'));
  });

  it('getProcesses with empty output', async () => {
    forceEmptyExec = 'empty_string';
    const p = await getProcesses({ filter: 'none' }, { role: 'admin' });
    assert.strictEqual(p.processes.trim(), '');
    forceEmptyExec = false;
  });

  it('getProcesses as admin with asUser', async () => {
    const p = await getProcesses({ asUser: 'u1' }, { role: 'admin' });
    assert.ok(p.processes.includes('ps1'));
  });

  it('getProcesses as non-admin', async () => {
    const p = await getProcesses({}, { role: 'user', userId: 'u2' });
    assert.ok(p.processes.includes('ps1'));
  });

  it('getProcesses with filter', async () => {
    const p = await getProcesses({ filter: 'filterme' }, { role: 'admin' });
    assert.ok(p.processes.includes('filterme'));
    assert.ok(!p.processes.includes('ps1'));
  });

  it('killProcess requires pid', async () => {
    await assert.rejects(killProcess({}, {}), /pid is required/);
  });

  it('killProcess invalid signal', async () => {
    await assert.rejects(killProcess({ pid: 1, signal: 'INVALID' }, {}), /Invalid signal/);
  });

  it('killProcess as admin', async () => {
    const r = await killProcess({ pid: 1 }, { role: 'admin' });
    assert.strictEqual(r.success, true);
  });

  it('killProcess as non-admin', async () => {
    const r = await killProcess({ pid: 1, signal: 'KILL' }, { role: 'user', userId: 'u1' });
    assert.strictEqual(r.success, true);
  });

  it('startProjectTestRun with default resolveRegisteredProject without projectId throws', async () => {
    await assert.rejects(
      startProjectTestRun({ confirm: true, runner: 'npm' }, {}, secureExec),
      /projectId is required/
    );
  });

  it('startProjectTestRun throws if recipe is not permitted', async () => {
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'unknown', projectId: 'p1' },
        { role: 'user', userId: 'u1' },
        secureExec
      ),
      /This test recipe is not permitted for the project/
    );
    // Cover missing permittedTasks fallback
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', projectId: 'p4' },
        { role: 'user', userId: 'u1' },
        secureExec
      ),
      /This test recipe is not permitted for the project/
    );
  });

  it('startProjectTestRun with brokerExecution uses dispatchProjectOperation with explicit targets', async () => {
    const identity = { role: 'user', userId: 'u1' };
    const run = await startProjectTestRun(
      { confirm: true, runner: 'npm', projectId: 'p1', target: 't1', filter: 'f1' },
      identity,
      secureExec
    );
    const cancelled = await cancelProjectTestRun({ confirm: true, runId: run.runId }, identity);
    assert.strictEqual(cancelled.state, 'cancelled');
  });

  it('startProjectTestRun with brokerExecution and empty target/filter', async () => {
    const identity = { role: 'user', userId: 'u1' };
    const run = await startProjectTestRun({ confirm: true, runner: 'npm', projectId: 'p1' }, identity, secureExec);
    const result = await run.completion;
    assert.strictEqual(result.exitCode, 0);
  });

  it('startProjectTestRun with laravel missing testDatabase throws', async () => {
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'artisan', projectId: 'p1' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /The registered project must declare testDatabase before Laravel tests can run/
    );
  });

  it('startProjectTestRun with laravel fails with EACCES', async () => {
    realpathCallCount = 0;
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'artisan', projectId: 'p9' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /EACCES/
    );
  });

  it('startProjectTestRun with laravel fails with ENOENT', async () => {
    realpathCallCount = 0;
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'artisan', projectId: 'p14' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /Laravel project tests require a readable \.env\.testing file/
    );
  });

  it('startProjectTestRun with laravel fails with wrong APP_ENV', async () => {
    realpathCallCount = 0;
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'artisan', projectId: 'p11' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /.env.testing must set APP_ENV=testing/
    );

    // missing APP_ENV should succeed (or proceed to check DB)
    realpathCallCount = 0;
    const run = await startProjectTestRun(
      { confirm: true, runner: 'artisan', projectId: 'p13' },
      { role: 'user', userId: 'u1' },
      async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
    );
    await run.completion;

    // fallback DB (DATABASE_DATABASE) should succeed
    realpathCallCount = 0;
    const runFb = await startProjectTestRun(
      { confirm: true, runner: 'artisan', projectId: 'p17' },
      { role: 'user', userId: 'u1' },
      async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
    );
    await runFb.completion;

    // test filter branches
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'artisan', projectId: 'p5', filter: ' ' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /filter must be 1-256 characters on one line/
    );
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'artisan', projectId: 'p5', filter: 'a'.repeat(257) },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /filter must be 1-256 characters on one line/
    );
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'artisan', projectId: 'p5', filter: 'a\nb' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /filter must be 1-256 characters on one line/
    );
  });

  it('startProjectTestRun with laravel fails with wrong DB_DATABASE', async () => {
    realpathCallCount = 0;
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'artisan', projectId: 'p12' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /.env.testing database does not match the project registered testDatabase/
    );
  });

  it('startProjectTestRun local execution filter varieties', async () => {
    // filterFlag
    let run = await startProjectTestRun(
      { confirm: true, runner: 'python', projectId: 'p7', filter: 'f1' },
      { role: 'user', userId: 'u1' },
      async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
    );
    await run.completion;

    // filterSeparator
    run = await startProjectTestRun(
      { confirm: true, runner: 'rust', projectId: 'p8', filter: 'f1' },
      { role: 'user', userId: 'u1' },
      async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
    );
    await run.completion;

    // filter supported normally
    realpathCallCount = 0;
    run = await startProjectTestRun(
      { confirm: true, runner: 'artisan', projectId: 'p5', filter: 'f1' },
      { role: 'user', userId: 'u1' },
      async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
    );
    await run.completion;

    // unsupported local throws
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', filter: 'f1', projectId: 'p3' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /filter is not supported by the npm runner/
    );
  });

  it('startProjectTestRun with laravel succeeds with testDatabase', async () => {
    realpathCallCount = 0;
    const run = await startProjectTestRun(
      { confirm: true, runner: 'artisan', projectId: 'p5' },
      { role: 'user', userId: 'u1' },
      async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
    );
    const res = await run.completion;
    assert.strictEqual(res.exitCode, 0);
  });

  it('startProjectTestRun with target traversing outside throws', async () => {
    realpathCallCount = 0;
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', projectId: 'p3', target: '../outside' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /Test target must stay inside the project/
    );

    realpathCallCount = 0;
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', projectId: 'p3', target: 'symlink-outside' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /Test target must not resolve outside the project/
    );
  });

  it('buildProjectTestInvocation input validation', async () => {
    // 194-195 target is absolute
    await assert.rejects(
      buildProjectTestInvocation({
        projectPath: '/fake/requested',
        runner: 'npm',
        target: '/absolute',
        allowedRoots: ['/fake/requested'],
      }),
      /Test target must be a relative path inside the project/
    );

    // 176-177 not listed in allowedRoots
    await assert.rejects(
      buildProjectTestInvocation({ projectPath: '/not-allowed', runner: 'npm', allowedRoots: ['/fake/requested'] }),
      /is not listed in PROJECT_TEST_ROOTS/
    );

    // 172 empty allowedRoots
    await assert.rejects(
      buildProjectTestInvocation({ projectPath: '/fake/requested', runner: 'npm', allowedRoots: [] }),
      /No project test roots are configured/
    );

    // 187 isDirectory false
    await assert.rejects(
      buildProjectTestInvocation({
        projectPath: '/fake/file-project',
        runner: 'npm',
        allowedRoots: ['/fake/file-project'],
      }),
      /Project test root must be a directory/
    );

    // 227 target not supported
    await assert.rejects(
      buildProjectTestInvocation({
        projectPath: '/fake/requested',
        runner: 'composer-validate',
        target: 't1',
        allowedRoots: ['/fake/requested'],
      }),
      /composer-validate does not accept a target/
    );

    // 158-164 configuredProjectTestRoots defaults
    process.env.PROJECT_TEST_ROOTS = '/fake/real-project, /fake/real-allowed';
    await buildProjectTestInvocation({ projectPath: '/fake/real-project', runner: 'npm' });
    // test target returning '.'
    await buildProjectTestInvocation({ projectPath: '/fake/real-project', runner: 'npm', target: '.' });
    delete process.env.PROJECT_TEST_ROOTS;

    process.env.GIT_ALLOWED_REPOS = '/fake/real-project';
    await buildProjectTestInvocation({ projectPath: '/fake/real-project', runner: 'npm' });
    delete process.env.GIT_ALLOWED_REPOS;

    // 159 empty env
    await assert.rejects(
      buildProjectTestInvocation({ projectPath: '/fake/real-project', runner: 'npm' }),
      /No project test roots are configured/
    );
  });

  it('buildProjectTestInvocation branch coverage for missing requestedPath and unsupported runner', async () => {
    process.env.PROJECT_TEST_ROOTS = '/fake/real-allowed';
    realpathCallCount = 0;
    // 174 missing requestedPath
    await buildProjectTestInvocation({ runner: 'npm' });

    // 223 unsupported runner
    await assert.rejects(
      buildProjectTestInvocation({ runner: 'nonexistent', allowedRoots: ['/fake/real-allowed'] }),
      /Unsupported test runner: nonexistent/
    );
    delete process.env.PROJECT_TEST_ROOTS;
  });

  it('cancelProjectTestRun branch coverage', async () => {
    // 481 confirm !== true
    await assert.rejects(cancelProjectTestRun({ runId: 'fake' }, {}), /confirm: true is required/);

    // 485 state !== running
    realpathCallCount = 0;
    const run = await startProjectTestRun(
      { confirm: true, runner: 'npm', projectId: 'p1' },
      { role: 'user', userId: 'u1' },
      async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
    );
    await run.completion;
    const adminCancelled = await cancelProjectTestRun(
      { confirm: true, runId: run.runId },
      { role: 'admin', userId: 'admin1' }
    );
    assert.strictEqual(adminCancelled.state, 'completed');

    // 301 role !== admin && owner mismatch
    await assert.rejects(
      cancelProjectTestRun({ confirm: true, runId: run.runId }, { role: 'user', userId: 'otherUser' }),
      /Test run not found or not permitted/
    );

    realpathCallCount = 0;
    const run2 = await startProjectTestRun(
      { confirm: true, runner: 'npm', projectId: 'p1' },
      { role: 'user', userId: 'u1' },
      async () => ({ exitCode: 0, stdout: '', stderr: '1 tests passed' }) // empty stdout, uses stderr
    );
    await run2.completion;
    const cancelled = await cancelProjectTestRun({ confirm: true, runId: run2.runId }, { role: 'user', userId: 'u1' });
    assert.strictEqual(cancelled.state, 'completed');
    assert.strictEqual(cancelled.stdout, '');
  });

  it('startProjectTestRun branch coverage for confirm, runAsUser and missing transport', async () => {
    // 373 confirm !== true
    await assert.rejects(
      startProjectTestRun({ runner: 'npm', projectId: 'p1' }, { role: 'user', userId: 'u1' }, async () => ({})),
      /confirm: true is required/
    );

    // 374 missing transport and 375 missing runAsUser
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', projectId: 'p10' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /The registered project must declare runAsUser/
    );
  });

  it('runProjectTests resolves completion with default waitMs', async () => {
    realpathCallCount = 0;
    // 517 default waitMs branch
    const res = await runProjectTests(
      { confirm: true, runner: 'npm', projectId: 'p1', target: 't1' }, // no waitMs
      { role: 'user', userId: 'u1' },
      async () => {
        await new Promise(r => setTimeout(r, 10));
        return { exitCode: 0, stdout: '1 tests passed, 2 assertions', stderr: '' };
      }
    );
    assert.strictEqual(res.state, 'completed');
    assert.strictEqual(res.assertionCount, 2);
  });

  it('startProjectTestRun throws if allowFullSuite is missing and no target', async () => {
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', projectId: 'p6' },
        { role: 'user', userId: 'u1' },
        async () => ({})
      ),
      /A relative target is required because this project does not permit full-suite execution/
    );
  });

  it('runProjectTests resolves completion', async () => {
    realpathCallCount = 0;
    const res = await runProjectTests(
      { confirm: true, runner: 'npm', projectId: 'p1', target: 't1', waitMs: 1 },
      { role: 'user', userId: 'u1' },
      async () => {
        await new Promise(r => setTimeout(r, 10));
        return { exitCode: 0, stdout: '1 tests passed', stderr: '' };
      }
    );
    assert.strictEqual(res.state, 'running');
  });

  it('startProjectTestRun with ssh-gateway validates inputs', async () => {
    // Mock resolveProjectTransport to return ssh-gateway for project 'p2'
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'unknown_runner', projectId: 'p2' },
        { role: 'user', userId: 'u1' },
        secureExec
      ),
      /Unsupported test runner: unknown_runner/
    );

    // Filter not supported
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', filter: 'f1', projectId: 'p2' },
        { role: 'user', userId: 'u1' },
        secureExec
      ),
      /filter is not supported by the npm runner/
    );

    // Target not allowed (absolute path)
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', target: '/absolute', projectId: 'p2' },
        { role: 'user', userId: 'u1' },
        secureExec
      ),
      /Test target must be a registered relative path/
    );

    // Target with .. not allowed
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', target: 'a/../b', projectId: 'p2' },
        { role: 'user', userId: 'u1' },
        secureExec
      ),
      /Test target must be a registered relative path/
    );

    // No target and allowFullSuite !== true
    const p2_no_full = {
      project: { id: 'p2', runAsUser: 'u1', permittedTasks: ['npm'] },
      transport: { kind: 'ssh-gateway' },
    };
    await assert.rejects(
      startProjectTestRun(
        { confirm: true, runner: 'npm', projectId: 'p2' },
        { role: 'user', userId: 'u1' },
        secureExec,
        async () => p2_no_full
      ),
      /A relative target is required because this project does not permit full-suite execution/
    );
  });

  it('startProjectTestRun local execution hits realpath with repoPath', async () => {
    // We mock secureExec to NOT be equal to the passed secureExec? Wait, if brokerExecution is false
    // To make brokerExecution false, we pass a different function!
    const run = await startProjectTestRun(
      { confirm: true, runner: 'npm', projectId: 'p3' },
      { role: 'user', userId: 'u1' },
      async () => ({ exitCode: 0, stdout: 'ok', stderr: '' })
    );
    const res = await run.completion;
    assert.strictEqual(res.exitCode, 0);
  });

  it('startProjectTestRun with brokerExecution failed exitCode with stderr', async () => {
    const identity = { role: 'user', userId: 'u1' };
    const run = await startProjectTestRun(
      { confirm: true, runner: 'artisan', projectId: 'p1', target: 'fail_with_stderr' },
      identity,
      secureExec
    );
    const result = await run.completion;
    assert.strictEqual(result.exitCode, 1);
    assert.strictEqual(result.stderr, 'Custom error');

    // test exitCode 2 (runner-error)
    const run2 = await startProjectTestRun(
      { confirm: true, runner: 'artisan', projectId: 'p1', target: 'exit_2' },
      identity,
      secureExec
    );
    const result2 = await run2.completion;
    assert.strictEqual(result2.exitCode, 2);
    assert.strictEqual(result2.failureClassification, 'runner-error');

    // test unsafe environment
    const run3 = await startProjectTestRun(
      { confirm: true, runner: 'artisan', projectId: 'p1', target: 'unsafe' },
      identity,
      secureExec
    );
    const result3 = await run3.completion;
    assert.strictEqual(result3.failureClassification, 'unsafe-environment');
  });

  it('startProjectTestRun with brokerExecution exception triggers truncate', async () => {
    const identity = { role: 'user', userId: 'u1' };
    const run = await startProjectTestRun(
      { confirm: true, runner: 'npm', target: 'timeout', projectId: 'p1' },
      identity,
      secureExec
    );
    const result = await run.completion;
    assert.strictEqual(result.failureClassification, 'timeout');
    assert.strictEqual(result.truncated, true);
    assert.ok(result.stdout.includes('output truncated at'));
  });

  it('buildProjectTestInvocation throws when realAllowedRoots missing realProject', async () => {
    realpathCallCount = 0;
    await assert.rejects(
      buildProjectTestInvocation({
        projectPath: '/fake/requested',
        runner: 'npm',
        allowedRoots: ['/fake/requested'],
      }),
      /Project path does not resolve to an allowed test root/
    );
  });

  it('prunes expired test runs', async () => {
    pruneProjectTestRuns(Date.now() + 25 * 60 * 60 * 1000);
  });

  it('getProjectTestRun throws if not found', async () => {
    await assert.rejects(getProjectTestRun({ runId: 'not-found' }, {}), /Test run not found or expired/);
  });

  it('getProjectTestRun loads from db if not in memory', async () => {
    const run = await getProjectTestRun({ runId: 'found-db' }, { role: 'user', userId: 'u1' });
    assert.strictEqual(run.runId, 'found-db');
    assert.strictEqual(run.stdout, 'loaded');

    // Admin can get any run
    const runAsAdmin = await getProjectTestRun({ runId: 'found-db' }, { role: 'admin' });
    assert.strictEqual(runAsAdmin.runId, 'found-db');
  });

  it('cancelProjectTestRun throws if not found', async () => {
    await assert.rejects(
      cancelProjectTestRun({ runId: 'not-found', confirm: true }, {}),
      /Test run not found or expired/
    );
  });
});
