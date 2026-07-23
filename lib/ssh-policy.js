import crypto from 'node:crypto';

function stableId(namespace, parts) {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([namespace, ...parts.map(part => String(part || ''))]))
    .digest('hex');
  return `${namespace}:${digest}`;
}

export function scopedSshPolicyId(kind, id) {
  if (!['organization', 'team'].includes(kind) || !id) throw new Error('Invalid scoped SSH policy identity');
  return `${kind}:${id}`;
}

export function identitySshPreferenceId(identity) {
  if (identity?.authType === 'oauth') {
    if (!identity.oauthIssuer || !identity.oauthSubject) throw new Error('OAuth issuer and subject are required');
    return stableId('oauth-identity', [identity.oauthIssuer, identity.oauthSubject]);
  }
  if (identity?.keyId) return stableId('api-key', [identity.keyId]);
  if (identity?.userId) return stableId('local-user', [identity.userId]);
  throw new Error('A stable authenticated identity is required');
}

export function oauthClientSshPolicyId(issuer, clientId) {
  if (!issuer || !clientId) throw new Error('OAuth issuer and client ID are required');
  return stableId('oauth-client', [issuer, clientId]);
}

export function subjectClientSshPreferenceId(identity) {
  if (!identity?.oauthIssuer || !identity.oauthSubject || !identity.oauthClient)
    throw new Error('OAuth issuer, subject, and client ID are required');
  return stableId('oauth-subject-client', [identity.oauthIssuer, identity.oauthSubject, identity.oauthClient]);
}

function enabledLayer(name, record, { allowed = true } = {}) {
  if (!record) return { name, allowed: false, reason: `${name} policy is not configured` };
  if (record.enabled === false) return { name, allowed: false, reason: `${name} record is disabled` };
  if (record.sshEnabled !== true) return { name, allowed: false, reason: `${name} is disabled` };
  if (allowed && record.sshAllowed !== true)
    return { name, allowed: false, reason: `${name} administrator ceiling denies SSH` };
  return { name, allowed: true };
}

function projectIsAssigned(state, identity, project) {
  if (identity.role === 'admin') return true;
  if (Array.isArray(identity.projectIds)) return identity.projectIds.includes(project.id);
  if (identity.teamId) {
    const team = state.teams?.find(item => item.id === identity.teamId);
    return Boolean(team?.projectIds?.includes(project.id));
  }
  return false;
}

/**
 * Evaluate only the transport gate. Existing tool scopes and action approvals
 * remain mandatory and are enforced by their existing invocation path.
 */
export function evaluateSshPolicy({ state, identity, project }) {
  if (!state || !identity || !project) throw new Error('State, identity, and project are required');
  if ((project.transportKind || 'local') === 'local') {
    return {
      usesSsh: false,
      allowed: true,
      effective: false,
      reason: 'Project uses local transport',
      layers: [],
    };
  }
  if (project.transportKind !== 'ssh-gateway') {
    return {
      usesSsh: true,
      allowed: false,
      effective: false,
      reason: 'Project transport is unsupported',
      layers: [],
    };
  }

  const host = state.hosts?.find(item => item.id === project.hostId);
  const connectionId = project.sshConnectionId || project.connectionId;
  const connection = state.sshConnections?.find(item => item.id === connectionId);
  const layers = [
    enabledLayer(
      'Global SSH',
      state.sshPolicies?.find(item => item.id === 'global')
    ),
  ];

  if (identity.organizationId) {
    layers.push(
      enabledLayer(
        'Organization SSH',
        state.sshPolicies?.find(item => item.id === scopedSshPolicyId('organization', identity.organizationId))
      )
    );
  }
  if (identity.teamId) {
    layers.push(
      enabledLayer(
        'Team SSH',
        state.sshPolicies?.find(item => item.id === scopedSshPolicyId('team', identity.teamId))
      )
    );
  }

  layers.push(
    enabledLayer('Host SSH', host),
    enabledLayer('Connection SSH', connection),
    enabledLayer('Project SSH', project),
    {
      name: 'Project assignment',
      allowed: projectIsAssigned(state, identity, project),
      reason: 'Identity is not assigned to this project',
    }
  );

  let identityPreference;
  try {
    identityPreference = state.identitySshPreferences?.find(item => item.id === identitySshPreferenceId(identity));
  } catch {
    identityPreference = null;
  }
  layers.push(enabledLayer('Identity SSH', identityPreference));

  if (identity.authType === 'oauth') {
    let clientPolicy;
    let subjectClientPreference;
    try {
      clientPolicy = state.oauthClientSshPolicies?.find(
        item => item.id === oauthClientSshPolicyId(identity.oauthIssuer, identity.oauthClient)
      );
      subjectClientPreference = state.subjectClientSshPreferences?.find(
        item => item.id === subjectClientSshPreferenceId(identity)
      );
    } catch {
      clientPolicy = null;
      subjectClientPreference = null;
    }
    layers.push(
      enabledLayer('OAuth client SSH', clientPolicy),
      enabledLayer('OAuth subject-client SSH', subjectClientPreference, { allowed: false })
    );
  }

  if (!connectionId)
    layers.push({ name: 'Connection binding', allowed: false, reason: 'Project has no SSH connection' });
  else if (connection && connection.hostId !== project.hostId)
    layers.push({
      name: 'Connection binding',
      allowed: false,
      reason: 'SSH connection is not registered for the project host',
    });
  else layers.push({ name: 'Connection binding', allowed: true });

  const denied = layers.find(layer => !layer.allowed);
  return {
    usesSsh: true,
    allowed: !denied,
    effective: !denied,
    reason: denied?.reason || 'SSH is enabled by every applicable policy layer',
    hostId: project.hostId,
    connectionId: connectionId || null,
    layers,
  };
}
