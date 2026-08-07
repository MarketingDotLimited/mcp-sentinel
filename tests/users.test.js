import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const brokerCallMock = mock.fn(() => Promise.resolve('mocked_result'));
mock.module('../lib/broker-client.js', {
  namedExports: { brokerCall: brokerCallMock }
});

const users = await import('../tools/users.js');

test('users tools', async (t) => {
  const adminIdentity = { role: 'admin', userId: 'adminuser' };
  const userIdentity = { role: 'user', userId: 'normaluser' };

  t.afterEach(() => {
    brokerCallMock.mock.resetCalls();
  });

  await t.test('listUsers requires admin', async () => {
    await assert.rejects(users.listUsers({}, userIdentity), /User management requires admin role/);
    const result = await users.listUsers({ includeSystem: true }, adminIdentity);
    assert.equal(result, 'mocked_result');
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['user.list', { includeSystem: true }]);
  });

  await t.test('getUserInfo allows user to view their own info or admin to view any', async () => {
    await assert.rejects(users.getUserInfo({ username: 'otheruser' }, userIdentity), /You can only view your own user info/);
    
    await users.getUserInfo({ username: 'normaluser' }, userIdentity);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['user.info', { username: 'normaluser' }]);
    
    await users.getUserInfo({ username: 'otheruser' }, adminIdentity);
    assert.deepEqual(brokerCallMock.mock.calls[1].arguments, ['user.info', { username: 'otheruser' }]);
  });

  await t.test('getUserInfo rejects invalid username', async () => {
    await assert.rejects(users.getUserInfo({ username: 'root' }, userIdentity), /You can only view your own user info/);
    // Even if it's admin, if allowRoot is true, root is valid.
    await users.getUserInfo({ username: 'root' }, adminIdentity);
    
    await assert.rejects(users.getUserInfo({ username: 'invalid name!' }, adminIdentity), /Invalid username/);
  });

  await t.test('createUser requires admin and valid inputs', async () => {
    await assert.rejects(users.createUser({ username: 'newuser' }, userIdentity), /User management requires admin role/);
    
    await assert.rejects(users.createUser({ username: 'root' }, adminIdentity), /Cannot modify reserved system user/);
    await assert.rejects(users.createUser({ username: 'newuser', groups: 'invalid group' }, adminIdentity), /groups must contain valid group names/);
    
    await users.createUser({ username: 'newuser', groups: 'group1,group2', shell: '/bin/bash', comment: 'test user', createHome: false }, adminIdentity);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['user.create', {
      username: 'newuser',
      groups: ['group1', 'group2'],
      shell: '/bin/bash',
      comment: 'test user',
      createHome: false
    }]);
  });

  await t.test('deleteUser requires admin and valid username', async () => {
    await assert.rejects(users.deleteUser({ username: 'user1' }, userIdentity), /User management requires admin role/);
    await assert.rejects(users.deleteUser({ username: 'root' }, adminIdentity), /Cannot modify reserved system user/);
    
    await users.deleteUser({ username: 'user1', removeHome: true }, adminIdentity);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['user.delete', { username: 'user1', removeHome: true }]);
  });

  await t.test('setUserPassword requires admin and valid password', async () => {
    await assert.rejects(users.setUserPassword({ username: 'user1', password: 'password1234' }, userIdentity), /User management requires admin role/);
    await assert.rejects(users.setUserPassword({ username: 'user1', password: 'short' }, adminIdentity), /Password must be 12-1024 characters/);
    await assert.rejects(users.setUserPassword({ username: 'user1', password: 'password\n1234' }, adminIdentity), /Password contains invalid characters/);
    
    await users.setUserPassword({ username: 'user1', password: 'validpassword123' }, adminIdentity);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['user.password', { username: 'user1', password: 'validpassword123' }]);
  });

  await t.test('modifyUser requires admin and valid inputs', async () => {
    await assert.rejects(users.modifyUser({ username: 'user1' }, userIdentity), /User management requires admin role/);
    await assert.rejects(users.modifyUser({ username: 'user1', lockAccount: true, unlockAccount: true }, adminIdentity), /Cannot lock and unlock account simultaneously/);
    await assert.rejects(users.modifyUser({ username: 'user1', expireDate: '2023/01/01' }, adminIdentity), /expireDate must be YYYY-MM-DD or empty/);
    
    await users.modifyUser({ 
      username: 'user1', 
      addGroups: 'g1', 
      removeGroups: 'g2', 
      shell: '/bin/sh', 
      lockAccount: true, 
      expireDate: '2024-12-31' 
    }, adminIdentity);
    
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['user.modify', {
      username: 'user1',
      addGroups: ['g1'],
      removeGroups: ['g2'],
      shell: '/bin/sh',
      lockAccount: true,
      expireDate: '2024-12-31'
    }]);

    // Test unlockAccount and empty expireDate
    await users.modifyUser({ 
      username: 'user1',
      unlockAccount: true,
      expireDate: ''
    }, adminIdentity);
    
    assert.deepEqual(brokerCallMock.mock.calls[1].arguments, ['user.modify', {
      username: 'user1',
      unlockAccount: true,
      expireDate: ''
    }]);
  });

  await t.test('manageSshKeys allows user to manage own or admin any', async () => {
    await assert.rejects(users.manageSshKeys({ username: 'otheruser', action: 'list' }, userIdentity), /You can only manage your own SSH keys/);
    await assert.rejects(users.manageSshKeys({ username: 'normaluser', action: 'invalid' }, userIdentity), /Invalid SSH key action/);
    
    // Normal user lists own keys
    await users.manageSshKeys({ username: 'normaluser', action: 'list' }, userIdentity);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['user.ssh', { username: 'normaluser', action: 'list' }]);

    // Admin lists root keys
    await users.manageSshKeys({ username: 'root', action: 'list' }, adminIdentity);
    assert.deepEqual(brokerCallMock.mock.calls[1].arguments, ['user.ssh', { username: 'root', action: 'list' }]);
  });

  await t.test('manageSshKeys validates public key on add', async () => {
    const validKey = 'ssh-rsa AAAAB3NzaC1yc2EAAA user@host';
    const invalidKeyType = 'ssh-unknown AAAAB3 user@host';
    const invalidKeyBase64 = 'ssh-rsa invalid-base64!! user@host';
    
    await assert.rejects(users.manageSshKeys({ username: 'user1', action: 'add', publicKey: invalidKeyType }, adminIdentity), /Invalid SSH public key payload/);
    await assert.rejects(users.manageSshKeys({ username: 'user1', action: 'add', publicKey: invalidKeyBase64 }, adminIdentity), /Invalid SSH public key payload/);
    
    await users.manageSshKeys({ username: 'user1', action: 'add', publicKey: validKey }, adminIdentity);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['user.ssh', { username: 'user1', action: 'add', publicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAA user@host' }]);
  });

  await t.test('manageSshKeys passes keyIndex on remove', async () => {
    await users.manageSshKeys({ username: 'user1', action: 'remove', keyIndex: 1 }, adminIdentity);
    assert.deepEqual(brokerCallMock.mock.calls[0].arguments, ['user.ssh', { username: 'user1', action: 'remove', keyIndex: 1 }]);
  });
});
