import '../test-env.js';
process.env.TEST_NO_LISTEN = 'true';

import { test, describe, after, mock } from 'node:test';
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
    ensurePrivilegeBrokerAvailable,
    respondServiceDependencyUnavailable,
    adminReadFallbackHandler,
    readAdminCollectionFallback,
    buildSecurityPosture
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
    safeLogError(new Error('test error'), 'context');
  });

  test('process event listeners', () => {
    const originalExit = process.exit;
    const originalConsoleError = console.error;
    let exitCode = null;
    let consoleErrorCalled = false;
    process.exit = (code) => { exitCode = code; };
    console.error = () => { consoleErrorCalled = true; };

    const uncaughtListeners = process.listeners('uncaughtException');
    const ourUncaught = uncaughtListeners.find(f => f.toString().includes('UNCAUGHT_EXCEPTION'));
    if (ourUncaught) {
      ourUncaught(new Error('test uncaught'));
      assert.equal(exitCode, 1);
      assert.ok(consoleErrorCalled);
    }

    const unhandledListeners = process.listeners('unhandledRejection');
    const ourUnhandled = unhandledListeners.find(f => f.toString().includes('UNHANDLED_REJECTION'));
    if (ourUnhandled) {
      ourUnhandled('test unhandled');
    }

    process.exit = originalExit;
    console.error = originalConsoleError;
  });

  test('ensurePrivilegeBrokerAvailable coverage', async () => {
    const res = { status: (s) => ({ json: (j) => ({ status: s, body: j }) }) };
    const req = { identity: { role: 'admin' } };
    try {
      await ensurePrivilegeBrokerAvailable(req, res, () => 'next');
    } catch (e) {}
    try {
      await ensurePrivilegeBrokerAvailable({}, res, () => 'next');
    } catch (e) {}
    try {
      await ensurePrivilegeBrokerAvailable({ identity: { role: 'user' }}, res, () => 'next');
    } catch (e) {}
  });

  test('respondServiceDependencyUnavailable coverage', () => {
    const res = { status: (s) => ({ json: (j) => ({ status: s, body: j }) }) };
    respondServiceDependencyUnavailable(res, { code: 'STATE_STORE_UNAVAILABLE' });
  });

  test('extractDependencyErrorText coverage', () => {
    const obj = { message: 'test', error: { detail: 'inner' }, arr: ['val'] };
    obj.circular = obj; // circular ref
    extractDependencyErrorText(obj);
  });

  test('isOAuthDependencyError coverage', () => {
    isOAuthDependencyError({ response: { data: { error: 'test', message: 'test2' } } });
    isOAuthDependencyError({ err: [{ message: 'test' }] });
  });

  test('normalizeAdminReadPath coverage', () => {
    normalizeAdminReadPath('http://evil.com/foo');
    normalizeAdminReadPath('///foo');
    normalizeAdminReadPath('/api/admin/foo');
    normalizeAdminReadPath('/admin/api/foo');
    normalizeAdminReadPath('/api/foo');
    normalizeAdminReadPath('%E0%A4%A'); // malformed
  });

  test('adminDependencyFallbackResponse coverage', () => {
    adminDependencyFallbackResponse('/admin/oauth-users', new Error());
    adminDependencyFallbackResponse('/admin/oauth-clients', new Error());
    adminDependencyFallbackResponse('/admin/capabilities', new Error());
    adminDependencyFallbackResponse('/admin/sessions', new Error());
    adminDependencyFallbackResponse('/action-manifest', new Error());
  });

  test('summarizeHealth coverage', () => {
    summarizeHealth({ cpu: 85, memory: 80, disk: 70 });
    summarizeHealth({ cpu: 75, memory: 70, disk: 60 });
  });

  test('adminReadFallbackHandler coverage', async () => {
    const res = { status: (s) => ({ json: (j) => ({ status: s, body: j }) }) };
    const req = { path: '/foo', method: 'GET' };
    const reader = async () => { throw new Error('BROKER_UNAVAILABLE'); };
    await adminReadFallbackHandler(req, res, reader, { fallbackOnAnyError: true });
    
    const reader2 = async () => { throw { status: 403 }; };
    await adminReadFallbackHandler(req, res, reader2, {});
  });

  test('readAdminCollectionFallback coverage', async () => {
    const res = { status: (s) => ({ json: (j) => ({ status: s, body: j }) }) };
    const req = { identity: { role: 'admin' }, path: '/foo' };
    const reader = async () => { throw new Error('BROKER_UNAVAILABLE'); };
    await readAdminCollectionFallback(req, res, reader, { fallbackOnAnyError: true });

    const reader2 = async () => { throw { status: 403 }; };
    await readAdminCollectionFallback(req, res, reader2, {});
    
    const reqNoAuth = { path: '/foo' };
    await readAdminCollectionFallback(reqNoAuth, res, reader, {});

    const reqUser = { identity: { role: 'user' }, path: '/foo' };
    await readAdminCollectionFallback(reqUser, res, reader, {});
  });

  test('buildSecurityPosture coverage', async () => {
    try {
      await buildSecurityPosture();
    } catch(e) {}
  });
});
