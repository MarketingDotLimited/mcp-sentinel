import "../test-env.js";
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

mock.module("../../lib/broker-client.js", {
  namedExports: {
    brokerCall: mock.fn(),
  },
});

const { applyConfig, listConfigBackups, restoreConfig } = await import("../../tools/rollback.js");
const { brokerCall } = await import("../../lib/broker-client.js");

describe('rollback tool', () => {
  beforeEach(() => {
    brokerCall.mock.resetCalls();
    brokerCall.mock.mockImplementation(async () => ({ success: true }));
  });

  describe('applyConfig', () => {
    test('throws if not admin', async () => {
      await assert.rejects(applyConfig({}, { role: 'user' }), /Configuration tools require admin role/);
    });

    test('throws if configId is invalid', async () => {
      await assert.rejects(
        applyConfig({ configId: 123, newContent: 'content' }, { role: 'admin' }),
        /Invalid configId/
      );
      await assert.rejects(
        applyConfig({ configId: '1invalid', newContent: 'content' }, { role: 'admin' }),
        /Invalid configId/
      );
      await assert.rejects(
        applyConfig({ configId: 'a'.repeat(65), newContent: 'content' }, { role: 'admin' }),
        /Invalid configId/
      );
    });

    test('throws if newContent is missing or empty', async () => {
      await assert.rejects(
        applyConfig({ configId: 'valid-id', newContent: '' }, { role: 'admin' }),
        /newContent is required/
      );
      await assert.rejects(applyConfig({ configId: 'valid-id' }, { role: 'admin' }), /newContent is required/);
    });

    test('calls brokerCall with default healthCheckTimeout', async () => {
      await applyConfig({ configId: 'valid-id', newContent: 'content' }, { role: 'admin' });
      assert.equal(brokerCall.mock.calls.length, 1);
      assert.deepEqual(brokerCall.mock.calls[0].arguments, [
        'config.apply',
        { configId: 'valid-id', content: 'content', healthCheckTimeout: 20 },
        { timeoutMs: 60000 },
      ]);
    });

    test('calls brokerCall with provided healthCheckTimeout', async () => {
      brokerCall.mock.resetCalls();
      await applyConfig({ configId: 'valid-id', newContent: 'content', healthCheckTimeout: 30 }, { role: 'admin' });
      assert.deepEqual(brokerCall.mock.calls[0].arguments, [
        'config.apply',
        { configId: 'valid-id', content: 'content', healthCheckTimeout: 30 },
        { timeoutMs: 70000 },
      ]);

      brokerCall.mock.resetCalls();
      await applyConfig({ configId: 'valid-id', newContent: 'content', healthCheckTimeout: 3 }, { role: 'admin' });
      assert.deepEqual(brokerCall.mock.calls[0].arguments, [
        'config.apply',
        { configId: 'valid-id', content: 'content', healthCheckTimeout: 3 },
        { timeoutMs: 45000 },
      ]);

      brokerCall.mock.resetCalls();
      await applyConfig({ configId: 'valid-id', newContent: 'content', healthCheckTimeout: 100 }, { role: 'admin' });
      assert.deepEqual(brokerCall.mock.calls[0].arguments, [
        'config.apply',
        { configId: 'valid-id', content: 'content', healthCheckTimeout: 100 },
        { timeoutMs: 100000 },
      ]);

      brokerCall.mock.resetCalls();
      await applyConfig(
        { configId: 'valid-id', newContent: 'content', healthCheckTimeout: 'invalid' },
        { role: 'admin' }
      );
      assert.deepEqual(brokerCall.mock.calls[0].arguments, [
        'config.apply',
        { configId: 'valid-id', content: 'content', healthCheckTimeout: 'invalid' },
        { timeoutMs: 60000 },
      ]);
    });
  });

  describe('listConfigBackups', () => {
    test('throws if not admin', async () => {
      await assert.rejects(listConfigBackups({}, { role: 'user' }), /Configuration tools require admin role/);
    });

    test('throws if configId is invalid', async () => {
      await assert.rejects(listConfigBackups({ configId: '1invalid' }, { role: 'admin' }), /Invalid configId/);
    });

    test('calls brokerCall successfully', async () => {
      await listConfigBackups({ configId: 'valid-id' }, { role: 'admin' });
      assert.equal(brokerCall.mock.calls.length, 1);
      assert.deepEqual(brokerCall.mock.calls[0].arguments, ['config.backups', { configId: 'valid-id' }]);
    });
  });

  describe('restoreConfig', () => {
    test('throws if not admin', async () => {
      await assert.rejects(restoreConfig({}, { role: 'user' }), /Configuration tools require admin role/);
    });

    test('throws if configId is invalid', async () => {
      await assert.rejects(
        restoreConfig({ configId: '1invalid', timestamp: '1234567890' }, { role: 'admin' }),
        /Invalid configId/
      );
    });

    test('throws if timestamp is invalid', async () => {
      await assert.rejects(
        restoreConfig({ configId: 'valid-id', timestamp: 1234567890 }, { role: 'admin' }),
        /Invalid timestamp/
      );
      await assert.rejects(
        restoreConfig({ configId: 'valid-id', timestamp: '123456789' }, { role: 'admin' }), // length 9
        /Invalid timestamp/
      );
      await assert.rejects(
        restoreConfig({ configId: 'valid-id', timestamp: '12345678901234567' }, { role: 'admin' }), // length 17
        /Invalid timestamp/
      );
      await assert.rejects(
        restoreConfig({ configId: 'valid-id', timestamp: '12345abc90' }, { role: 'admin' }), // non-digit
        /Invalid timestamp/
      );
    });

    test('calls brokerCall successfully', async () => {
      await restoreConfig({ configId: 'valid-id', timestamp: '1234567890' }, { role: 'admin' });
      assert.equal(brokerCall.mock.calls.length, 1);
      assert.deepEqual(brokerCall.mock.calls[0].arguments, [
        'config.restore',
        { configId: 'valid-id', timestamp: '1234567890' },
        { timeoutMs: 75000 },
      ]);
    });
  });
});
