// ============================================================
//  lib/control-plane.js - approvals and guided workflow state
// ============================================================
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const LEGACY_STATE_FILE =
  process.env.CONTROL_PLANE_STATE_FILE || path.join(process.cwd(), 'data', 'control-plane.json');
const STATE_DB_FILE = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
const USE_LEGACY_JSON = Boolean(process.env.CONTROL_PLANE_STATE_FILE && !process.env.MCP_STATE_DB);
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

const WORKFLOWS = [
  {
    id: 'diagnose-server',
    title: 'Check why my server or website is slow',
    description: 'Collects safe system health information before recommending a repair.',
    risk: 'read-only',
    prompts: ['Check server health', 'Review recent logs', 'Explain the likely cause in plain language'],
  },
  {
    id: 'secure-server',
    title: 'Review my server security',
    description: 'Reviews access, exposed services, updates, and backups. It does not make changes without approval.',
    risk: 'approval-required',
    prompts: ['Review server security', 'Show recommended fixes', 'Ask for approval before changing anything'],
  },
  {
    id: 'deploy-app',
    title: 'Build and deploy an application',
    description:
      'Guides an AI through repository setup, tests, a deployment plan, health checks, and recovery planning.',
    risk: 'approval-required',
    prompts: [
      'Inspect the project',
      'Run tests',
      'Prepare a deployment plan',
      'Ask for approval before any direct deployment',
    ],
  },
];

let statePromise;
let stateDatabase;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function actionHash({ tool, args, identity }) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        canonicalize({
          tool,
          args,
          userId: identity.userId,
          keyId: identity.keyId || null,
          authType: identity.authType || null,
          oauthSubject: identity.oauthSubject || null,
          oauthClient: identity.oauthClient || null,
          authorizationVersion: identity.authorizationVersion || identity.keyVersion || null,
        })
      )
    )
    .digest('hex');
}

function redact(value, key = '') {
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (!value || typeof value !== 'object') {
    return /password|secret|token|key|authorization|content|code/i.test(key) ? '[REDACTED]' : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey)])
  );
}

function approvalPreview(tool, args) {
  if (tool === 'write_file' && typeof args?.content === 'string') {
    const filePath = String(args.filePath || '');
    const looksSecret = /(?:^|\/)(?:\.env|credentials|secrets?|.*\.pem|.*\.key)(?:\.|$)/i.test(filePath);
    return {
      type: 'file-content',
      filePath,
      bytes: Buffer.byteLength(args.content),
      sha256: crypto.createHash('sha256').update(args.content).digest('hex'),
      ...(looksSecret
        ? { preview: '[REDACTED: sensitive filename]' }
        : {
            preview: args.content
              .slice(0, 2000)
              .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]'),
            truncated: args.content.length > 2000,
          }),
    };
  }
  const serialized = JSON.stringify(redact(args));
  return {
    type: 'bounded-payload',
    preview: serialized.slice(0, 2000),
    truncated: serialized.length > 2000,
    sha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(canonicalize(args)))
      .digest('hex'),
  };
}

async function loadState() {
  if (!statePromise) {
    statePromise = (async () => {
      if (!USE_LEGACY_JSON) {
        const { loadSqliteState, openSqliteState } = await import('./sqlite-state.js');
        stateDatabase = await openSqliteState(STATE_DB_FILE, LEGACY_STATE_FILE);
        return loadSqliteState(stateDatabase);
      }
      try {
        const parsed = JSON.parse(await fs.readFile(LEGACY_STATE_FILE, 'utf8'));
        if (!parsed || !Array.isArray(parsed.approvals)) throw new Error('Invalid control-plane state');
        return {
          version: 1,
          projects: [],
          organizations: [],
          teams: [],
          ...parsed,
        };
      } catch (err) {
        if (err.code === 'ENOENT')
          return {
            version: 1,
            approvals: [],
            projects: [],
            organizations: [],
            teams: [],
          };
        throw err;
      }
    })();
  }
  return statePromise;
}

function allowedHost(url, envName) {
  const hosts = (process.env[envName] || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  if (!hosts.length) throw new Error(`${envName} must list every allowed destination host`);
  const hostname = url.hostname.toLowerCase();
  if (!hosts.includes(hostname)) throw new Error(`Destination host '${hostname}' is not in ${envName}`);
}

function safeHttpUrl(value, envName) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('A valid HTTP or HTTPS URL is required');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('URL must use HTTP or HTTPS and cannot include credentials');
  allowedHost(url, envName);
  return url.toString();
}

