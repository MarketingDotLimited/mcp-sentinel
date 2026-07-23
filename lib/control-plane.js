// ============================================================
//  lib/control-plane.js - approvals and guided workflow state
// ============================================================
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  evaluateSshPolicy,
  identitySshPreferenceId,
  oauthClientSshPolicyId,
  scopedSshPolicyId,
  subjectClientSshPreferenceId,
} from './ssh-policy.js';

const LEGACY_STATE_FILE =
  process.env.CONTROL_PLANE_STATE_FILE || path.join(process.cwd(), 'data', 'control-plane.json');
const STATE_DB_FILE = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
const USE_LEGACY_JSON = Boolean(process.env.CONTROL_PLANE_STATE_FILE && !process.env.MCP_STATE_DB);
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;
const ADDITIVE_STATE_DEFAULTS = {
  approvals: [],
  projects: [],
  organizations: [],
  teams: [],
  hosts: [],
  sshConnections: [],
  sshPolicies: [],
  identitySshPreferences: [],
  oauthClientSshPolicies: [],
  subjectClientSshPreferences: [],
  sshPolicyHistory: [],
};

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

function withLocalProjectTransport(project) {
  return {
    ...project,
    hostId: project.hostId || 'local',
    transportKind: project.transportKind || 'local',
    sshAllowed: project.sshAllowed === true,
    sshEnabled: project.sshEnabled === true,
    transportPolicyVersion:
      Number.isSafeInteger(project.transportPolicyVersion) && project.transportPolicyVersion > 0
        ? project.transportPolicyVersion
        : 1,
  };
}

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

function actionHash({ tool, args, identity, sshPolicyVersion = 0 }) {
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
          oauthIssuer: identity.oauthIssuer || null,
          oauthSubject: identity.oauthSubject || null,
          oauthClient: identity.oauthClient || null,
          authorizationVersion: identity.authorizationVersion || identity.keyVersion || null,
          sshPolicyVersion,
        })
      )
    )
    .digest('hex');
}

