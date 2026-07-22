// ============================================================
//  tools/system.js - System Information & Command Execution
// ============================================================
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { secureExec } from '../lib/exec.js';
import { brokerCall } from '../lib/broker-client.js';
import { getProject, getProjectByExactPath, loadTaskRunState, persistTaskRun } from '../lib/control-plane.js';

const MAX_OUTPUT = parseInt(process.env.MAX_OUTPUT_SIZE || '1048576');

// ── Tool: get_system_info ──────────────────────────────────

export async function getSystemInfo(_, identity) {
  const isAd = identity.role === 'admin';
  const tasks = [
    secureExec(['uptime', '-p'], identity),
    secureExec(['free', '-h'], identity),
    secureExec(['cat', '/proc/loadavg'], identity),
  ];
  if (isAd) {
    tasks.push(secureExec(['df', '-h', '--output=source,fstype,size,used,avail,pcent,target'], identity));
    tasks.push(secureExec(['who'], identity));
  }

  const results = await Promise.allSettled(tasks);

  const uptimeOut = results[0];
  const freeOut = results[1];
  const loadOut = results[2];
  const dfOut = isAd ? results[3] : {};
  const whoOut = isAd ? results[4] : {};

  const info = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    kernel: os.release(),
    uptime: uptimeOut.value?.stdout?.trim() || 'N/A',
    cpus: os.cpus().length,
    cpu_model: os.cpus()[0]?.model || 'Unknown',
    load_avg: loadOut.value?.stdout?.trim() || os.loadavg().join(' '),
    total_memory: formatBytes(os.totalmem()),
    free_memory: formatBytes(os.freemem()),
    memory_usage: freeOut.value?.stdout?.trim() || 'N/A',
  };

  if (isAd) {
    info.disk_usage = dfOut.value?.stdout?.trim() || 'N/A';
    info.logged_in_users = whoOut.value?.stdout?.trim() || 'N/A';
    info.network_interfaces = getNetworkInfo();
  } else {
    info.disk_usage = 'Access Denied';
    info.logged_in_users = 'Access Denied';
    info.network_interfaces = 'Access Denied';
  }

  return info;
}

// ── Tool: get_processes ────────────────────────────────────

export async function getProcesses({ filter, asUser }, identity) {
  let psArgs;
  if (identity.role === 'admin') {
    if (asUser) {
      psArgs = ['-u', asUser, '--sort=-%cpu', '-o', 'pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,time,cmd'];
    } else {
      psArgs = ['aux', '--sort=-%cpu'];
    }
  } else {
    psArgs = ['-u', identity.userId, '--sort=-%cpu', '-o', 'pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,time,cmd'];
  }

  const { stdout } = await secureExec(['ps', ...psArgs], identity);
  let output = stdout.trim();

  if (filter) {
    const lines = output.split('\n');
    const header = lines[0];
    const filtered = lines.slice(1).filter(l => l.toLowerCase().includes(filter.toLowerCase()));
    output = [header, ...filtered].join('\n');
  }

  return { processes: output };
}

// ── Tool: kill_process ─────────────────────────────────────

export async function killProcess({ pid, signal = 'TERM' }, identity) {
  if (!pid) throw new Error('pid is required');

  const validSignals = ['TERM', 'KILL', 'HUP', 'INT', 'USR1', 'USR2'];
  if (!validSignals.includes(signal.toUpperCase())) {
    throw new Error(`Invalid signal. Use one of: ${validSignals.join(', ')}`);
  }

  await brokerCall('process.signal', {
    pid,
    signal: signal.toUpperCase(),
    ...(identity.role === 'admin' ? {} : { owner: identity.userId }),
  });
  return { success: true, message: `Signal ${signal} sent to PID ${pid}` };
}

// ── Helpers ────────────────────────────────────────────────

function truncate(str) {
  if (!str) return '';
  if (str.length > MAX_OUTPUT) {
    return str.slice(0, MAX_OUTPUT) + `\n[... output truncated at ${MAX_OUTPUT} bytes]`;
  }
  return str;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}

function getNetworkInfo() {
  const ifaces = os.networkInterfaces();
  return Object.entries(ifaces).reduce((acc, [name, addrs]) => {
    acc[name] = addrs.map(a => `${a.address}/${a.cidr?.split('/')[1] || '?'} (${a.family})`);
    return acc;
  }, {});
}

// ── Constrained project test runner ────────────────────

// ── Tool: run_project_tests ────────────────────────────────

