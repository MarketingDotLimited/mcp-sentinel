import '../test-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSshPolicy,
  identitySshPreferenceId,
  oauthClientSshPolicyId,
  scopedSshPolicyId,
  subjectClientSshPreferenceId,
} from '../../lib/ssh-policy.js';

const projectId = '436b432a-206b-43cd-abfa-6291dbef0c50';
const identity = {
  authType: 'oauth',
  userId: 'developer',
  role: 'developer',
  oauthIssuer: 'https://auth.example.test',
  oauthSubject: 'subject-1',
  oauthClient: 'chatgpt',
  organizationId: 'organization-1',
  teamId: 'team-1',
  projectIds: [projectId],
};

function enabled(id, extra = {}) {
  return { id, enabled: true, sshAllowed: true, sshEnabled: true, policyVersion: 1, ...extra };
}

function enabledState() {
  return {
    teams: [{ id: 'team-1', projectIds: [projectId] }],
    hosts: [enabled('host-1', { transportKind: 'ssh-gateway' })],
    sshConnections: [enabled('connection-1', { hostId: 'host-1' })],
    sshPolicies: [
      enabled('global'),
      enabled(scopedSshPolicyId('organization', 'organization-1')),
      enabled(scopedSshPolicyId('team', 'team-1')),
    ],
    identitySshPreferences: [enabled(identitySshPreferenceId(identity))],
    oauthClientSshPolicies: [enabled(oauthClientSshPolicyId(identity.oauthIssuer, identity.oauthClient))],
    subjectClientSshPreferences: [enabled(subjectClientSshPreferenceId(identity), { sshAllowed: undefined })],
  };
}

function remoteProject() {
  return enabled(projectId, {
    transportKind: 'ssh-gateway',
    hostId: 'host-1',
    sshConnectionId: 'connection-1',
  });
}

describe('SSH policy evaluation', () => {
  it('does not apply disabled-by-default SSH state to local projects', () => {
    assert.deepEqual(evaluateSshPolicy({ state: {}, identity: { userId: 'local' }, project: { id: projectId } }), {
      usesSsh: false,
      allowed: true,
      effective: false,
      reason: 'Project uses local transport',
      layers: [],
    });
  });

  it('allows SSH only when every applicable layer enables it', () => {
    const result = evaluateSshPolicy({ state: enabledState(), identity, project: remoteProject() });
    assert.equal(result.allowed, true);
    assert.equal(
      result.layers.every(layer => layer.allowed),
      true
    );
  });

  it('uses any-deny-wins semantics at every policy layer', () => {
    const cases = [
      state => (state.sshPolicies.find(item => item.id === 'global').enabled = false),
      state => (state.sshPolicies.find(item => item.id.startsWith('organization:')).sshAllowed = false),
      state => (state.sshPolicies.find(item => item.id.startsWith('team:')).sshEnabled = false),
      state => (state.hosts[0].sshAllowed = false),
      state => (state.sshConnections[0].sshEnabled = false),
      (_state, project) => (project.sshEnabled = false),
      state => (state.identitySshPreferences[0].sshAllowed = false),
      state => (state.oauthClientSshPolicies[0].sshEnabled = false),
      state => (state.subjectClientSshPreferences[0].sshEnabled = false),
      (_state, _project, caller) => (caller.projectIds = []),
    ];
    for (const deny of cases) {
      const state = enabledState();
      const project = remoteProject();
      const caller = structuredClone(identity);
      deny(state, project, caller);
      assert.equal(evaluateSshPolicy({ state, identity: caller, project }).allowed, false);
    }
  });

  it('isolates OAuth subject, client, and issuer policies', () => {
    for (const change of [
      caller => (caller.oauthSubject = 'subject-2'),
      caller => (caller.oauthClient = 'another-client'),
      caller => (caller.oauthIssuer = 'https://other.example.test'),
    ]) {
      const caller = structuredClone(identity);
      change(caller);
      assert.equal(
        evaluateSshPolicy({ state: enabledState(), identity: caller, project: remoteProject() }).allowed,
        false
      );
    }
  });

  it('rejects missing and cross-host connection bindings', () => {
    const missing = remoteProject();
    delete missing.sshConnectionId;
    assert.match(evaluateSshPolicy({ state: enabledState(), identity, project: missing }).reason, /Connection/);

    const state = enabledState();
    state.sshConnections[0].hostId = 'host-2';
    assert.match(evaluateSshPolicy({ state, identity, project: remoteProject() }).reason, /not registered/);
  });

  it('gracefully handles identities lacking required fields for policy lookup', () => {
    const invalidIdentity = { authType: 'oauth' };
    const result = evaluateSshPolicy({ state: enabledState(), identity: invalidIdentity, project: remoteProject() });
    assert.equal(result.allowed, false);
    assert.equal(result.layers.find(l => l.name === 'Identity SSH').allowed, false);
    assert.equal(result.layers.find(l => l.name === 'OAuth client SSH').allowed, false);
    assert.equal(result.layers.find(l => l.name === 'OAuth subject-client SSH').allowed, false);
  });

  it('rejects unsupported project transport kinds', () => {
    const project = remoteProject();
    project.transportKind = 'unknown-transport';
    const result = evaluateSshPolicy({ state: enabledState(), identity, project });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'Project transport is unsupported');
  });

  it('allows access via team assignment when projectIds array is missing', () => {
    const state = enabledState();
    const caller = { ...identity };
    delete caller.projectIds; // Fallback to teamId
    const result = evaluateSshPolicy({ state, identity: caller, project: remoteProject() });
    assert.equal(result.allowed, true);
  });

  it('rejects if identity cannot produce a stable identity preference ID', () => {
    // Identity with no authType=oauth, no keyId, no userId
    const caller = { role: 'developer', teamId: 'team-1', organizationId: 'organization-1' };
    const state = enabledState();
    const result = evaluateSshPolicy({ state, identity: caller, project: remoteProject() });
    assert.equal(result.allowed, false);
    assert.equal(result.layers.find(l => l.name === 'Identity SSH').allowed, false);
  });

  it('throws on invalid state, identity, or project inputs', () => {
    assert.throws(() => evaluateSshPolicy({}), /State, identity, and project are required/);
  });

  it('throws on invalid scoped SSH policy identity', () => {
    assert.throws(() => scopedSshPolicyId('invalid-kind', 'id'), /Invalid scoped SSH policy identity/);
    assert.throws(() => scopedSshPolicyId('organization', null), /Invalid scoped SSH policy identity/);
  });

  it('validates api-key identity', () => {
    assert.match(identitySshPreferenceId({ keyId: '123' }), /^api-key:/);
  });

  it('validates local-user identity', () => {
    assert.match(identitySshPreferenceId({ userId: '456' }), /^local-user:/);
  });

  it('allows access via admin role', () => {
    const state = enabledState();
    const caller = { ...identity, role: 'admin' };
    delete caller.projectIds;
    delete caller.teamId; // ensure it doesn't fall back to team assignment
    const result = evaluateSshPolicy({ state, identity: caller, project: remoteProject() });
    assert.equal(result.allowed, true);
  });

  it('throws in subjectClientSshPreferenceId on missing fields', () => {
    assert.throws(() => subjectClientSshPreferenceId({}), /OAuth issuer, subject, and client ID are required/);
    assert.throws(
      () => subjectClientSshPreferenceId({ oauthIssuer: 'a' }),
      /OAuth issuer, subject, and client ID are required/
    );
    assert.throws(
      () => subjectClientSshPreferenceId({ oauthIssuer: 'a', oauthSubject: 'b' }),
      /OAuth issuer, subject, and client ID are required/
    );
  });
});
