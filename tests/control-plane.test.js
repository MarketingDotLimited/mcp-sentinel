import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { sanitizeArgs } from '../audit.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sentinel-approvals-'));
process.env.CONTROL_PLANE_STATE_FILE = path.join(tempDir, 'control-plane.json');
process.env.KEYSTORE_FILE = path.join(tempDir, 'keys.json');
process.env.GIT_ALLOWED_REPOS = '/srv/example-app';
process.env.MCP_POLICY_FILE = path.join(tempDir, 'policy.json');
process.env.CONTROL_PLANE_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.BACKUP_ALLOWED_PATHS = tempDir;
process.env.BACKUP_ALLOWED_ROOTS = path.join(tempDir, 'backups');
process.env.MCP_FLEET_ALLOWED_HOSTS = 'sentinel.example.test';
process.env.WEBHOOK_ALLOWED_HOSTS = 'hooks.example.test';
process.env.S3_ALLOWED_HOSTS = 's3.example.test';
await fs.writeFile(process.env.MCP_POLICY_FILE, JSON.stringify({ rules: [
  { effect: 'deny', tools: ['delete_user'], roles: ['developer'] },
  { effect: 'require_approval', tools: ['write_file'], roles: ['*'] },
] }));
const controlPlane = await import(`../lib/control-plane.js?test=${Date.now()}`);
const security = await import(`../security.js?test=${Date.now()}`);
const policy = await import(`../lib/policy.js?test=${Date.now()}`);

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('approval control plane', () => {
  const requester = { userId: 'developer', keyId: 'key-1', role: 'developer', authType: 'apiKey' };
  const admin = { userId: 'admin', keyId: 'key-admin', role: 'admin', authType: 'apiKey' };
  const action = { tool: 'write_file', args: { filePath: '/srv/app/.env', content: 'SECRET=value' }, identity: requester };

  it('creates a redacted pending approval and consumes it once after approval', async () => {
    const { approval, created } = await controlPlane.requestApproval({ ...action, summary: 'Update application configuration' });
    assert.equal(created, true);
    assert.equal(approval.arguments.content, '[REDACTED]');
    assert.equal(approval.arguments.filePath, '/srv/app/.env');

    const pending = await controlPlane.listApprovals(admin);
    assert.equal(pending.length, 1);
    assert.equal('actionHash' in pending[0], false);

    await controlPlane.decideApproval({ id: approval.id, decision: 'approved', identity: admin });
    assert.ok(await controlPlane.consumeApproval(action));
    assert.equal(await controlPlane.consumeApproval(action), null);
  });

  it('prevents non-admin users from deciding requests', async () => {
    const { approval } = await controlPlane.requestApproval({
      tool: 'delete_file', args: { filePath: '/tmp/example', confirm: true }, identity: requester,
    });
    await assert.rejects(
      controlPlane.decideApproval({ id: approval.id, decision: 'approved', identity: requester }),
      /Only administrators/
    );
  });

  it('creates active API keys with an approval policy', async () => {
    const key = 'mcp_abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz1234';
    await security.addApiKey(key, { userId: 'admin', role: 'developer', scopes: ['files.*'], requireApproval: true });
    const entry = security.listApiKeys().find(item => item.userId === 'admin' && item.role === 'developer');
    assert.equal(entry.active, true);
    assert.equal(entry.requireApproval, true);
  });

  it('applies least-privilege role templates when custom scopes are omitted', async () => {
    const key = 'mcp_zabcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz123';
    await security.addApiKey(key, { userId: 'admin', role: 'viewer', label: 'viewer test' });
    const entry = security.listApiKeys().find(item => item.label === 'viewer test');
    assert.equal(entry.requireApproval, true);
    assert.ok(entry.scopes.includes('get_system_info'));
    assert.ok(!entry.scopes.includes('*'));
  });

  it('redacts secrets and write payloads from audit arguments', () => {
    const safe = sanitizeArgs({ content: 'private value', newContent: 'another private value', publicKey: 'ssh-ed25519 secret', nested: { token: 'abc' } });
    assert.deepEqual(safe, { content: '[REDACTED]', newContent: '[REDACTED]', publicKey: '[REDACTED]', nested: { token: '[REDACTED]' } });
  });

  it('enforces policy-as-code deny and approval rules', async () => {
    assert.deepEqual(await policy.evaluatePolicy({ tool: 'delete_user', identity: requester }), { allowed: false, requireApproval: false, reason: 'This action is denied by server policy' });
    assert.deepEqual(await policy.evaluatePolicy({ tool: 'write_file', identity: requester }), { allowed: true, requireApproval: true });
  });

  it('does not trust forwarded IP headers without an explicit proxy allow-list', () => {
    const previousTrustProxy = process.env.TRUST_PROXY;
    const previousTrustedProxies = process.env.TRUSTED_PROXIES;
    try {
      process.env.TRUST_PROXY = 'true';
      process.env.TRUSTED_PROXIES = '';
      const request = { socket: { remoteAddress: '10.0.0.10' }, headers: { 'x-forwarded-for': '203.0.113.50' } };
      assert.equal(security.getClientIP(request), '10.0.0.10');
      process.env.TRUSTED_PROXIES = '10.0.0.0/8';
      assert.equal(security.getClientIP(request), '203.0.113.50');
    } finally {
      if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = previousTrustProxy;
      if (previousTrustedProxies === undefined) delete process.env.TRUSTED_PROXIES; else process.env.TRUSTED_PROXIES = previousTrustedProxies;
    }
  });

  it('registers projects only from the allowed repository list', async () => {
    const project = await controlPlane.createProject({
      name: 'Example App', repoPath: '/srv/example-app', environment: 'production', serviceName: 'example-app', healthUrl: 'https://example.test/health',
    }, admin);
    const plan = controlPlane.getDeploymentPlan(project);
    assert.equal(plan.approvalRequired, true);
    assert.equal(plan.steps.length, 5);
    assert.deepEqual(await controlPlane.listProjects({ ...requester, projectIds: [project.id] }), [project]);
    await assert.rejects(
      controlPlane.createProject({ name: 'Wrong Repo', repoPath: '/srv/not-allowed' }, admin),
      /GIT_ALLOWED_REPOS/
    );
  });

  it('runs only safe, due health-check automations', async () => {
    const automation = await controlPlane.createAutomation({ name: 'Hourly health', type: 'health_check', intervalMinutes: 60 }, admin);
    const completed = await controlPlane.runDueAutomations({ cpu: 10, memory: 20, disk: 90 });
    const result = completed.find(item => item.id === automation.id);
    assert.equal(result.result.status, 'needs-attention');
    assert.equal((await controlPlane.listAutomations(admin)).find(item => item.id === automation.id).lastResult.usage.disk, 90);
  });

  it('restricts a team identity to its assigned projects', async () => {
    const project = await controlPlane.createProject({ name: 'Team App', repoPath: '/srv/example-app' }, admin);
    const organization = await controlPlane.createOrganization({ name: 'Example Organization' }, admin);
    const team = await controlPlane.createTeam({ name: 'Application Team', organizationId: organization.id, role: 'developer', projectIds: [project.id] }, admin);
    const visible = await controlPlane.listProjects({ ...requester, teamId: team.id });
    assert.deepEqual(visible, [project]);
    assert.equal((await controlPlane.assertRepositoryPermitted('/srv/example-app', { ...requester, teamId: team.id })).id, project.id);
    await assert.rejects(controlPlane.assertRepositoryPermitted('/srv/not-allowed', { ...requester, teamId: team.id }), /not assigned/);
    await assert.rejects(controlPlane.validateKeyAssignment({ organizationId: organization.id, teamId: 'missing' }), /Team not found/);
  });

  it('encrypts backups and rejects destinations that are not explicitly allow-listed', async () => {
    const source = path.join(tempDir, 'app.env');
    await fs.writeFile(source, 'DATABASE_PASSWORD=not-in-the-backup-plaintext');
    const target = await controlPlane.createBackupTarget({ name: 'Local vault', type: 'local', destination: process.env.BACKUP_ALLOWED_ROOTS }, admin);
    const backup = await controlPlane.runBackup({ targetId: target.id, sourcePath: source });
    const encrypted = await fs.readFile(backup.destination, 'utf8');
    assert.ok(!encrypted.includes('DATABASE_PASSWORD'));
    assert.equal(backup.encrypted, 'AES-256-GCM');
    await assert.rejects(controlPlane.registerFleetServer({ name: 'Untrusted', healthUrl: 'https://untrusted.example.test/health' }, admin), /MCP_FLEET_ALLOWED_HOSTS/);
  });

  it('stores signed-webhook secrets encrypted and exposes no secret in listings', async () => {
    const webhook = await controlPlane.createWebhook({ name: 'Release notifications', url: 'https://hooks.example.test/release', secret: 'x'.repeat(32), events: ['deployment.completed'] }, admin);
    assert.equal('secret' in webhook, false);
    assert.equal((await controlPlane.listWebhooks(admin)).find(item => item.id === webhook.id).url, 'https://hooks.example.test/release');
  });
});
