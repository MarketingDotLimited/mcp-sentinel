import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const brokerCallMock = mock.fn(() => Promise.resolve('mocked_result'));
mock.module('../lib/broker-client.js', {
  namedExports: { brokerCall: brokerCallMock }
});

const autheliaClient = await import('../lib/authelia-client.js');

test('authelia-client tests', async (t) => {
  t.afterEach(() => {
    brokerCallMock.mock.resetCalls();
  });

  await t.test('getOAuthUsers calls brokerCall with correct arguments', async () => {
    const result = await autheliaClient.getOAuthUsers();
    assert.equal(result, 'mocked_result');
    assert.equal(brokerCallMock.mock.calls.length, 1);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['oauth.user.list', {}]);
  });

  await t.test('addOAuthUser calls brokerCall with correct arguments', async () => {
    const result = await autheliaClient.addOAuthUser({ user: 'test' });
    assert.equal(result, 'mocked_result');
    assert.equal(brokerCallMock.mock.calls.length, 1);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['oauth.user.add', { user: 'test' }]);
  });

  await t.test('updateOAuthUser calls brokerCall with correct arguments', async () => {
    const result = await autheliaClient.updateOAuthUser('testuser', { field: 'val' });
    assert.equal(result, 'mocked_result');
    assert.equal(brokerCallMock.mock.calls.length, 1);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['oauth.user.update', { username: 'testuser', updates: { field: 'val' } }]);
  });

  await t.test('deleteOAuthUser calls brokerCall with correct arguments', async () => {
    const result = await autheliaClient.deleteOAuthUser('testuser');
    assert.equal(result, 'mocked_result');
    assert.equal(brokerCallMock.mock.calls.length, 1);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['oauth.user.delete', { username: 'testuser' }]);
  });

  await t.test('getOAuthClients calls brokerCall with correct arguments', async () => {
    const result = await autheliaClient.getOAuthClients();
    assert.equal(result, 'mocked_result');
    assert.equal(brokerCallMock.mock.calls.length, 1);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['oauth.client.list', {}]);
  });

  await t.test('addOAuthClient calls brokerCall with correct arguments', async () => {
    const result = await autheliaClient.addOAuthClient({ client: 'test' });
    assert.equal(result, 'mocked_result');
    assert.equal(brokerCallMock.mock.calls.length, 1);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['oauth.client.add', { client: 'test' }]);
  });

  await t.test('deleteOAuthClient calls brokerCall with correct arguments', async () => {
    const result = await autheliaClient.deleteOAuthClient('testclient');
    assert.equal(result, 'mocked_result');
    assert.equal(brokerCallMock.mock.calls.length, 1);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['oauth.client.delete', { clientId: 'testclient' }]);
  });

  await t.test('getAutheliaHealth calls brokerCall with correct arguments', async () => {
    const result = await autheliaClient.getAutheliaHealth();
    assert.equal(result, 'mocked_result');
    assert.equal(brokerCallMock.mock.calls.length, 1);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['oauth.health', {}]);
  });
});
