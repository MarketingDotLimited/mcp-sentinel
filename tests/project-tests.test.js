import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildProjectTestInvocation,
  runProjectTests,
  startProjectTestRun,
  getProjectTestRun,
  cancelProjectTestRun,
  pruneProjectTestRuns,
} from '../tools/system.js';

describe('constrained project test runner', () => {
  let projectRoot;
  let previousRoots;

  beforeEach(async () => {
    previousRoots = process.env.PROJECT_TEST_ROOTS;
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-project-tests-'));
    await fs.mkdir(path.join(projectRoot, 'tests', 'Unit'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'tests', 'Unit', 'ExampleTest.php'), '<?php\n');
    process.env.PROJECT_TEST_ROOTS = projectRoot;
  });

  afterEach(async () => {
    if (previousRoots === undefined) delete process.env.PROJECT_TEST_ROOTS;
    else process.env.PROJECT_TEST_ROOTS = previousRoots;
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('builds an argv-only Laravel test invocation', async () => {
    const invocation = await buildProjectTestInvocation({
      projectPath: projectRoot,
      runner: 'artisan',
      target: 'tests/Unit/ExampleTest.php',
      filter: 'small module',
    });

    assert.equal(invocation.cwd, projectRoot);
    assert.deepEqual(invocation.argv, [
      'php',
      'artisan',
      'test',
      'tests/Unit/ExampleTest.php',
      '--filter',
      'small module',
    ]);
  });

  it('rejects projects and targets outside the allow-listed root', async () => {
    await assert.rejects(
      buildProjectTestInvocation({ projectPath: '/tmp', runner: 'artisan' }),
      /not listed in PROJECT_TEST_ROOTS/
    );
    await assert.rejects(
      buildProjectTestInvocation({ projectPath: projectRoot, runner: 'artisan', target: '../outside.php' }),
      /must stay inside the project/
    );
  });

  it('passes an argument array to the executor and returns failure output', async () => {
    const identity = { userId: 'developer', role: 'user' };
    const result = await runProjectTests(
      { projectPath: projectRoot, runner: 'phpunit', target: 'tests/Unit/ExampleTest.php' },
      identity,
      async (argv, receivedIdentity, options) => {
        assert.deepEqual(argv, ['vendor/bin/phpunit', 'tests/Unit/ExampleTest.php']);
        assert.equal(receivedIdentity, identity);
        assert.equal(options.cwd, projectRoot);
        const error = new Error('test failed');
        error.code = 1;
        error.stdout = 'one assertion failed';
        error.stderr = 'failure details';
        throw error;
      }
    );

    assert.equal(result.success, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, 'one assertion failed');
    assert.equal(result.stderr, 'failure details');
  });

  it('runs a registered Laravel target as the configured Unix user with testing-only environment', async () => {
    await fs.writeFile(path.join(projectRoot, '.env.testing'), 'APP_ENV=testing\nDB_DATABASE=rabeeb_test\n');
    const identity = { userId: 'oauth-user', role: 'developer', oauthSubject: 'subject-1', oauthClient: 'chatgpt' };
    const project = {
      id: '436b432a-206b-43cd-abfa-6291dbef0c50',
      rootPath: projectRoot,
      repoPath: projectRoot,
      runAsUser: 'rabeeb.com_07v7ld45234',
      testDatabase: 'rabeeb_test',
      permittedTasks: ['artisan'],
      allowFullSuite: false,
    };
    const run = await startProjectTestRun(
      {
        projectId: project.id,
        runner: 'artisan',
        target: 'tests/Unit/ExampleTest.php',
        confirm: true,
      },
      identity,
      async (argv, executionIdentity, options) => {
        assert.deepEqual(argv, ['php', 'artisan', 'test', 'tests/Unit/ExampleTest.php']);
        assert.equal(executionIdentity.userId, project.runAsUser);
        assert.equal(executionIdentity.role, 'user');
        assert.equal(options.env.APP_ENV, 'testing');
        assert.equal(options.env.DB_DATABASE, 'rabeeb_test');
        assert.equal(options.env.JWT_SECRET, undefined);
        return { stdout: 'Tests: 2 passed (4 assertions)', stderr: '' };
      },
      async () => ({ project })
    );
    const result = await run.completion;
    assert.equal(result.state, 'completed');
    assert.equal(result.testCount, 2);
    assert.equal(result.assertionCount, 4);
    assert.equal((await getProjectTestRun({ runId: run.runId }, identity)).exitCode, 0);
    await assert.rejects(
      getProjectTestRun({ runId: run.runId }, { ...identity, oauthSubject: 'someone-else' }),
      /not permitted/
    );
  });

  it('requires a target and cancels the complete managed execution through its abort signal', async () => {
    const identity = { userId: 'developer', role: 'developer', keyId: 'key-1' };
    const project = {
      id: 'b2639ca7-56cc-4f16-949a-5dadfacddf8f',
      rootPath: projectRoot,
      repoPath: projectRoot,
      runAsUser: 'project-user',
      permittedTasks: ['npm'],
      allowFullSuite: false,
    };
    await assert.rejects(
      startProjectTestRun(
        { projectId: project.id, runner: 'npm', confirm: true },
        identity,
        async () => ({}),
        async () => ({ project })
      ),
      /relative target is required/
    );
    const run = await startProjectTestRun(
      { projectId: project.id, runner: 'npm', target: 'tests/Unit', confirm: true },
      identity,
      async (_argv, _executionIdentity, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('cancelled');
            error.signal = 'SIGTERM';
            reject(error);
          });
        }),
      async () => ({ project })
    );
    const cancelled = await cancelProjectTestRun({ runId: run.runId, confirm: true }, identity);
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.failureClassification, 'cancelled');
  });

  it('builds every registered argv recipe and rejects unsupported targets and filters', async () => {
    const target = 'tests/Unit';
    const expectations = [
      ['npm', ['npm', 'test', '--', target]],
      ['frontend', ['npm', 'run', 'test', '--', target]],
      ['playwright', ['node_modules/.bin/playwright', 'test', target]],
      ['python', ['python3', '-m', 'pytest', target, '-k', 'small']],
      ['go', ['go', 'test', target, '-run', 'small']],
      ['rust', ['cargo', 'test', target, '--', 'small']],
    ];
    for (const [runner, argv] of expectations) {
      const invocation = await buildProjectTestInvocation({
        projectPath: projectRoot,
        runner,
        target,
        ...(runner === 'python' || runner === 'go' || runner === 'rust' ? { filter: 'small' } : {}),
      });
      assert.deepEqual(invocation.argv, argv);
    }
    assert.deepEqual(
      (await buildProjectTestInvocation({ projectPath: projectRoot, runner: 'composer-validate' })).argv,
      ['composer', 'validate', '--no-interaction']
    );
    await assert.rejects(
      buildProjectTestInvocation({ projectPath: projectRoot, runner: 'composer-validate', target }),
      /does not accept a target/
    );
    await assert.rejects(
      buildProjectTestInvocation({ projectPath: projectRoot, runner: 'frontend', target, filter: 'x' }),
      /filter is not supported/
    );
    await assert.rejects(
      buildProjectTestInvocation({ projectPath: projectRoot, runner: 'missing', target }),
      /Unsupported test runner/
    );
    await assert.rejects(
      buildProjectTestInvocation({ projectPath: projectRoot, runner: 'npm', target, filter: 'bad\nfilter' }),
      /filter must be/
    );
  });

  it('fails closed for unconfirmed, unassigned, and unsafe Laravel projects', async () => {
    const identity = { userId: 'developer', role: 'developer', keyId: 'key' };
    const baseProject = {
      id: '99999999-9999-4999-8999-999999999999',
      rootPath: projectRoot,
      repoPath: projectRoot,
      runAsUser: 'project-user',
      testDatabase: 'expected_test',
      permittedTasks: ['artisan'],
      allowFullSuite: false,
    };
    const resolver = project => async () => ({ project });
    await assert.rejects(
      startProjectTestRun(
        { projectId: baseProject.id, runner: 'artisan' },
        identity,
        async () => ({}),
        resolver(baseProject)
      ),
      /confirm/
    );
    await assert.rejects(
      startProjectTestRun(
        { projectId: baseProject.id, runner: 'artisan', target: 'tests/Unit', confirm: true },
        identity,
        async () => ({}),
        resolver({ ...baseProject, runAsUser: '' })
      ),
      /declare runAsUser/
    );
    await assert.rejects(
      startProjectTestRun(
        { projectId: baseProject.id, runner: 'npm', target: 'tests/Unit', confirm: true },
        identity,
        async () => ({}),
        resolver(baseProject)
      ),
      /not permitted/
    );
    await assert.rejects(
      startProjectTestRun(
        { projectId: baseProject.id, runner: 'artisan', target: 'tests/Unit', confirm: true },
        identity,
        async () => ({}),
        resolver(baseProject)
      ),
      /\.env\.testing/
    );
    await fs.writeFile(path.join(projectRoot, '.env.testing'), 'APP_ENV=production\nDB_DATABASE=expected_test\n');
    await assert.rejects(
      startProjectTestRun(
        { projectId: baseProject.id, runner: 'artisan', target: 'tests/Unit', confirm: true },
        identity,
        async () => ({}),
        resolver(baseProject)
      ),
      /APP_ENV=testing/
    );
    await fs.writeFile(path.join(projectRoot, '.env.testing'), 'APP_ENV=testing\nDB_DATABASE=production\n');
    await assert.rejects(
      startProjectTestRun(
        { projectId: baseProject.id, runner: 'artisan', target: 'tests/Unit', confirm: true },
        identity,
        async () => ({}),
        resolver(baseProject)
      ),
      /does not match/
    );
  });

  it('handles status, completed cancellation, missing runs, and pruning', async () => {
    const identity = { userId: 'developer', role: 'developer', keyId: 'key' };
    const project = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      rootPath: projectRoot,
      repoPath: projectRoot,
      runAsUser: 'project-user',
      permittedTasks: ['npm'],
      allowFullSuite: true,
    };
    const run = await startProjectTestRun(
      { projectId: project.id, runner: 'npm', confirm: true },
      identity,
      async () => ({ stdout: '', stderr: '' }),
      async () => ({ project, deprecationWarning: 'legacy' })
    );
    await run.completion;
    assert.equal((await cancelProjectTestRun({ runId: run.runId, confirm: true }, identity)).state, 'completed');
    await assert.rejects(cancelProjectTestRun({ runId: run.runId }, identity), /confirm/);
    await assert.rejects(getProjectTestRun({ runId: 'missing' }, identity), /not found/);
    pruneProjectTestRuns(Date.now() + 25 * 60 * 60 * 1000);
    await assert.rejects(getProjectTestRun({ runId: run.runId }, identity), /not found/);
  });
});