const TEST_RUNNERS = {
  artisan: { argv: ['php', 'artisan', 'test'], target: true, filter: true, laravel: true },
  phpunit: { argv: ['vendor/bin/phpunit'], target: true, filter: true, laravel: true },
  npm: { argv: ['npm', 'test', '--'], target: true },
  'composer-validate': { argv: ['composer', 'validate', '--no-interaction'], target: false },
  pest: { argv: ['vendor/bin/pest'], target: true, filter: true, laravel: true },
  frontend: { argv: ['npm', 'run', 'test', '--'], target: true },
  playwright: { argv: ['node_modules/.bin/playwright', 'test'], target: true },
  python: { argv: ['python3', '-m', 'pytest'], target: true, filterFlag: '-k' },
  go: { argv: ['go', 'test'], target: true, filterFlag: '-run' },
  rust: { argv: ['cargo', 'test'], target: true, filterSeparator: true },
};

const testRuns = new Map();
const TEST_RUN_TTL_MS = 24 * 60 * 60 * 1000;

function configuredProjectTestRoots() {
  return (process.env.PROJECT_TEST_ROOTS || process.env.GIT_ALLOWED_REPOS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => path.resolve(item));
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function resolveProjectRoot(requestedPath, allowedRootsOverride) {
  const allowedRoots = (allowedRootsOverride || configuredProjectTestRoots()).map(item => path.resolve(item));
  if (!allowedRoots.length) throw new Error('No project test roots are configured');

  const requested = path.resolve(requestedPath || allowedRoots[0]);
  if (!allowedRoots.includes(requested)) {
    throw new Error(`Project path '${requested}' is not listed in PROJECT_TEST_ROOTS`);
  }

  const [realProject, ...realAllowedRoots] = await Promise.all([
    fs.realpath(requested),
    ...allowedRoots.map(root => fs.realpath(root)),
  ]);
  if (!realAllowedRoots.includes(realProject)) {
    throw new Error('Project path does not resolve to an allowed test root');
  }
  const projectStat = await fs.stat(realProject);
  if (!projectStat.isDirectory()) throw new Error('Project test root must be a directory');
  return realProject;
}

async function resolveTestTarget(projectRoot, target) {
  if (!target) return null;
  if (target.includes('\0') || path.isAbsolute(target)) {
    throw new Error('Test target must be a relative path inside the project');
  }
  const resolved = path.resolve(projectRoot, target);
  if (!isWithin(projectRoot, resolved)) {
    throw new Error('Test target must stay inside the project');
  }
  const realTarget = await fs.realpath(resolved);
  if (!isWithin(projectRoot, realTarget)) {
    throw new Error('Test target must not resolve outside the project');
  }
  return path.relative(projectRoot, realTarget) || '.';
}

function validateFilter(filter) {
  if (filter === undefined) return null;
  if (typeof filter !== 'string' || !filter.trim() || filter.length > 256 || /[\0\r\n]/.test(filter))
    throw new Error('filter must be 1-256 characters on one line');
  return filter;
}

export async function buildProjectTestInvocation({
  projectPath,
  runner,
  target,
  filter,
  allowFullSuite = true,
  allowedRoots,
}) {
  const recipe = TEST_RUNNERS[runner];
  if (!recipe) throw new Error(`Unsupported test runner: ${runner}`);

  const cwd = await resolveProjectRoot(projectPath, allowedRoots);
  const safeTarget = recipe.target ? await resolveTestTarget(cwd, target) : null;
  if (target && !recipe.target) throw new Error(`${runner} does not accept a target`);
  if (recipe.target && !safeTarget && !allowFullSuite)
    throw new Error('A relative target is required because this project does not permit full-suite execution');
  const safeFilter = validateFilter(filter);
  const argv = [...recipe.argv];
  if (safeTarget) argv.push(safeTarget);
  if (safeFilter) {
    if (recipe.filter) argv.push('--filter', safeFilter);
    else if (recipe.filterFlag) argv.push(recipe.filterFlag, safeFilter);
    else if (recipe.filterSeparator) argv.push('--', safeFilter);
    else throw new Error(`filter is not supported by the ${runner} runner`);
  }
  return { cwd, argv };
}

function parseEnvFile(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter(line => line && !line.trimStart().startsWith('#') && line.includes('='))
      .map(line => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator).trim();
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^(['"])(.*)\1$/, '$2');
        return [key, value];
      })
  );
}

