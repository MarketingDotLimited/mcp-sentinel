import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REMOTE_BROKER_OPERATIONS, assertRemoteBrokerOperation } from '../lib/remote-operation-policy.js';

test('remote-operation-policy', async (t) => {
  await t.test('REMOTE_BROKER_OPERATIONS contains expected operations', () => {
    assert(REMOTE_BROKER_OPERATIONS.has('broker.health'));
    assert(REMOTE_BROKER_OPERATIONS.has('project.file.read'));
    assert(REMOTE_BROKER_OPERATIONS.has('project.git'));
  });

  await t.test('assertRemoteBrokerOperation allows permitted operations', () => {
    const result = assertRemoteBrokerOperation('project.file.read');
    assert.equal(result, 'project.file.read');
  });

  await t.test('assertRemoteBrokerOperation throws on non-permitted operations', () => {
    assert.throws(() => assertRemoteBrokerOperation('unknown.operation'), { message: 'Operation is not permitted through the SSH node gateway' });
  });

  await t.test('assertRemoteBrokerOperation throws on invalid types', () => {
    assert.throws(() => assertRemoteBrokerOperation(null), { message: 'Operation is not permitted through the SSH node gateway' });
    assert.throws(() => assertRemoteBrokerOperation({}), { message: 'Operation is not permitted through the SSH node gateway' });
    assert.throws(() => assertRemoteBrokerOperation(123), { message: 'Operation is not permitted through the SSH node gateway' });
  });
});
