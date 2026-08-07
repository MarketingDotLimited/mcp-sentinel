import '../test-env.js';
process.env.TEST_NO_LISTEN = 'true';

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

describe('Server internal functions', async () => {
  const { __TEST_EXPORTS__ } = await import('../../server.js');
  const {
    isBrokerUnavailable,
    isRecoverableDependencyError,
    extractDependencyErrorText,
    isDependencyText,
    isDependencyError,
    isOAuthDependencyError,
    sanitizeClientOverrides,
    sanitizeOAuthUserPayload,
    normalizeAdminReadPath,
    adminDependencyFallbackResponse,
    isBrokerUnavailableError,
    isStateStoreUnavailable,
    summarizeHealth,
    safeLogError,
  } = __TEST_EXPORTS__;

  test('isBrokerUnavailable', () => {
    assert.equal(isBrokerUnavailable(null), false);
    assert.equal(isBrokerUnavailable('broker unavailable'), true);
    assert.equal(isBrokerUnavailable({ code: 'BROKER_UNAVAILABLE' }), true);
  });

  test('isStateStoreUnavailable', () => {
    assert.equal(isStateStoreUnavailable({ code: 'STATE_STORE_UNAVAILABLE' }), true);
  });

  test('isRecoverableDependencyError', () => {
    assert.equal(isRecoverableDependencyError('connect ENOENT'), true);
  });

  test('extractDependencyErrorText', () => {
    assert.ok(extractDependencyErrorText(new Error('msg')).includes('msg'));
  });

  test('isDependencyText', () => {
    assert.equal(isDependencyText('connect ENOENT'), true);
  });

  test('isDependencyError', () => {
    assert.equal(isDependencyError('connect ENOENT'), true);
  });

  test('isOAuthDependencyError', () => {
    assert.equal(isOAuthDependencyError({ message: '/run/mcp-sentinel/broker.sock' }), true);
  });

  test('sanitizeClientOverrides', () => {
    assert.deepEqual(sanitizeClientOverrides({}), {});
    assert.deepEqual(sanitizeClientOverrides({ client1: { role: 'admin' } }), { client1: { role: 'admin' } });
  });

  test('sanitizeOAuthUserPayload', () => {
    assert.deepEqual(sanitizeOAuthUserPayload({}), {});
  });

  test('normalizeAdminReadPath', () => {
    assert.equal(normalizeAdminReadPath('/api/users'), '/admin/users');
  });

  test('adminDependencyFallbackResponse', () => {
    assert.ok(adminDependencyFallbackResponse('/admin/oauth-users', {}));
  });

  test('isBrokerUnavailableError', () => {
    assert.equal(isBrokerUnavailableError('privilege broker unavailable'), true);
  });

  test('summarizeHealth', () => {
    assert.equal(summarizeHealth({ cpu: 90, memory: 50, disk: 50 }).status, 'needs-attention');
  });

  test('safeLogError', () => {
    safeLogError(new Error('test error'), 'context'); // should not throw
  });
});