async function verifyTestingEnvironment(project, runner) {
  if (!TEST_RUNNERS[runner].laravel) return {};
  const envPath = path.join(project.rootPath, '.env.testing');
  let values;
  try {
    values = parseEnvFile(await fs.readFile(envPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Laravel project tests require a readable .env.testing file');
    throw error;
  }
  if (values.APP_ENV && values.APP_ENV !== 'testing') throw new Error('.env.testing must set APP_ENV=testing');
  const database = values.DB_DATABASE || values.DATABASE_DATABASE;
  if (!project.testDatabase)
    throw new Error('The registered project must declare testDatabase before Laravel tests can run');
  if (database !== project.testDatabase)
    throw new Error('.env.testing database does not match the project registered testDatabase');
  return values;
}

function constrainedTestEnvironment(project, testingValues) {
  const allowed = ['PATH', 'LANG', 'LC_ALL', 'TZ'];
  const env = Object.fromEntries(allowed.filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.CI = 'true';
  env.APP_ENV = 'testing';
  env.NODE_ENV = 'test';
  if (project.runAsUser) env.HOME = `/home/${project.runAsUser}`;
  for (const [key, value] of Object.entries(testingValues)) {
    if (/^(APP_|DB_|DATABASE_|CACHE_|QUEUE_|SESSION_|MAIL_)/.test(key)) env[key] = value;
  }
  return env;
}

function testRunOwner(identity) {
  return JSON.stringify({
    subject: identity.oauthSubject || identity.oauthUser || identity.userId,
    clientId: identity.oauthClient || identity.keyId || null,
    userId: identity.userId,
  });
}

function assertRunOwner(run, identity) {
  if (identity.role !== 'admin' && run.owner !== testRunOwner(identity))
    throw new Error('Test run not found or not permitted');
}

function parseTestCounts(output) {
  const text = String(output || '');
  const tests = text.match(/(\d+)\s+(?:tests?|passing|passed)/i);
  const assertions = text.match(/(\d+)\s+assertions?/i);
  return {
    ...(tests ? { testCount: Number(tests[1]) } : {}),
    ...(assertions ? { assertionCount: Number(assertions[1]) } : {}),
  };
}

function classifyFailure(run) {
  if (run.state === 'cancelled') return 'cancelled';
  if (run.signal || run.errorCode === 'ETIMEDOUT') return 'timeout';
  if (/\.env\.testing|testDatabase|testing environment/i.test(run.stderr)) return 'unsafe-environment';
  if (run.exitCode === 1) return 'test-failure';
  return run.exitCode === 0 ? null : 'runner-error';
}

function publicRun(run) {
  return {
    runId: run.runId,
    projectId: run.projectId,
    runner: run.runner,
    target: run.target,
    state: run.state,
    exitCode: run.exitCode,
    durationMs: run.finishedAt ? run.finishedAt - run.startedAt : Date.now() - run.startedAt,
    ...parseTestCounts(`${run.stdout}\n${run.stderr}`),
    stdout: run.stdout,
    stderr: run.stderr,
    truncated: run.truncated,
    failureClassification: classifyFailure(run),
    deprecationWarning: run.deprecationWarning,
  };
}

function durableRun(run) {
  const { controller: _controller, completion: _completion, cancel: _cancel, ...serializable } = run;
  return serializable;
}

function truncateResult(value) {
  const text = String(value || '').trim();
  return { text: truncate(text), truncated: text.length > MAX_OUTPUT };
}

async function resolveRegisteredProject(input, identity) {
  if (input.projectId) return { project: await getProject(input.projectId, identity) };
  if (input.projectPath) {
    return {
      project: await getProjectByExactPath(input.projectPath, identity),
      deprecationWarning: 'projectPath is deprecated; use the returned projectId on future calls.',
    };
  }
  throw new Error('projectId is required');
}

export async function startProjectTestRun(
  input,
  identity,
  execute = secureExec,
  projectResolver = resolveRegisteredProject
) {
  if (input.confirm !== true) throw new Error('confirm: true is required to run project tests');
  const { project, deprecationWarning } = await projectResolver(input, identity);
  if (!project.runAsUser) throw new Error('The registered project must declare runAsUser');
  if (!(project.permittedTasks || []).includes(input.runner))
    throw new Error('This test recipe is not permitted for the project');
  const realRoot = await fs.realpath(project.rootPath || project.repoPath);
  const invocation = await buildProjectTestInvocation({
    projectPath: realRoot,
    runner: input.runner,
    target: input.target,
    filter: input.filter,
    allowFullSuite: project.allowFullSuite === true,
    allowedRoots: [realRoot],
  });
  const testingValues = await verifyTestingEnvironment({ ...project, rootPath: realRoot }, input.runner);
  const controller = new AbortController();
  const run = {
    runId: randomUUID(),
    projectId: project.id,
    runner: input.runner,
    target: input.target || null,
    state: 'running',
    exitCode: null,
    stdout: '',
    stderr: '',
    truncated: false,
    startedAt: Date.now(),
    finishedAt: null,
    owner: testRunOwner(identity),
    controller,
    deprecationWarning,
  };
  testRuns.set(run.runId, run);
  await persistTaskRun(durableRun(run));
  const executionIdentity = { ...identity, userId: project.runAsUser, role: 'user' };
  const brokerExecution = execute === secureExec;
  if (brokerExecution) {
    run.cancel = () => brokerCall('project.cancel', { runId: run.runId }, { timeoutMs: 12_000 });
  }
  run.completion = (async () => {
    try {
      const result = brokerExecution
        ? await brokerCall(
            'project.test',
            {
              runId: run.runId,
              projectId: project.id,
              runner: input.runner,
              ...(input.target ? { target: input.target } : {}),
              ...(input.filter ? { filter: input.filter } : {}),
            },
            { timeoutMs: 910_000, signal: controller.signal }
          )
        : await execute(invocation.argv, executionIdentity, {
            cwd: invocation.cwd,
            env: constrainedTestEnvironment(project, testingValues),
            signal: controller.signal,
          });
      if (brokerExecution && result.exitCode !== 0) {
        const error = new Error(result.stderr || 'Project test failed');
        Object.assign(error, result, { code: result.exitCode });
        throw error;
      }
      const stdout = truncateResult(result.stdout);
      const stderr = truncateResult(result.stderr);
      run.stdout = stdout.text;
      run.stderr = stderr.text;
      run.truncated = stdout.truncated || stderr.truncated;
      run.exitCode = 0;
      run.state = 'completed';
    } catch (error) {
      const stdout = truncateResult(error.stdout);
      const stderr = truncateResult(error.stderr || error.message);
      run.stdout = stdout.text;
      run.stderr = stderr.text;
      run.truncated = stdout.truncated || stderr.truncated;
      run.exitCode = Number.isInteger(error.code) ? error.code : null;
      run.errorCode = error.code;
      run.signal = error.signal || null;
      run.state = controller.signal.aborted ? 'cancelled' : 'failed';
    } finally {
      run.finishedAt = Date.now();
      run.controller = null;
      await persistTaskRun(durableRun(run));
    }
    return publicRun(run);
  })();
  return run;
}

export async function getProjectTestRun({ runId }, identity) {
  const run = testRuns.get(runId) || (await loadTaskRunState(runId));
  if (!run) throw new Error('Test run not found or expired');
  assertRunOwner(run, identity);
  return publicRun(run);
}

export async function cancelProjectTestRun({ runId, confirm }, identity) {
  if (confirm !== true) throw new Error('confirm: true is required to cancel a test run');
  const run = testRuns.get(runId);
  if (!run) throw new Error('Test run not found or expired');
  assertRunOwner(run, identity);
  if (run.state !== 'running') return publicRun(run);
  run.state = 'cancelled';
  run.controller.abort();
  await run.cancel?.().catch(() => {});
  await Promise.race([run.completion, new Promise(resolve => setTimeout(resolve, 2000))]);
  return publicRun(run);
}

export function pruneProjectTestRuns(now = Date.now()) {
  for (const [runId, run] of testRuns) {
    if (run.finishedAt && now - run.finishedAt > TEST_RUN_TTL_MS) testRuns.delete(runId);
  }
}

export async function runProjectTests(input, identity, execute = secureExec) {
  if (input.projectId || input.confirm !== undefined) {
    const run = await startProjectTestRun(input, identity, execute);
    const waitMs = Math.min(Number(input.waitMs || 50_000), 50_000);
    return Promise.race([run.completion, new Promise(resolve => setTimeout(() => resolve(publicRun(run)), waitMs))]);
  }
  const { cwd, argv } = await buildProjectTestInvocation(input);

  try {
    const { stdout, stderr } = await execute(argv, identity, { cwd });
    return {
      success: true,
      exitCode: 0,
      cwd,
      argv,
      stdout: truncate(stdout?.trim()),
      stderr: truncate(stderr?.trim()),
    };
  } catch (error) {
    return {
      success: false,
      exitCode: Number.isInteger(error.code) ? error.code : null,
      signal: error.signal || null,
      cwd,
      argv,
      stdout: truncate(error.stdout?.trim()),
      stderr: truncate(error.stderr?.trim() || error.message),
    };
  }
}