async function saveState(state) {
  if (!USE_LEGACY_JSON) {
    const { saveSqliteState } = await import('./sqlite-state.js');
    saveSqliteState(stateDatabase, state);
    return;
  }
  await fs.mkdir(path.dirname(LEGACY_STATE_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${LEGACY_STATE_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tmp, LEGACY_STATE_FILE);
  await fs.chmod(LEGACY_STATE_FILE, 0o600);
}

function isExpired(approval) {
  return Date.now() > new Date(approval.expiresAt).getTime();
}

export function getWorkflowCatalog() {
  return WORKFLOWS;
}

export async function listApprovals(identity, { includeResolved = false } = {}) {
  const state = await loadState();
  const approvals = state.approvals.map(approval => {
    if (approval.status === 'pending' && isExpired(approval)) return { ...approval, status: 'expired' };
    return approval;
  });
  const visible =
    identity.role === 'admin' ? approvals : approvals.filter(item => item.requestedBy.userId === identity.userId);
  return visible
    .filter(item => includeResolved || item.status === 'pending')
    .map(({ actionHash: _actionHash, ...safe }) => safe)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function requestApproval({ tool, args, identity, summary, risk = 'high' }) {
  const state = await loadState();
  const hash = actionHash({ tool, args, identity });
  const existing = state.approvals.find(
    item => item.actionHash === hash && item.status === 'pending' && !isExpired(item)
  );
  if (existing) return { approval: existing, created: false };

  const now = new Date();
  const approval = {
    id: crypto.randomUUID(),
    status: 'pending',
    risk,
    tool,
    summary: summary || `Approval required to run ${tool}`,
    arguments: redact(args),
    preview: approvalPreview(tool, args),
    requestedBy: {
      userId: identity.userId,
      keyId: identity.keyId || null,
      role: identity.role,
      oauthSubject: identity.oauthSubject || null,
      oauthClient: identity.oauthClient || null,
      authorizationVersion: identity.authorizationVersion || identity.keyVersion || null,
    },
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    actionHash: hash,
    decisionHistory: [{ state: 'pending', at: now.toISOString(), by: identity.userId }],
  };
  state.approvals.push(approval);
  await saveState(state);
  return { approval, created: true };
}

export async function decideApproval({ id, decision, identity, note = '' }) {
  if (identity.role !== 'admin') throw new Error('Only administrators can approve or reject requests');
  if (!['approved', 'rejected'].includes(decision)) throw new Error('decision must be approved or rejected');
  const state = await loadState();
  const approval = state.approvals.find(item => item.id === id);
  if (!approval) throw new Error('Approval request not found');
  if (approval.status !== 'pending' || isExpired(approval)) throw new Error('Approval request is no longer pending');
  if (
    approval.requestedBy.oauthSubject
      ? approval.requestedBy.oauthSubject === identity.oauthSubject
      : approval.requestedBy.userId === identity.userId
  )
    throw new Error('Requester and approver must be different identities');
  approval.status = decision;
  approval.decidedAt = new Date().toISOString();
  approval.decidedBy = { userId: identity.userId, keyId: identity.keyId || null };
  approval.note = typeof note === 'string' ? note.slice(0, 1000) : '';
  approval.decisionHistory ||= [];
  approval.decisionHistory.push({ state: decision, at: approval.decidedAt, by: identity.userId, note: approval.note });
  await saveState(state);
  return { ...approval, actionHash: undefined };
}

export async function consumeApproval({ tool, args, identity }) {
  const state = await loadState();
  const hash = actionHash({ tool, args, identity });
  const approval = state.approvals.find(
    item => item.actionHash === hash && item.status === 'approved' && !isExpired(item)
  );
  if (!approval) return null;
  approval.status = 'executed';
  approval.executedAt = new Date().toISOString();
  approval.decisionHistory ||= [];
  approval.decisionHistory.push({ state: 'executed', at: approval.executedAt, by: identity.userId });
  await saveState(state);
  return approval;
}

function validateProject(input) {
  const name = String(input.name || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,79}$/.test(name))
    throw new Error('Project name must be 2-80 letters, numbers, spaces, dots, underscores, or hyphens');
  const repoPath = path.resolve(String(input.repoPath || '').trim());
  const allowedRepos = (process.env.GIT_ALLOWED_REPOS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (!allowedRepos.map(item => path.resolve(item)).includes(repoPath))
    throw new Error('repoPath must be listed in GIT_ALLOWED_REPOS');
  const rootPath = path.resolve(String(input.rootPath || repoPath).trim());
  if (!(rootPath === repoPath || repoPath.startsWith(`${rootPath}${path.sep}`)))
    throw new Error('repoPath must be the project root or a directory inside rootPath');
  const allowedRoots = (process.env.PROJECT_ALLOWED_ROOTS || process.env.PROJECT_TEST_ROOTS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => path.resolve(item));
  if (allowedRoots.length && !allowedRoots.includes(rootPath))
    throw new Error('rootPath must be listed in PROJECT_ALLOWED_ROOTS');
  const runAsUser = String(input.runAsUser || '').trim();
  if (runAsUser && !/^[a-z_][a-z0-9_.-]{0,31}$/i.test(runAsUser)) throw new Error('Invalid runAsUser');
  const serviceName = input.serviceName ? String(input.serviceName).trim() : '';
  if (serviceName && !/^[a-zA-Z0-9_.@-]+$/.test(serviceName)) throw new Error('Invalid systemd service name');
  const healthUrl = input.healthUrl ? String(input.healthUrl).trim() : '';
  if (healthUrl) {
    try {
      const url = new URL(healthUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch {
      throw new Error('healthUrl must be a valid HTTP or HTTPS URL');
    }
  }
  const environment = input.environment || 'production';
  if (!['development', 'testing', 'staging', 'production'].includes(environment))
    throw new Error('environment must be development, testing, staging, or production');
  const permittedTasks = Array.isArray(input.permittedTasks) ? input.permittedTasks : ['artisan', 'phpunit', 'npm'];
  const supportedTasks = new Set([
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
  if (!permittedTasks.length || !permittedTasks.every(task => supportedTasks.has(task)))
    throw new Error('permittedTasks contains an unsupported project recipe');
  const testDatabase = input.testDatabase ? String(input.testDatabase).trim() : '';
  if (testDatabase && !/^[a-zA-Z0-9_$.-]{1,128}$/.test(testDatabase)) throw new Error('Invalid testDatabase');
  const supportedGitActions = new Set(['status', 'diff', 'log', 'branch', 'checkout', 'add', 'commit', 'pull', 'push']);
  const permittedGitActions = Array.isArray(input.permittedGitActions)
    ? input.permittedGitActions
    : ['status', 'diff', 'log', 'branch'];
  if (!permittedGitActions.length || !permittedGitActions.every(action => supportedGitActions.has(action)))
    throw new Error('permittedGitActions contains an unsupported Git recipe');
  return {
    name,
    rootPath,
    repoPath,
    runAsUser,
    serviceName,
    healthUrl,
    environment,
    testDatabase,
    permittedTasks: [...new Set(permittedTasks)],
    permittedGitActions: [...new Set(permittedGitActions)],
    protectedPaths: Array.isArray(input.protectedPaths)
      ? [
          ...new Set(
            input.protectedPaths
              .map(value => String(value).trim())
              .filter(
                value => /^[A-Za-z0-9._/-]{1,256}$/.test(value) && !value.includes('..') && !path.isAbsolute(value)
              )
          ),
        ]
      : [],
    allowRecursiveDelete: input.allowRecursiveDelete === true,
    allowWholeRepoStage: input.allowWholeRepoStage === true,
    allowFullSuite: input.allowFullSuite === true,
    testNetworkHosts: Array.isArray(input.testNetworkHosts)
      ? input.testNetworkHosts
          .map(value => String(value).trim().toLowerCase())
          .filter(value => /^[a-z0-9.-]{1,253}$/.test(value))
          .slice(0, 20)
      : [],
    description: String(input.description || '')
      .trim()
      .slice(0, 500),
  };
}

export async function listProjects(identity) {
  const state = await loadState();
  const team = identity.teamId ? state.teams.find(item => item.id === identity.teamId) : null;
  const allowed = Array.isArray(identity.projectIds) ? identity.projectIds : team?.projectIds;
  return state.projects.filter(project => !Array.isArray(allowed) || allowed.includes(project.id));
}

export async function getProject(id, identity) {
  const projects = await listProjects(identity);
  const project = projects.find(item => item.id === id || item.legacyIds?.includes(id));
  if (!project) throw new Error('Project not found or not permitted');
  return project;
}

export function assertProjectHealthUrlAllowed(project) {
  if (!project.healthUrl) return null;
  return safeHttpUrl(project.healthUrl, 'PROJECT_HEALTH_ALLOWED_HOSTS');
}

export async function assertRepositoryPermitted(repoPath, identity) {
  const constrained = Array.isArray(identity.projectIds) || Boolean(identity.teamId);
  if (!constrained) return null;
  const project = (await listProjects(identity)).find(item => item.repoPath === repoPath);
  if (!project) throw new Error('This repository is not assigned to your project or team');
  return project;
}

export async function createProject(input, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can create projects');
  const state = await loadState();
  const project = {
    id: crypto.randomUUID(),
    ...validateProject(input),
    createdAt: new Date().toISOString(),
    createdBy: identity.userId,
  };
  if (state.projects.some(item => item.name.toLowerCase() === project.name.toLowerCase()))
    throw new Error('A project with this name already exists');
  state.projects.push(project);
  await saveState(state);
  return project;
}

export function getDeploymentPlan(project) {
  const steps = [
    {
      stage: 'Inspect',
      action: `Review the working tree and recent changes in ${project.repoPath}.`,
      tool: 'git_operation',
    },
    {
      stage: 'Validate',
      action: 'Run a registered project test recipe in the project sandbox.',
      tool: 'run_project_tests',
    },
    {
      stage: 'Deploy',
      action: project.serviceName
        ? `Deploy the approved revision and restart ${project.serviceName}.`
        : 'Deploy the approved revision using the project deployment process.',
      tool: 'manage_service',
    },
    {
      stage: 'Verify',
      action: project.healthUrl
        ? `Check ${project.healthUrl} and service health after deployment.`
        : 'Check service health and recent logs after deployment.',
      tool: 'get_service_status',
    },
    {
      stage: 'Recover',
      action:
        'If validation fails, stop and document the exact revision and recovery procedure. Do not claim an automatic rollback is available.',
      tool: 'manual-recovery',
    },
  ];
  return { project, approvalRequired: project.environment === 'production', steps };
}

function validateNamedEntity(name, type) {
  const safe = String(name || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,79}$/.test(safe)) throw new Error(`${type} name must be 2-80 safe characters`);
  return safe;
}

export async function listOrganizations(identity) {
  const state = await loadState();
  if (identity.role === 'admin') return { organizations: state.organizations, teams: state.teams };
  const organizations = identity.organizationId
    ? state.organizations.filter(item => item.id === identity.organizationId)
    : [];
  const teams = identity.teamId ? state.teams.filter(item => item.id === identity.teamId) : [];
  return { organizations, teams };
}

export async function createOrganization({ name }, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can create organizations');
  const state = await loadState();
  const organization = {
    id: crypto.randomUUID(),
    name: validateNamedEntity(name, 'Organization'),
    createdAt: new Date().toISOString(),
    createdBy: identity.userId,
  };
  if (state.organizations.some(item => item.name.toLowerCase() === organization.name.toLowerCase()))
    throw new Error('An organization with this name already exists');
  state.organizations.push(organization);
  await saveState(state);
  return organization;
}

export async function createTeam({ name, organizationId, projectIds = [], role = 'developer' }, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can create teams');
  const state = await loadState();
  if (!state.organizations.some(item => item.id === organizationId)) throw new Error('Organization not found');
  if (!['viewer', 'auditor', 'developer', 'operator'].includes(role))
    throw new Error('Team role must be viewer, auditor, developer, or operator');
  if (
    !Array.isArray(projectIds) ||
    !projectIds.every(id => typeof id === 'string' && state.projects.some(project => project.id === id))
  )
    throw new Error('Each team project must be registered');
  const team = {
    id: crypto.randomUUID(),
    name: validateNamedEntity(name, 'Team'),
    organizationId,
    role,
    projectIds,
    createdAt: new Date().toISOString(),
    createdBy: identity.userId,
  };
  state.teams.push(team);
  await saveState(state);
  return team;
}

export async function validateKeyAssignment({ organizationId, teamId }) {
  const state = await loadState();
  if (organizationId && !state.organizations.some(item => item.id === organizationId))
    throw new Error('Organization not found');
  if (!teamId) return;
  const team = state.teams.find(item => item.id === teamId);
  if (!team) throw new Error('Team not found');
  if (organizationId && team.organizationId !== organizationId)
    throw new Error('Team does not belong to the selected organization');
}

export async function persistTaskRun(run) {
  if (USE_LEGACY_JSON || (process.env.NODE_TEST_CONTEXT && !process.env.MCP_STATE_DB)) return;
  await loadState();
  const { upsertTaskRun } = await import('./sqlite-state.js');
  upsertTaskRun(stateDatabase, run);
}

export async function loadTaskRunState(runId) {
  if (USE_LEGACY_JSON || (process.env.NODE_TEST_CONTEXT && !process.env.MCP_STATE_DB)) return null;
  await loadState();
  const { loadTaskRun } = await import('./sqlite-state.js');
  return loadTaskRun(stateDatabase, runId);
}
