// ============================================================
//  lib/control-plane.js - approvals and guided workflow state
// ============================================================
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const STATE_FILE = process.env.CONTROL_PLANE_STATE_FILE || path.join(process.cwd(), 'data', 'control-plane.json');
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

async function loadState() {
  if (!statePromise) {
    statePromise = (async () => {
      try {
        const parsed = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
        if (!parsed || !Array.isArray(parsed.approvals)) throw new Error('Invalid control-plane state');
        return {
          version: 1,
          projects: [],
          automations: [],
          organizations: [],
          teams: [],
          fleets: [],
          backupTargets: [],
          webhooks: [],
          ...parsed,
        };
      } catch (err) {
        if (err.code === 'ENOENT')
          return {
            version: 1,
            approvals: [],
            projects: [],
            automations: [],
            organizations: [],
            teams: [],
            fleets: [],
            backupTargets: [],
            webhooks: [],
          };
        throw err;
      }
    })();
  }
  return statePromise;
}

function encryptionKey() {
  const value = process.env.CONTROL_PLANE_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error('CONTROL_PLANE_ENCRYPTION_KEY must be a 64-character hexadecimal key before storing secrets');
  return Buffer.from(value, 'hex');
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptSecret(value) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(
    Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  );
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

function allowedPath(value, envName) {
  const resolved = path.resolve(String(value || ''));
  const roots = (process.env[envName] || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => path.resolve(item));
  if (!roots.length) throw new Error(`${envName} must list allowed absolute paths`);
  if (!roots.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`)))
    throw new Error(`Path must be inside a directory listed in ${envName}`);
  return resolved;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${STATE_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tmp, STATE_FILE);
  await fs.chmod(STATE_FILE, 0o600);
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
    requestedBy: { userId: identity.userId, keyId: identity.keyId || null, role: identity.role },
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    actionHash: hash,
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
  approval.status = decision;
  approval.decidedAt = new Date().toISOString();
  approval.decidedBy = { userId: identity.userId, keyId: identity.keyId || null };
  approval.note = typeof note === 'string' ? note.slice(0, 1000) : '';
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
  await saveState(state);
  return approval;
}

function validateProject(input) {
  const name = String(input.name || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,79}$/.test(name))
    throw new Error('Project name must be 2-80 letters, numbers, spaces, dots, underscores, or hyphens');
  const repoPath = String(input.repoPath || '').trim();
  const allowedRepos = (process.env.GIT_ALLOWED_REPOS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (!allowedRepos.includes(repoPath)) throw new Error('repoPath must be listed in GIT_ALLOWED_REPOS');
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
  if (!['development', 'staging', 'production'].includes(environment))
    throw new Error('environment must be development, staging, or production');
  return {
    name,
    repoPath,
    serviceName,
    healthUrl,
    environment,
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
  const project = projects.find(item => item.id === id);
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
      action: 'Run the project test and build commands in a sandbox or approved CI environment.',
      tool: 'run_sandboxed_code',
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

export async function listAutomations(identity) {
  const state = await loadState();
  return identity.role === 'admin'
    ? state.automations
    : state.automations.filter(item => item.createdBy === identity.userId);
}

export async function createAutomation(input, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can create automations');
  if (!['health_check', 'backup'].includes(input.type))
    throw new Error('Only health_check and backup automations are supported');
  const intervalMinutes = Number(input.intervalMinutes || 60);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 10080)
    throw new Error('intervalMinutes must be between 5 and 10080');
  const name = String(input.name || 'Server health check').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,79}$/.test(name)) throw new Error('Automation name must be 2-80 safe characters');
  const state = await loadState();
  if (input.type === 'backup') {
    if (!state.backupTargets.some(item => item.id === input.backupTargetId)) throw new Error('Backup target not found');
    allowedPath(input.sourcePath, 'BACKUP_ALLOWED_PATHS');
  }
  const automation = {
    id: crypto.randomUUID(),
    name,
    type: input.type,
    intervalMinutes,
    enabled: input.enabled !== false,
    backupTargetId: input.type === 'backup' ? input.backupTargetId : undefined,
    sourcePath: input.type === 'backup' ? path.resolve(input.sourcePath) : undefined,
    createdAt: new Date().toISOString(),
    createdBy: identity.userId,
    nextRunAt: new Date().toISOString(),
    lastRunAt: null,
    lastResult: null,
  };
  state.automations.push(automation);
  await saveState(state);
  return automation;
}

export async function runDueAutomations(stats) {
  const state = await loadState();
  const now = Date.now();
  const completed = [];
  for (const automation of state.automations) {
    if (!automation.enabled || new Date(automation.nextRunAt).getTime() > now) continue;
    automation.lastRunAt = new Date(now).toISOString();
    automation.nextRunAt = new Date(now + automation.intervalMinutes * 60 * 1000).toISOString();
    if (automation.type === 'health_check') {
      const usage = { cpu: stats.cpu, memory: stats.memory, disk: stats.disk };
      const concerning = Object.values(usage).some(value => typeof value === 'number' && value >= 85);
      automation.lastResult = { status: concerning ? 'needs-attention' : 'healthy', usage };
    } else if (automation.type === 'backup') {
      try {
        const backup = await runBackup({ targetId: automation.backupTargetId, sourcePath: automation.sourcePath });
        automation.lastResult = { status: 'completed', backupId: backup.id, bytes: backup.bytes };
      } catch (err) {
        automation.lastResult = { status: 'failed', message: err.message };
      }
    }
    completed.push({ id: automation.id, name: automation.name, result: automation.lastResult });
  }
  if (completed.length) await saveState(state);
  return completed;
}

export async function listFleet(identity) {
  const state = await loadState();
  return identity.role === 'admin' ? state.fleets.map(({ encryptedToken: _token, ...item }) => item) : [];
}

export async function registerFleetServer(input, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can register fleet servers');
  const name = validateNamedEntity(input.name, 'Server');
  const healthUrl = safeHttpUrl(input.healthUrl, 'MCP_FLEET_ALLOWED_HOSTS');
  const state = await loadState();
  if (state.fleets.some(item => item.name.toLowerCase() === name.toLowerCase() || item.healthUrl === healthUrl))
    throw new Error('A server with that name or health URL is already registered');
  const server = {
    id: crypto.randomUUID(),
    name,
    healthUrl,
    labels: Array.isArray(input.labels)
      ? input.labels.filter(item => typeof item === 'string' && /^[a-zA-Z0-9_.-]{1,40}$/.test(item)).slice(0, 20)
      : [],
    createdAt: new Date().toISOString(),
    createdBy: identity.userId,
    lastCheck: null,
  };
  state.fleets.push(server);
  await saveState(state);
  return server;
}

export async function checkFleetServer(id, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can check fleet servers');
  const state = await loadState();
  const server = state.fleets.find(item => item.id === id);
  if (!server) throw new Error('Fleet server not found');
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(server.healthUrl, { headers: { accept: 'application/json' } });
    server.lastCheck = {
      status: response.ok ? 'healthy' : 'unhealthy',
      checkedAt: new Date().toISOString(),
      httpStatus: response.status,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    server.lastCheck = {
      status: 'unreachable',
      checkedAt: new Date().toISOString(),
      message: err.name === 'AbortError' ? 'Timed out' : 'Connection failed',
      latencyMs: Date.now() - started,
    };
  }
  await saveState(state);
  const { encryptedToken: _token, ...safe } = server;
  return safe;
}

export async function createBackupTarget(input, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can create backup targets');
  const name = validateNamedEntity(input.name, 'Backup target');
  if (!['local', 's3'].includes(input.type)) throw new Error('Backup target type must be local or s3');
  const state = await loadState();
  const target = {
    id: crypto.randomUUID(),
    name,
    type: input.type,
    createdAt: new Date().toISOString(),
    createdBy: identity.userId,
  };
  if (input.type === 'local') target.destination = allowedPath(input.destination, 'BACKUP_ALLOWED_ROOTS');
  else {
    const endpoint = safeHttpUrl(input.endpoint, 'S3_ALLOWED_HOSTS');
    const bucket = String(input.bucket || '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,61}[a-zA-Z0-9]$/.test(bucket)) throw new Error('Invalid S3 bucket name');
    const accessKeyId = String(input.accessKeyId || '').trim();
    const secretAccessKey = String(input.secretAccessKey || '').trim();
    if (!accessKeyId || !secretAccessKey) throw new Error('S3 access key and secret are required');
    target.endpoint = endpoint;
    target.bucket = bucket;
    target.region = String(input.region || 'us-east-1').slice(0, 64);
    target.credentials = encryptSecret({ accessKeyId, secretAccessKey });
  }
  if (state.backupTargets.some(item => item.name.toLowerCase() === name.toLowerCase()))
    throw new Error('A backup target with this name already exists');
  state.backupTargets.push(target);
  await saveState(state);
  const { credentials: _credentials, ...safe } = target;
  return safe;
}

export async function listBackupTargets(identity) {
  const state = await loadState();
  return identity.role === 'admin' ? state.backupTargets.map(({ credentials: _credentials, ...target }) => target) : [];
}

export async function runBackup({ targetId, sourcePath }) {
  const state = await loadState();
  const target = state.backupTargets.find(item => item.id === targetId);
  if (!target) throw new Error('Backup target not found');
  const source = allowedPath(sourcePath, 'BACKUP_ALLOWED_PATHS');
  const sourceStat = await fs.stat(source);
  if (!sourceStat.isFile())
    throw new Error('Only regular files can be backed up; use a dedicated archive process for directories');
  if (sourceStat.size > 25 * 1024 * 1024) throw new Error('Backup source exceeds the 25 MiB safety limit');
  const plaintext = await fs.readFile(source);
  const payload = encryptSecret({
    source: path.basename(source),
    createdAt: new Date().toISOString(),
    data: plaintext.toString('base64'),
  });
  const id = crypto.randomUUID();
  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${id}.mcsb`;
  if (target.type === 'local') {
    const targetPath = path.join(target.destination, filename);
    await fs.mkdir(target.destination, { recursive: true, mode: 0o700 });
    await fs.writeFile(targetPath, JSON.stringify(payload), { mode: 0o600 });
    return { id, targetId, filename, bytes: sourceStat.size, destination: targetPath, encrypted: 'AES-256-GCM' };
  }
  const credentials = decryptSecret(target.credentials);
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: target.region, endpoint: target.endpoint, forcePathStyle: true, credentials });
  await client.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: `mcp-sentinel/${filename}`,
      Body: JSON.stringify(payload),
      ContentType: 'application/json',
    })
  );
  return {
    id,
    targetId,
    filename,
    bytes: sourceStat.size,
    destination: `s3://${target.bucket}/mcp-sentinel/${filename}`,
    encrypted: 'AES-256-GCM',
  };
}

