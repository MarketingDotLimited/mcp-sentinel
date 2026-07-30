const PROFILE_PATTERN = /^(single-host|ha)$/;

export function validateDeploymentProfile(environment = process.env) {
  const profile = String(environment.MCP_DEPLOYMENT_PROFILE || 'single-host').trim();
  if (!PROFILE_PATTERN.test(profile)) throw new Error('MCP_DEPLOYMENT_PROFILE must be single-host or ha');
  if (profile === 'single-host') {
    return { profile, stateProvider: 'sqlite-wal', leaseProvider: 'systemd', ready: true };
  }
  const required = ['MCP_HA_NODE_ID', 'MCP_HA_STATE_PROVIDER', 'MCP_HA_LEASE_PROVIDER'];
  const missing = required.filter(name => !String(environment[name] || '').trim());
  if (missing.length) throw new Error(`HA profile requires ${missing.join(', ')}`);
  if (String(environment.MCP_HA_STATE_PROVIDER).toLowerCase() === 'sqlite')
    throw new Error('HA profile cannot use SQLite as a shared state provider');
  if (!['postgres', 'mysql', 'external'].includes(String(environment.MCP_HA_STATE_PROVIDER).toLowerCase()))
    throw new Error('Unsupported HA state provider');
  if (!['postgres', 'redis', 'consul', 'external'].includes(String(environment.MCP_HA_LEASE_PROVIDER).toLowerCase()))
    throw new Error('Unsupported HA lease provider');
  const failoverConfirmed = environment.MCP_HA_CONFIRM_FAILOVER === 'true';
  const implementationReady = environment.MCP_HA_IMPLEMENTATION_READY === 'true';
  return {
    profile,
    nodeId: String(environment.MCP_HA_NODE_ID),
    stateProvider: String(environment.MCP_HA_STATE_PROVIDER).toLowerCase(),
    leaseProvider: String(environment.MCP_HA_LEASE_PROVIDER).toLowerCase(),
    ready: failoverConfirmed && implementationReady,
    warning: !implementationReady
      ? 'HA failover remains disabled until replicated state, lease fencing, and failover rehearsal are implemented and verified'
      : failoverConfirmed
        ? null
        : 'HA failover remains disabled until lease fencing and replicated-state rehearsal are confirmed',
  };
}
