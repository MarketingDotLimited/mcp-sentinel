import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-ssh-controls-'));
const stateFile = path.join(directory, 'control-plane.json');
const projectId = '436b432a-206b-43cd-abfa-6291dbef0c50';
process.env.CONTROL_PLANE_STATE_FILE = stateFile;
process.env.GIT_ALLOWED_REPOS = '/srv/remote-project';
await fs.writeFile(
  stateFile,
  JSON.stringify({
    version: 5,
    approvals: [],
    organizations: [{ id: 'organization-1', name: 'Organization' }],
    teams: [{ id: 'team-1', organizationId: 'organization-1', projectIds: [projectId] }],
    projects: [
      {
        id: projectId,
        name: 'Remote project',
        rootPath: '/srv/remote-project',
        repoPath: '/srv/remote-project',
        transportKind: 'ssh-gateway',
        hostId: 'host-1',
        sshConnectionId: 'connection-1',
        sshAllowed: false,
        sshEnabled: false,
      },
    ],
    hosts: [
      {
        id: 'host-1',
        name: 'Remote host',
        transportKind: 'ssh-gateway',
        enabled: true,
        sshAllowed: false,
        sshEnabled: false,
      },
    ],
    sshConnections: [
      {
        id: 'connection-1',
        hostId: 'host-1',
        enabled: true,
        sshAllowed: false,
        sshEnabled: false,
      },
    ],
    sshPolicies: [{ id: 'global', sshAllowed: false, sshEnabled: false, policyVersion: 1 }],
    identitySshPreferences: [],
    oauthClientSshPolicies: [],
    subjectClientSshPreferences: [],
    sshPolicyHistory: [],
  })
);
const controlPlane = await import(`../lib/control-plane.js?ssh-controls=${Date.now()}`);

const admin = { userId: 'admin', role: 'admin', authType: 'apiKey', keyId: 'admin-key' };
const developer = {
  userId: 'project-user',
  role: 'developer',
  authType: 'oauth',
  oauthIssuer: 'https://auth.example.test',
  oauthSubject: 'subject-1',
  oauthClient: 'chatgpt',
  organizationId: 'organization-1',
  teamId: 'team-1',
  projectIds: [projectId],
};

after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('SSH access controls', () => {
  it('requires confirmation for enabling and keeps self-service below the admin ceiling', async () => {
    await assert.rejects(controlPlane.setMySshAccess({ enabled: true }, developer), /confirm/);
    const preference = await controlPlane.setMySshAccess({ enabled: true, confirm: true }, developer);
    assert.equal(preference.sshEnabled, true);
    assert.equal(preference.sshAllowed, false);
    assert.equal((await controlPlane.getMySshAccess(developer, { projectId })).project.allowed, false);
  });

  it('supports every global, organization, team, host, connection, project, identity, and client gate', async () => {
    const targets = [
      { targetType: 'global' },
      { targetType: 'organization', targetId: 'organization-1' },
      { targetType: 'team', targetId: 'team-1' },
      { targetType: 'host', targetId: 'host-1' },
      { targetType: 'connection', targetId: 'connection-1' },
      { targetType: 'project', targetId: projectId },
      {
        targetType: 'identity',
        authType: 'oauth',
        issuer: developer.oauthIssuer,
        subject: developer.oauthSubject,
      },
      { targetType: 'oauth-client', issuer: developer.oauthIssuer, clientId: developer.oauthClient },
    ];
    for (const target of targets) {
      await controlPlane.adminSetSshAccess({ ...target, sshAllowed: true, sshEnabled: true, confirm: true }, admin);
    }
    await controlPlane.setMySshAccess({ scope: 'current-client', enabled: true, confirm: true }, developer);
    const access = await controlPlane.getMySshAccess(developer, { projectId });
    assert.equal(access.project.allowed, true);
    assert.ok(access.sshPolicyVersion > 1);

    const policies = await controlPlane.listSshAccessPolicies(admin);
    assert.equal(policies.history.length, targets.length + 2);
    assert.equal(policies.connections[0].sshAllowed, true);
    await assert.rejects(controlPlane.listSshAccessPolicies(developer), /Only administrators/);
  });

  it('lets any administrator denial take effect immediately and invalidates an approval', async () => {
    const request = await controlPlane.requestApproval({
      tool: 'run_project_tests',
      args: { projectId, runner: 'phpunit', target: 'tests/SmallTest.php', confirm: true },
      identity: developer,
    });
    await controlPlane.adminSetSshAccess(
      {
        targetType: 'oauth-client',
        issuer: developer.oauthIssuer,
        clientId: developer.oauthClient,
        sshAllowed: false,
      },
      admin
    );
    await controlPlane.decideApproval({ id: request.approval.id, decision: 'approved', identity: admin });
    assert.equal(
      await controlPlane.consumeApproval({
        tool: 'run_project_tests',
        args: { projectId, runner: 'phpunit', target: 'tests/SmallTest.php', confirm: true },
        identity: developer,
      }),
      null
    );
    assert.equal((await controlPlane.getMySshAccess(developer, { projectId })).project.allowed, false);
  });

  it('allows immediate self-disable without confirmation', async () => {
    const result = await controlPlane.setMySshAccess({ scope: 'current-client', enabled: false }, developer);
    assert.equal(result.sshEnabled, false);
  });
});