export async function createWebhook(input, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can create webhooks');
  const name = validateNamedEntity(input.name, 'Webhook');
  const url = safeHttpUrl(input.url, 'WEBHOOK_ALLOWED_HOSTS');
  const secret = String(input.secret || '');
  if (secret.length < 32 || secret.length > 256) throw new Error('Webhook secret must be 32-256 characters');
  const state = await loadState();
  if (state.webhooks.some(item => item.name.toLowerCase() === name.toLowerCase()))
    throw new Error('A webhook with this name already exists');
  const webhook = {
    id: crypto.randomUUID(),
    name,
    url,
    events: Array.isArray(input.events)
      ? input.events.filter(event => /^[a-z0-9._-]{1,80}$/.test(event)).slice(0, 30)
      : ['deployment.completed'],
    secret: encryptSecret(secret),
    createdAt: new Date().toISOString(),
    createdBy: identity.userId,
    lastDelivery: null,
  };
  if (!webhook.events.length) throw new Error('At least one valid event is required');
  state.webhooks.push(webhook);
  await saveState(state);
  const { secret: _secret, ...safe } = webhook;
  return safe;
}

export async function listWebhooks(identity) {
  const state = await loadState();
  return identity.role === 'admin' ? state.webhooks.map(({ secret: _secret, ...webhook }) => webhook) : [];
}

export async function deliverWebhook({ webhookId, event, payload }, identity) {
  if (identity.role !== 'admin') throw new Error('Only administrators can deliver webhooks');
  const state = await loadState();
  const webhook = state.webhooks.find(item => item.id === webhookId);
  if (!webhook) throw new Error('Webhook not found');
  if (!webhook.events.includes(event)) throw new Error('This webhook is not subscribed to that event');
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    event,
    sentAt: new Date().toISOString(),
    data: payload || {},
  });
  const signature = crypto.createHmac('sha256', decryptSecret(webhook.secret)).update(body).digest('hex');
  const response = await fetchWithTimeout(webhook.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'MCP-Sentinel/1.0',
      'x-mcp-sentinel-signature-256': `sha256=${signature}`,
    },
    body,
  });
  webhook.lastDelivery = {
    event,
    deliveredAt: new Date().toISOString(),
    httpStatus: response.status,
    status: response.ok ? 'delivered' : 'failed',
  };
  await saveState(state);
  return { webhookId, event, ...webhook.lastDelivery };
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