function currentSshPolicyVersion(state) {
  return state.sshPolicies.find(item => item.id === 'global')?.policyVersion || 0;
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
          ...ADDITIVE_STATE_DEFAULTS,
          ...parsed,
          projects: (parsed.projects || []).map(withLocalProjectTransport),
        };
      } catch (err) {
        if (err.code === 'ENOENT')
          return {
            version: 1,
            ...ADDITIVE_STATE_DEFAULTS,
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
  const sshPolicyVersion = currentSshPolicyVersion(state);
  const hash = actionHash({ tool, args, identity, sshPolicyVersion });
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
      oauthIssuer: identity.oauthIssuer || null,
      oauthSubject: identity.oauthSubject || null,
      oauthClient: identity.oauthClient || null,
      authorizationVersion: identity.authorizationVersion || identity.keyVersion || null,
      sshPolicyVersion,
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
  const hash = actionHash({ tool, args, identity, sshPolicyVersion: currentSshPolicyVersion(state) });
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

function requireBooleanUpdate(input, fields) {
  const updates = Object.fromEntries(
    fields.filter(field => typeof input[field] === 'boolean').map(field => [field, input[field]])
  );
  if (!Object.keys(updates).length) throw new Error(`At least one of ${fields.join(', ')} must be boolean`);
  if (Object.values(updates).includes(true) && input.confirm !== true)
    throw new Error('confirm must be true when enabling SSH access');
  return updates;
}

function recordPolicyChange(state, { targetType, targetId, before, after, identity }) {
  const now = new Date().toISOString();
  let global = state.sshPolicies.find(item => item.id === 'global');
  if (!global) {
    global = { id: 'global', sshAllowed: false, sshEnabled: false, policyVersion: 0, updatedAt: now };
    state.sshPolicies.push(global);
  }
  global.policyVersion = Math.max(0, Number(global.policyVersion) || 0) + 1;
  global.updatedAt = now;
  global.updatedBy = identity.userId;
  if (after !== global) after.policyVersion = Math.max(0, Number(before?.policyVersion) || 0) + 1;
  after.updatedAt = now;
  after.updatedBy = identity.userId;
  state.sshPolicyHistory.push({
    id: crypto.randomUUID(),
    sequence: global.policyVersion,
    targetType,
    targetId,
    before: before ? { sshAllowed: before.sshAllowed === true, sshEnabled: before.sshEnabled === true } : null,
    after: { sshAllowed: after.sshAllowed === true, sshEnabled: after.sshEnabled === true },
    changedAt: now,
    changedBy: {
      userId: identity.userId,
      keyId: identity.keyId || null,
      oauthIssuer: identity.oauthIssuer || null,
      oauthSubject: identity.oauthSubject || null,
      oauthClient: identity.oauthClient || null,
    },
  });
  return global.policyVersion;
}

function upsertById(records, id, base, updates) {
  const existing = records.find(item => item.id === id);
  const before = existing ? structuredClone(existing) : null;
  const record = existing || { id, ...base };
  Object.assign(record, updates);
  if (!existing) records.push(record);
  return { record, before };
}

function identityPreferenceTarget(input) {
  const targetIdentity =
    input.authType === 'oauth'
      ? { authType: 'oauth', oauthIssuer: input.issuer, oauthSubject: input.subject }
      : input.keyId
        ? { authType: 'apiKey', keyId: input.keyId }
        : { authType: 'local', userId: input.userId };
  const id = identitySshPreferenceId(targetIdentity);
  return {
    id,
    base: {
      identityType: targetIdentity.authType,
      keyId: targetIdentity.keyId || null,
      userId: targetIdentity.userId || null,
      issuer: targetIdentity.oauthIssuer || null,
      subject: targetIdentity.oauthSubject || null,
      sshAllowed: false,
      sshEnabled: false,
    },
  };
}

function projectIsVisible(project, state, identity) {
  if (identity.role === 'admin') return true;
  if (Array.isArray(identity.projectIds)) return identity.projectIds.includes(project.id);
  const team = identity.teamId ? state.teams.find(item => item.id === identity.teamId) : null;
  return !team || team.projectIds?.includes(project.id);
}

export async function getMySshAccess(identity, { projectId } = {}) {
  const state = await loadState();
  const identityId = identitySshPreferenceId(identity);
  const identityPreference = state.identitySshPreferences.find(item => item.id === identityId) || null;
  let subjectClientPreference = null;
  if (identity.authType === 'oauth') {
    subjectClientPreference =
      state.subjectClientSshPreferences.find(item => item.id === subjectClientSshPreferenceId(identity)) || null;
  }
  const project = projectId
    ? state.projects.find(
        item =>
          (item.id === projectId || item.legacyIds?.includes(projectId)) && projectIsVisible(item, state, identity)
      )
    : null;
  if (projectId && !project) throw new Error('Project not found or not permitted');
  return {
    sshPolicyVersion: currentSshPolicyVersion(state),
    identityPreference,
    subjectClientPreference,
    ownedConnections: state.sshConnections
      .filter(connection => connection.ownerIdentityIds?.includes(identityId))
      .map(connection => ({
        id: connection.id,
        name: connection.name,
        hostId: connection.hostId,
        sshAllowed: connection.sshAllowed === true,
        sshEnabled: connection.sshEnabled === true,
        policyVersion: connection.policyVersion || 0,
      })),
    ...(project ? { project: evaluateSshPolicy({ state, identity, project }) } : {}),
  };
}

export async function setMySshAccess({ scope = 'identity', connectionId, enabled, confirm = false }, identity) {
  if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
  if (enabled && confirm !== true) throw new Error('confirm must be true when enabling SSH access');
  const state = await loadState();
  let target;
  let records;
  let base;
  if (scope === 'identity') {
    target = identitySshPreferenceId(identity);
    records = state.identitySshPreferences;
    base = {
      identityType: identity.authType || 'local',
      keyId: identity.keyId || null,
      userId: identity.authType === 'oauth' ? null : identity.userId,
      issuer: identity.oauthIssuer || null,
      subject: identity.oauthSubject || null,
      sshAllowed: false,
    };
  } else if (scope === 'current-client' && identity.authType === 'oauth') {
    target = subjectClientSshPreferenceId(identity);
    records = state.subjectClientSshPreferences;
    base = {
      issuer: identity.oauthIssuer,
      subject: identity.oauthSubject,
      clientId: identity.oauthClient,
    };
  } else if (scope === 'connection') {
    const ownerId = identitySshPreferenceId(identity);
    const connection = state.sshConnections.find(item => item.id === connectionId);
    if (!connection || !connection.ownerIdentityIds?.includes(ownerId))
      throw new Error('SSH connection not found or not owned by this identity');
    target = connection.id;
    records = state.sshConnections;
    base = {};
  } else {
    throw new Error('scope must be identity, connection, or current-client for an OAuth identity');
  }
  const { record, before } = upsertById(records, target, base, { sshEnabled: enabled });
  const sshPolicyVersion = recordPolicyChange(state, {
    targetType: scope === 'identity' ? 'identity' : scope === 'connection' ? 'connection-owner' : 'subject-client',
    targetId: target,
    before,
    after: record,
    identity,
  });
  await saveState(state);
  return { scope, sshEnabled: record.sshEnabled, sshAllowed: record.sshAllowed ?? null, sshPolicyVersion };
}

export async function adminSetSshAccess(input, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can change SSH policy ceilings');
  const updates = requireBooleanUpdate(input, ['sshAllowed', 'sshEnabled']);
  const state = await loadState();
  let records;
  let targetId;
  let base = { sshAllowed: false, sshEnabled: false };
  const type = String(input.targetType || '');
  if (type === 'global') {
    records = state.sshPolicies;
    targetId = 'global';
  } else if (type === 'organization' || type === 'team') {
    const collection = type === 'organization' ? state.organizations : state.teams;
    if (!collection.some(item => item.id === input.targetId)) throw new Error(`${type} not found`);
    records = state.sshPolicies;
    targetId = scopedSshPolicyId(type, input.targetId);
    base = { ...base, scopeType: type, scopeId: input.targetId };
  } else if (type === 'host' || type === 'connection' || type === 'project') {
    records = type === 'host' ? state.hosts : type === 'connection' ? state.sshConnections : state.projects;
    targetId = input.targetId;
    if (!records.some(item => item.id === targetId)) throw new Error(`${type} not found`);
  } else if (type === 'identity') {
    records = state.identitySshPreferences;
    ({ id: targetId, base } = identityPreferenceTarget(input));
  } else if (type === 'oauth-client') {
    targetId = oauthClientSshPolicyId(input.issuer, input.clientId);
    records = state.oauthClientSshPolicies;
    base = { ...base, issuer: input.issuer, clientId: input.clientId };
  } else if (type === 'subject-client') {
    const targetIdentity = {
      oauthIssuer: input.issuer,
      oauthSubject: input.subject,
      oauthClient: input.clientId,
    };
    targetId = subjectClientSshPreferenceId(targetIdentity);
    records = state.subjectClientSshPreferences;
    base = { issuer: input.issuer, subject: input.subject, clientId: input.clientId };
  } else {
    throw new Error('Unsupported SSH policy target type');
  }
  const { record, before } = upsertById(records, targetId, base, updates);
  const sshPolicyVersion = recordPolicyChange(state, {
    targetType: type,
    targetId,
    before,
    after: record,
    identity,
  });
  await saveState(state);
  return {
    targetType: type,
    targetId,
    sshAllowed: record.sshAllowed ?? null,
    sshEnabled: record.sshEnabled,
    sshPolicyVersion,
  };
}

export async function listSshAccessPolicies(identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can list SSH policy records');
  const state = await loadState();
  return {
    sshPolicyVersion: currentSshPolicyVersion(state),
    globalAndScoped: state.sshPolicies,
    hosts: state.hosts,
    connections: state.sshConnections,
    projects: state.projects.map(project => ({
      id: project.id,
      name: project.name,
      hostId: project.hostId,
      transportKind: project.transportKind,
      sshConnectionId: project.sshConnectionId || null,
      sshAllowed: project.sshAllowed === true,
      sshEnabled: project.sshEnabled === true,
      transportPolicyVersion: project.transportPolicyVersion || 1,
    })),
    identities: state.identitySshPreferences,
    oauthClients: state.oauthClientSshPolicies,
    subjectClients: state.subjectClientSshPreferences,
    history: state.sshPolicyHistory.slice(-500),
  };
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
    hostId: 'local',
    transportKind: 'local',
    sshAllowed: false,
    sshEnabled: false,
    transportPolicyVersion: 1,
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

function validateSshHostInput(input) {
  const address = String(input.address || '')
    .trim()
    .toLowerCase();
  if (
    !address ||
    address.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$|^[0-9a-f:.]+$/i.test(address)
  )
    throw new Error('Invalid SSH host address');
  const port = input.port === undefined ? 22 : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SSH port');
  const hostKey = String(input.hostKey || '').trim();
  if (!/^(?:ssh-ed25519|ecdsa-sha2-nistp256|rsa-sha2-512) [A-Za-z0-9+/]+={0,2}$/.test(hostKey))
    throw new Error('A pinned SSH host public key is required');
  return { name: validateNamedEntity(input.name, 'Host'), address, port, hostKey };
}

function connectionOwnerIds(owners = []) {
  if (!Array.isArray(owners) || owners.length > 100) throw new Error('SSH connection owners must be an array');
  return [
    ...new Set(
      owners.map(owner => {
        if (!owner || typeof owner !== 'object' || Array.isArray(owner))
          throw new Error('Invalid SSH connection owner');
        return identityPreferenceTarget(owner).id;
      })
    ),
  ];
}

export async function createSshHost(input, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can register SSH hosts');
  if (input.confirm !== true) throw new Error('confirm must be true to register an SSH host');
  const state = await loadState();
  const values = validateSshHostInput(input);
  if (state.hosts.some(host => host.address === values.address && Number(host.port || 22) === values.port))
    throw new Error('This SSH host and port are already registered');
  const now = new Date().toISOString();
  const host = {
    id: crypto.randomUUID(),
    ...values,
    transportKind: 'ssh-gateway',
    enabled: true,
    sshAllowed: false,
    sshEnabled: false,
    policyVersion: 0,
    createdAt: now,
    createdBy: identity.userId,
  };
  state.hosts.push(host);
  const sshPolicyVersion = recordPolicyChange(state, {
    targetType: 'host',
    targetId: host.id,
    before: null,
    after: host,
    identity,
  });
  await saveState(state);
  return { host, sshPolicyVersion };
}

export async function createSshConnection(input, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can register SSH connections');
  if (input.confirm !== true) throw new Error('confirm must be true to register an SSH connection');
  const state = await loadState();
  const host = state.hosts.find(item => item.id === input.hostId && item.transportKind === 'ssh-gateway');
  if (!host) throw new Error('Registered SSH host not found');
  const username = String(input.username || '').trim();
  if (!/^[a-z_][a-z0-9_.-]{0,31}$/i.test(username) || username === 'root')
    throw new Error('SSH gateway user must be a non-root Unix account');
  const credentialId = String(input.credentialId || '').trim();
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(credentialId)) throw new Error('Invalid SSH credential ID');
  const connection = {
    id: crypto.randomUUID(),
    name: validateNamedEntity(input.name, 'Connection'),
    hostId: host.id,
    username,
    credentialId,
    ownerIdentityIds: connectionOwnerIds(input.owners),
    enabled: true,
    sshAllowed: false,
    sshEnabled: false,
    policyVersion: 0,
    createdAt: new Date().toISOString(),
    createdBy: identity.userId,
  };
  state.sshConnections.push(connection);
  const sshPolicyVersion = recordPolicyChange(state, {
    targetType: 'connection',
    targetId: connection.id,
    before: null,
    after: connection,
    identity,
  });
  await saveState(state);
  return { connection, sshPolicyVersion };
}

export async function setProjectTransport({ projectId, transportKind, hostId, connectionId, confirm }, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can assign project transports');
  if (!['local', 'ssh-gateway'].includes(transportKind)) throw new Error('Unsupported project transport');
  if (transportKind === 'ssh-gateway' && confirm !== true)
    throw new Error('confirm must be true to assign an SSH project transport');
  const state = await loadState();
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new Error('project not found');
  if (transportKind === 'ssh-gateway') {
    const host = state.hosts.find(item => item.id === hostId && item.transportKind === 'ssh-gateway');
    const connection = state.sshConnections.find(item => item.id === connectionId && item.hostId === hostId);
    if (!host || !connection) throw new Error('SSH host and connection binding is not registered');
  }
  const before = structuredClone(project);
  Object.assign(project, {
    transportKind,
    hostId: transportKind === 'local' ? 'local' : hostId,
    sshConnectionId: transportKind === 'local' ? null : connectionId,
    sshAllowed: false,
    sshEnabled: false,
    transportPolicyVersion: Math.max(0, Number(project.transportPolicyVersion) || 0) + 1,
  });
  const sshPolicyVersion = recordPolicyChange(state, {
    targetType: 'project-transport',
    targetId: project.id,
    before,
    after: project,
    identity,
  });
  await saveState(state);
  return { project, sshPolicyVersion };
}

export async function resolveProjectTransport(projectId, identity) {
  const state = await loadState();
  const project = state.projects.find(
    item => (item.id === projectId || item.legacyIds?.includes(projectId)) && projectIsVisible(item, state, identity)
  );
  if (!project) throw new Error('Project not found or not permitted');
  const policy = evaluateSshPolicy({ state, identity, project });
  if (!policy.usesSsh) return { kind: 'local', project, policy };
  if (!policy.allowed) throw new Error(`SSH transport denied: ${policy.reason}`);
  const host = state.hosts.find(item => item.id === project.hostId);
  const connection = state.sshConnections.find(item => item.id === policy.connectionId);
  if (!host || !connection) throw new Error('SSH transport registry is incomplete');
  return {
    kind: 'ssh-gateway',
    project,
    policy,
    connection: {
      ...connection,
      host: host.address,
      port: host.port,
      hostKey: host.hostKey,
    },
  };
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
