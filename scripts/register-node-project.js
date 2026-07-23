#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { openSqliteState } from '../lib/sqlite-state.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tasks = new Set([
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
]);
const gitActions = new Set(['status', 'diff', 'log', 'branch', 'checkout', 'add', 'commit', 'pull', 'push']);

export async function validateNodeProject(input, { verifyUser = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Project record must be an object');
  if (!uuid.test(input.id || '')) throw new Error('Project ID must be a UUID');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,79}$/.test(input.name || '')) throw new Error('Invalid project name');
  const rootPath = await fs.realpath(path.resolve(String(input.rootPath || '')));
  const repoPath = await fs.realpath(path.resolve(String(input.repoPath || rootPath)));
  if (!(repoPath === rootPath || repoPath.startsWith(`${rootPath}${path.sep}`)))
    throw new Error('Project repository must be inside its root');
  const runAsUser = String(input.runAsUser || '');
  if (!/^[a-z_][a-z0-9_.-]{0,31}$/i.test(runAsUser) || runAsUser === 'root')
    throw new Error('Project execution user must be non-root');
  if (verifyUser) {
    const uid = Number(execFileSync('id', ['-u', '--', runAsUser], { encoding: 'utf8' }).trim());
    if (!Number.isInteger(uid) || uid === 0) throw new Error('Project execution user must resolve to a non-root UID');
  }
  const permittedTasks = input.permittedTasks || [];
  const permittedGitActions = input.permittedGitActions || ['status', 'diff', 'log', 'branch'];
  if (!Array.isArray(permittedTasks) || !permittedTasks.length || !permittedTasks.every(item => tasks.has(item)))
    throw new Error('Project contains an invalid task recipe');
  if (
    !Array.isArray(permittedGitActions) ||
    !permittedGitActions.length ||
    !permittedGitActions.every(item => gitActions.has(item))
  )
    throw new Error('Project contains an invalid Git recipe');
  const testNetworkHosts = Array.isArray(input.testNetworkHosts)
    ? [...new Set(input.testNetworkHosts.map(value => String(value).trim()))]
    : [];
  if (testNetworkHosts.length > 20 || testNetworkHosts.some(value => isIP(value) === 0))
    throw new Error('Project test network dependencies must be explicit IP addresses');
  return {
    id: input.id,
    name: input.name,
    rootPath,
    repoPath,
    runAsUser,
    environment: ['development', 'testing', 'staging', 'production'].includes(input.environment)
      ? input.environment
      : 'production',
    serviceName: input.serviceName || '',
    healthUrl: input.healthUrl || '',
    testDatabase: input.testDatabase || '',
    permittedTasks: [...new Set(permittedTasks)],
    permittedGitActions: [...new Set(permittedGitActions)],
    protectedPaths: Array.isArray(input.protectedPaths) ? input.protectedPaths : [],
    allowRecursiveDelete: input.allowRecursiveDelete === true,
    allowWholeRepoStage: input.allowWholeRepoStage === true,
    allowFullSuite: input.allowFullSuite === true,
    testNetworkHosts,
    transportKind: 'local',
    hostId: 'local',
    sshAllowed: false,
    sshEnabled: false,
    transportPolicyVersion: 1,
  };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const projectFile = option('--project');
  const databaseFile = option('--state-db') || process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
  if (!projectFile) throw new Error('--project must reference a protected JSON project record');
  const project = await validateNodeProject(JSON.parse(await fs.readFile(projectFile, 'utf8')));
  const apply = process.argv.includes('--apply');
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ mode: 'dry-run', databaseFile, project }, null, 2)}\n`);
    return;
  }
  if (!process.argv.includes('--confirm')) throw new Error('--apply requires --confirm');
  const database = await openSqliteState(databaseFile);
  try {
    database
      .prepare('INSERT OR REPLACE INTO projects(id, payload, updated_at) VALUES (?, ?, ?)')
      .run(project.id, JSON.stringify(project), new Date().toISOString());
  } finally {
    database.close();
  }
  process.stdout.write(`${JSON.stringify({ mode: 'applied', projectId: project.id, databaseFile })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(await fs.realpath(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
