import '../test-env.js';
import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

mock.module('../../lib/broker-client.js', {
  namedExports: {
    brokerCall: mock.fn(),
  },
});

const { manageService, getServiceStatus, listServices, getJournalLogs, manageFirewall } =
  await import('../../tools/services.js');
const { brokerCall } = await import('../../lib/broker-client.js');

describe('services tool', () => {
  beforeEach(() => {
    brokerCall.mock.resetCalls();
    brokerCall.mock.mockImplementation(async () => ({ stdout: 'default output', stderr: '' }));
  });

  describe('manageService', () => {
    test('throws if not admin', async () => {
      await assert.rejects(manageService({}, { role: 'user' }), /Service management requires admin role/);
    });

    test('throws if missing arguments', async () => {
      await assert.rejects(manageService({}, { role: 'admin' }), /service and action are required/);
      await assert.rejects(manageService({ service: 'nginx' }, { role: 'admin' }), /service and action are required/);
      await assert.rejects(manageService({ action: 'start' }, { role: 'admin' }), /service and action are required/);
    });

    test('validates service name', async () => {
      await assert.rejects(
        manageService({ service: 'name!', action: 'start' }, { role: 'admin' }),
        /Invalid service name: 'name!'/
      );
      await assert.rejects(
        manageService({ service: 'name/', action: 'start' }, { role: 'admin' }),
        /Invalid service name: 'name\/'/
      );
      await assert.rejects(
        manageService({ service: '-name', action: 'start' }, { role: 'admin' }),
        /Service name cannot start with -/
      );
      await assert.rejects(
        manageService({ service: 'name..name', action: 'start' }, { role: 'admin' }),
        /Invalid service name/
      );
    });

    test('throws if invalid action', async () => {
      await assert.rejects(manageService({ service: 'nginx', action: 'invalid' }, { role: 'admin' }), /Invalid action/);
    });

    test('calls brokerCall and formats output', async () => {
      brokerCall.mock.mockImplementationOnce(async () => ({ stdout: '  ok  ', stderr: '' }));
      let res = await manageService({ service: 'nginx', action: 'start' }, { role: 'admin' });
      assert.deepEqual(res, { service: 'nginx', action: 'start', output: 'ok' });
      assert.equal(brokerCall.mock.calls.length, 1);
      assert.deepEqual(brokerCall.mock.calls[0].arguments, ['service.action', { service: 'nginx', action: 'start' }]);

      brokerCall.mock.mockImplementationOnce(async () => ({ stdout: '', stderr: ' err ' }));
      res = await manageService({ service: 'nginx', action: 'start' }, { role: 'admin' });
      assert.equal(res.output, 'err');

      brokerCall.mock.mockImplementationOnce(async () => ({ stdout: '', stderr: null }));
      res = await manageService({ service: 'nginx', action: 'start' }, { role: 'admin' });
      assert.equal(res.output, 'Command executed');
    });
  });

  describe('getServiceStatus', () => {
    test('throws if not admin', async () => {
      await assert.rejects(getServiceStatus({}, { role: 'user' }), /Service management requires admin role/);
    });

    test('throws if missing service', async () => {
      await assert.rejects(getServiceStatus({}, { role: 'admin' }), /service is required/);
    });

    test('validates service name', async () => {
      await assert.rejects(getServiceStatus({ service: 'name!' }, { role: 'admin' }), /Invalid service name/);
    });

    test('calls brokerCall successfully with data', async () => {
      brokerCall.mock.mockImplementation(async method => {
        if (method === 'service.status') return { active: 'active', enabled: 'enabled', status: 'running' };
        if (method === 'journal.read') return { stdout: 'logs' };
        return {};
      });
      const res = await getServiceStatus({ service: 'nginx' }, { role: 'admin' });
      assert.deepEqual(res, {
        service: 'nginx',
        active: 'active',
        enabled: 'enabled',
        status_output: 'running',
        recent_logs: 'logs',
      });
      assert.equal(brokerCall.mock.calls.length, 2);
    });

    test('calls brokerCall successfully with fallback data', async () => {
      brokerCall.mock.mockImplementation(async method => {
        if (method === 'service.status') return {};
        if (method === 'journal.read') return {};
        return {};
      });
      const res = await getServiceStatus({ service: 'nginx' }, { role: 'admin' });
      assert.deepEqual(res, {
        service: 'nginx',
        active: 'unknown',
        enabled: 'unknown',
        status_output: '',
        recent_logs: 'No logs available',
      });
    });
  });

  describe('listServices', () => {
    test('throws if not admin', async () => {
      await assert.rejects(listServices({}, { role: 'user' }), /Service management requires admin role/);
    });

    test('calls brokerCall with state and filters', async () => {
      brokerCall.mock.mockImplementation(async () => ({ stdout: 'Service A\nService B\nAnother A' }));

      let res = await listServices({ filter: 'A', state: 'active' }, { role: 'admin' });
      assert.deepEqual(res, { services: 'Service A\nAnother A', count: 2 });
      assert.deepEqual(brokerCall.mock.calls[0].arguments, ['service.list', { state: 'active' }]);
    });

    test('calls brokerCall without state and filters', async () => {
      brokerCall.mock.mockImplementation(async () => ({ stdout: 'Service A\nService B\n\n' }));

      let res = await listServices({}, { role: 'admin' });
      assert.deepEqual(res, { services: 'Service A\nService B', count: 2 });
      assert.deepEqual(brokerCall.mock.calls[0].arguments, ['service.list', {}]);
    });
  });

  describe('getJournalLogs', () => {
    test('throws if not admin', async () => {
      await assert.rejects(getJournalLogs({}, { role: 'user' }), /Service management requires admin role/);
    });

    test('validates service name if provided', async () => {
      await assert.rejects(getJournalLogs({ service: 'name!' }, { role: 'admin' }), /Invalid service name/);
    });

    test('respects lines constraints', async () => {
      await getJournalLogs({ lines: 0 }, { role: 'admin' });
      assert.equal(brokerCall.mock.calls[0].arguments[1].lines, 1);
      brokerCall.mock.resetCalls();

      await getJournalLogs({ lines: 600 }, { role: 'admin' });
      assert.equal(brokerCall.mock.calls[0].arguments[1].lines, 500);
      brokerCall.mock.resetCalls();

      await getJournalLogs({ lines: 20.5 }, { role: 'admin' });
      assert.equal(brokerCall.mock.calls[0].arguments[1].lines, 20);
      brokerCall.mock.resetCalls();

      await getJournalLogs({}, { role: 'admin' });
      assert.equal(brokerCall.mock.calls[0].arguments[1].lines, 50);
    });

    test('calls brokerCall with provided options', async () => {
      brokerCall.mock.mockImplementation(async () => ({ stdout: 'logs', stderr: 'err logs' }));
      const res = await getJournalLogs({ service: 'nginx', since: '1h', priority: 'err' }, { role: 'admin' });

      assert.deepEqual(brokerCall.mock.calls[0].arguments, [
        'journal.read',
        { service: 'nginx', lines: 50, since: '1h', priority: 'err' },
      ]);
      assert.deepEqual(res, { logs: 'logs', stderr: 'err logs' });
    });

    test('handles empty logs', async () => {
      brokerCall.mock.mockImplementation(async () => ({ stdout: '' }));
      const res = await getJournalLogs({}, { role: 'admin' });
      assert.deepEqual(res, { logs: 'No logs found', stderr: undefined });
    });
  });

  describe('manageFirewall', () => {
    test('throws if not admin', async () => {
      await assert.rejects(manageFirewall({}, { role: 'user' }), /Service management requires admin role/);
    });

    test('throws if invalid action', async () => {
      await assert.rejects(manageFirewall({ action: 'invalid' }, { role: 'admin' }), /Invalid firewall action/);
    });

    test('validates port number', async () => {
      await assert.rejects(
        manageFirewall({ action: 'allow', port: 'abc' }, { role: 'admin' }),
        /Port must be between 1 and 65535/
      );
      await assert.rejects(
        manageFirewall({ action: 'allow', port: -1 }, { role: 'admin' }),
        /Port must be between 1 and 65535/
      );
      await assert.rejects(
        manageFirewall({ action: 'allow', port: 65536 }, { role: 'admin' }),
        /Port must be between 1 and 65535/
      );
    });

    test('status/list actions', async () => {
      brokerCall.mock.mockImplementationOnce(async () => ({ stdout: 'status out' }));
      let res = await manageFirewall({ action: 'status' }, { role: 'admin' });
      assert.deepEqual(res, { action: 'status', output: 'status out' });

      brokerCall.mock.mockImplementationOnce(async () => ({ stderr: 'status err' }));
      res = await manageFirewall({ action: 'list' }, { role: 'admin' });
      assert.deepEqual(res, { action: 'list', output: 'status err' });
    });

    test('confirm action', async () => {
      await assert.rejects(
        manageFirewall({ action: 'confirm' }, { role: 'admin' }),
        /rollbackId is required to confirm a firewall change/
      );

      brokerCall.mock.mockImplementationOnce(async () => ({ success: true }));
      const res = await manageFirewall({ action: 'confirm', rollbackId: '123' }, { role: 'admin' });
      assert.deepEqual(res, { success: true });
      assert.deepEqual(brokerCall.mock.calls[0].arguments, ['firewall.confirm', { rollbackId: '123' }]);
    });

    test('delete action rule validation', async () => {
      await assert.rejects(
        manageFirewall({ action: 'delete', port: 80 }, { role: 'admin' }),
        /Rule must be allow or deny for delete action/
      );
      await assert.rejects(
        manageFirewall({ action: 'delete', port: 80, rule: 'invalid' }, { role: 'admin' }),
        /Rule must be allow or deny for delete action/
      );
    });

    test('missing port for other actions', async () => {
      await assert.rejects(
        manageFirewall({ action: 'allow' }, { role: 'admin' }),
        /Invalid combination of action and parameters/
      );
    });

    test('rule action formats output', async () => {
      brokerCall.mock.mockImplementationOnce(async () => ({
        stdout: ' ok ',
        stderr: '',
        rollbackId: 'id1',
        rollbackAt: 'time1',
      }));
      let res = await manageFirewall({ action: 'allow', port: 80, rule: 'allow' }, { role: 'admin' });
      assert.deepEqual(res, { action: 'allow', output: 'ok', rollbackId: 'id1', rollbackAt: 'time1' });

      brokerCall.mock.mockImplementationOnce(async () => ({
        stdout: '',
        stderr: ' err ',
        rollbackId: 'id2',
        rollbackAt: 'time2',
      }));
      res = await manageFirewall({ action: 'deny', port: 443 }, { role: 'admin' });
      assert.deepEqual(res, { action: 'deny', output: 'err', rollbackId: 'id2', rollbackAt: 'time2' });
      assert.deepEqual(brokerCall.mock.calls[1].arguments, [
        'firewall.rule',
        { action: 'deny', port: 443, protocol: 'tcp', rule: undefined },
      ]);
    });
  });
});
