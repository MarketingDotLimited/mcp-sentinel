import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateDeploymentProfile } from '../lib/deployment-profile.js';

describe('deployment profiles', () => {
  it('defaults safely to the single-host SQLite profile', () => {
    assert.deepEqual(validateDeploymentProfile({}), {
      profile: 'single-host',
      stateProvider: 'sqlite-wal',
      leaseProvider: 'systemd',
      ready: true,
    });
  });

  it('fails closed for incomplete or SQLite-backed HA', () => {
    assert.throws(() => validateDeploymentProfile({ MCP_DEPLOYMENT_PROFILE: 'ha' }), /requires/);
    assert.throws(
      () =>
        validateDeploymentProfile({
          MCP_DEPLOYMENT_PROFILE: 'ha',
          MCP_HA_NODE_ID: 'a',
          MCP_HA_STATE_PROVIDER: 'sqlite',
          MCP_HA_LEASE_PROVIDER: 'redis',
        }),
      /cannot use SQLite/
    );
    const profile = validateDeploymentProfile({
      MCP_DEPLOYMENT_PROFILE: 'ha',
      MCP_HA_NODE_ID: 'a',
      MCP_HA_STATE_PROVIDER: 'postgres',
      MCP_HA_LEASE_PROVIDER: 'redis',
    });
    assert.equal(profile.ready, false);
    const confirmedButUnimplemented = validateDeploymentProfile({
      MCP_DEPLOYMENT_PROFILE: 'ha',
      MCP_HA_NODE_ID: 'a',
      MCP_HA_STATE_PROVIDER: 'postgres',
      MCP_HA_LEASE_PROVIDER: 'redis',
      MCP_HA_CONFIRM_FAILOVER: 'true',
    });
    assert.equal(confirmedButUnimplemented.ready, false);
    assert.match(confirmedButUnimplemented.warning, /implemented and verified/);
    assert.equal(
      validateDeploymentProfile({
        MCP_DEPLOYMENT_PROFILE: 'ha',
        MCP_HA_NODE_ID: 'a',
        MCP_HA_STATE_PROVIDER: 'postgres',
        MCP_HA_LEASE_PROVIDER: 'redis',
        MCP_HA_CONFIRM_FAILOVER: 'true',
        MCP_HA_IMPLEMENTATION_READY: 'true',
      }).ready,
      true
    );
  });
});
