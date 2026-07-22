import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { sanitizeArgs } from '../audit.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sentinel-approvals-'));
process.env.CONTROL_PLANE_STATE_FILE = path.join(tempDir, 'control-plane.json');
process.env.MCP_CAPABILITIES_FILE = path.join(tempDir, 'capabilities.json');
process.env.KEYSTORE_FILE = path.join(tempDir, 'keys.json');
process.env.GIT_ALLOWED_REPOS = '/srv/example-app';
process.env.MCP_POLICY_FILE = path.join(tempDir, 'policy.json');
process.env.PROJECT_HEALTH_ALLOWED_HOSTS = 'example.test';
await fs.writeFile(
  process.env.MCP_POLICY_FILE,
  JSON.stringify({
    rules: [
      { effect: 'deny', tools: ['delete_user'], roles: ['developer'] },
      { effect: 'require_approval', tools: ['write_file'], roles: ['*'] },
    ],
  })
);
const controlPlane = await import(`../lib/control-plane.js?test=${Date.now()}`);
const security = await import(`../security.js?test=${Date.now()}`);
const policy = await import(`../lib/policy.js?test=${Date.now()}`);
const capabilities = await import(`../lib/capabilities.js?test=${Date.now()}`);

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('approval control plane', () => {
  const requester = { userId: 'developer', keyId: 'key-1', role: 'developer', authType: 'apiKey' };
  const admin = { userId: 'admin', keyId: 'key-admin', role: 'admin', authType: 'apiKey' };
  const action = {
    tool: 'write_file',
    args: { filePath: '/srv/app/.env', content: 'SECRET=value' },
    identity: requester,
  };

  it('creates a redacted pending approval and consumes it once after approval', async () => {
    const { approval, created } = await controlPlane.requestApproval({
      ...action,
      summary: 'Update application configuration',
    });
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
      tool: 'delete_file',
      args: { filePath: '/tmp/example', confirm: true },
      identity: requester,
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
    const safe = sanitizeArgs({
      content: 'private value',
      newContent: 'another private value',
      publicKey: 'ssh-ed25519 secret',
      nested: { token: 'abc' },
    });
    assert.deepEqual(safe, {
      content: '[REDACTED]',
      newContent: '[REDACTED]',
      publicKey: '[REDACTED]',
      nested: { token: '[REDACTED]' },
    });
  });

  it('enforces policy-as-code deny and approval rules', async () => {
    assert.deepEqual(await policy.evaluatePolicy({ tool: 'delete_user', identity: requester }), {
      allowed: false,
      requireApproval: false,
      reason: 'This action is denied by server policy',
    });
    assert.deepEqual(await policy.evaluatePolicy({ tool: 'write_file', identity: requester }), {
      allowed: true,
      requireApproval: true,
    });
  });

  it('keeps specialist capability packs disabled until an administrator opts in', async () => {
    const initial = await capabilities.getCapabilities();
    assert.equal(initial.find(pack => pack.id === 'core-server-care').enabled, true);
    assert.equal(initial.find(pack => pack.id === 'advanced-data').enabled, false);
    assert.equal((await capabilities.toolAvailability('execute_query')).available, false);
    await assert.rejects(capabilities.setCapability('core-server-care', false), /must remain enabled/);

    await capabilities.setCapability('advanced-data', true);
    assert.equal((await capabilities.toolAvailability('execute_query')).available, true);
    assert.equal((await capabilities.toolAvailability('deploy_project')).available, false);
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
      if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previousTrustProxy;
      if (previousTrustedProxies === undefined) delete process.env.TRUSTED_PROXIES;
      else process.env.TRUSTED_PROXIES = previousTrustedProxies;
    }
  });

  it('registers projects only from the allowed repository list', async () => {
    const project = await controlPlane.createProject(
      {
        name: 'Example App',
        repoPath: '/srv/example-app',
        environment: 'production',
        serviceName: 'example-app',
        healthUrl: 'https://example.test/health',
      },
      admin
    );
    const plan = controlPlane.getDeploymentPlan(project);
    assert.equal(plan.approvalRequired, true);
    assert.equal(plan.steps.length, 5);
    assert.deepEqual(await controlPlane.listProjects({ ...requester, projectIds: [project.id] }), [project]);
    await assert.rejects(
      controlPlane.createProject({ name: 'Wrong Repo', repoPath: '/srv/not-allowed' }, admin),
      /GIT_ALLOWED_REPOS/
    );
  });

  it('restricts a team identity to its assigned projects', async () => {
    const project = await controlPlane.createProject({ name: 'Team App', repoPath: '/srv/example-app' }, admin);
    const organization = await controlPlane.createOrganization({ name: 'Example Organization' }, admin);
    const team = await controlPlane.createTeam(
      { name: 'Application Team', organizationId: organization.id, role: 'developer', projectIds: [project.id] },
      admin
    );
    const visible = await controlPlane.listProjects({ ...requester, teamId: team.id });
    assert.deepEqual(visible, [project]);
    assert.equal(
      (await controlPlane.assertRepositoryPermitted('/srv/example-app', { ...requester, teamId: team.id })).id,
      project.id
    );
    await assert.rejects(
      controlPlane.assertRepositoryPermitted('/srv/not-allowed', { ...requester, teamId: team.id }),
      /not assigned/
    );
    await assert.rejects(
      controlPlane.validateKeyAssignment({ organizationId: organization.id, teamId: 'missing' }),
      /Team not found/
    );
  });

  it('covers project lookup, validation, deployment, and approval edge cases', async () => {
    const project = (await controlPlane.listProjects(admin))[0];
    assert.equal((await controlPlane.getProject(project.id, admin)).id, project.id);
    assert.match(controlPlane.assertProjectHealthUrlAllowed(project), /^https:/);
    assert.equal(controlPlane.assertProjectHealthUrlAllowed({}), null);
    assert.equal(await controlPlane.assertRepositoryPermitted(project.repoPath, admin), null);
    await assert.rejects(controlPlane.getProject('missing', requester), /not found/);
    await assert.rejects(
      controlPlane.createProject({ name: 'Nope', repoPath: '/srv/example-app' }, requester),
      /Only administrators/
    );
    for (const [input, message] of [
      [{ name: 'x', repoPath: '/srv/example-app' }, /Project name/],
      [{ name: 'Bad Root', repoPath: '/srv/example-app', rootPath: '/srv/other' }, /project root/],
      [{ name: 'Bad User', repoPath: '/srv/example-app', runAsUser: 'bad/user' }, /runAsUser/],
      [{ name: 'Bad Service', repoPath: '/srv/example-app', serviceName: 'bad/service' }, /systemd/],
      [{ name: 'Bad Health', repoPath: '/srv/example-app', healthUrl: 'file:///etc/passwd' }, /healthUrl/],
      [{ name: 'Bad Environment', repoPath: '/srv/example-app', environment: 'space' }, /environment/],
      [{ name: 'Bad Tasks', repoPath: '/srv/example-app', permittedTasks: ['shell'] }, /permittedTasks/],
      [{ name: 'Bad Database', repoPath: '/srv/example-app', testDatabase: 'bad name' }, /testDatabase/],
      [{ name: 'Bad Git', repoPath: '/srv/example-app', permittedGitActions: ['force'] }, /permittedGitActions/],
    ])
      await assert.rejects(controlPlane.createProject(input, admin), message);
    const duplicateName = project.name;
    await assert.rejects(
      controlPlane.createProject({ name: duplicateName, repoPath: '/srv/example-app' }, admin),
      /already exists/
    );

    const proposed = await controlPlane.requestApproval({
      tool: 'write_file',
      args: { filePath: '/srv/example-app/app.js', content: 'const value = 1;' },
      identity: requester,
    });
    assert.equal(
      (
        await controlPlane.requestApproval({
          tool: 'write_file',
          args: { filePath: '/srv/example-app/app.js', content: 'const value = 1;' },
          identity: requester,
        })
      ).created,
      false
    );
    await assert.rejects(
      controlPlane.decideApproval({ id: proposed.approval.id, decision: 'maybe', identity: admin }),
      /decision must/
    );
    await assert.rejects(
      controlPlane.decideApproval({
        id: proposed.approval.id,
        decision: 'approved',
        identity: { ...admin, userId: requester.userId },
      }),
      /different identities/
    );
    await controlPlane.decideApproval({ id: proposed.approval.id, decision: 'rejected', identity: admin, note: 12 });
    assert.ok(
      (await controlPlane.listApprovals(requester, { includeResolved: true })).some(item => item.status === 'rejected')
    );
  });

  it('validates organizations, teams, and assignments', async () => {
    const project = (await controlPlane.listProjects(admin))[0];
    const organization = (await controlPlane.listOrganizations(admin)).organizations[0];
    assert.equal(
      (await controlPlane.listOrganizations({ ...requester, organizationId: organization.id })).organizations.length,
      1
    );
    await assert.rejects(controlPlane.createOrganization({ name: organization.name }, admin), /already exists/);
    await assert.rejects(
      controlPlane.createTeam({ name: 'Bad Role', organizationId: organization.id, role: 'admin' }, admin),
      /Team role/
    );
    await assert.rejects(
      controlPlane.createTeam({ name: 'Bad Project', organizationId: organization.id, projectIds: ['missing'] }, admin),
      /must be registered/
    );
    await assert.rejects(controlPlane.validateKeyAssignment({ organizationId: 'missing' }), /Organization not found/);
    await controlPlane.validateKeyAssignment({ organizationId: organization.id });
  });
});
