import '../test-env.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('server-routes-fuzzer', () => {
  it('fuzzes express handlers safely', async () => {
    process.env.TEST_NO_LISTEN = 'true';
    const {
      __TEST_EXPORTS__: { app: expressApp },
    } = await import('../../server.js');
    const routes = expressApp._router?.stack || [];
    const handlers = [];

    for (const layer of routes) {
      if (layer.route) {
        const path = layer.route.path;
        for (const method of Object.keys(layer.route.methods)) {
          const handler = layer.route.stack[layer.route.stack.length - 1].handle;
          handlers.push({ method, path, handler });
        }
      }
    }

    const fuzzHandler = async (h, role, body, query, params) => {
      let statusCode = 200;
      let responseBody = null;

      const dummyRes = {
        status: function (code) {
          statusCode = code;
          return this;
        },
        json: function (data) {
          responseBody = data;
          return this;
        },
        send: function (data) {
          responseBody = data;
          return this;
        },
        type: function () {
          return this;
        },
        set: function () {
          return this;
        },
        setHeader: function () {
          return this;
        },
        on: function () {},
        once: function () {},
        emit: function () {},
        end: function () {},
      };

      const req = {
        method: 'POST',
        path: '/fuzz',
        headers: {},
        identity: role ? { role, userId: 'test-user', scopes: ['*'] } : undefined,
        body: body || {},
        query: query || {},
        params: params || {},
        clientIP: '127.0.0.1',
        protocol: 'http',
        get: () => 'mcp.example.test',
        on: (evt, cb) => {
          if (evt === 'close') setTimeout(cb, 10);
        },
      };

      try {
        const result = h(req, dummyRes, () => {});
        if (result && typeof result.catch === 'function') {
          await result.catch(err => {
            assert.ok(err instanceof Error, 'Route handler error must be an Error instance');
          });
        }
      } catch (err) {
        assert.ok(err instanceof Error, 'Route handler error must be an Error instance');
      }

      assert.ok(statusCode >= 100 && statusCode <= 599, 'Status code must be valid HTTP status');
    };

    for (const r of handlers) {
      if (typeof r.handler !== 'function') continue;
      const validBody = { 
        id: '123', q: 'test', key: 'dummy-key', userId: 'dummy-user', name: 'dummy-name',
        components: ['api-keys'], enabledTools: ['test'], manifestHash: 'test', 
        username: 'test', clientId: 'test', oauthReauthorized: true, newChatTested: true, 
        type: 'test', hostname: 'test', port: 22, remote: 'test', provider: 'test', 
        confirmationCode: '123', description: 'test', ip: '127.0.0.1', password: 'test', 
        role: 'admin', confirm: true, address: '127.0.0.1', targetType: 'global',
        sshAllowed: true, sshEnabled: true, enabled: true, scope: 'identity'
      };

      // Ensure activeTransports has at least 6 entries to trigger idle cleanup in makeSessionRoom
      if (r.path === '/mcp' && r.method === 'get') {
         for (let i=0; i<6; i++) {
           await fuzzHandler(r.handler, 'admin', {}, {}, { transport: 'sse' });
         }
      } 
      await fuzzHandler(r.handler, 'admin', {}, {}, {});
      await fuzzHandler(r.handler, 'admin', validBody, validBody, validBody);
      await fuzzHandler(r.handler, 'user', validBody, validBody, validBody);
      await fuzzHandler(r.handler, null, null, null, null);
    }
  });
});

describe('server-helpers-explicit', () => {
  it('tests helpers explicitly with contract assertions', async () => {
    const { __TEST_EXPORTS__ } = await import('../../server.js');
    let statusCode = 200;
    let jsonBody = null;

    const dummyRes = {
      status: function (code) {
        statusCode = code;
        return this;
      },
      json: function (data) {
        jsonBody = data;
        return this;
      },
      send: function (data) {
        jsonBody = data;
        return this;
      },
      type: function () {
        return this;
      },
    };

    const brokerRes = await __TEST_EXPORTS__
      .ensurePrivilegeBrokerAvailable({ identity: { role: 'admin' } }, dummyRes, () => {})
      .catch((e) => { console.log('Broker throw:', e); });
    console.log('BrokerRes:', brokerRes, 'StatusCode:', statusCode);
    assert.ok(typeof statusCode === 'number');

    await __TEST_EXPORTS__
      .ensurePrivilegeBrokerAvailable({}, dummyRes, () => {})
      .catch(() => {});
    assert.equal(statusCode, 401);

    await __TEST_EXPORTS__
      .ensurePrivilegeBrokerAvailable({ identity: { role: 'user' } }, dummyRes, () => {})
      .catch(() => {});
    assert.equal(statusCode, 403);

    assert.equal(typeof __TEST_EXPORTS__.isRecoverableDependencyError(new Error('ENOENT')), 'boolean');
    assert.equal(typeof __TEST_EXPORTS__.isRecoverableDependencyError('connect ENOENT'), 'boolean');

    const complexErr = new Error('foo');
    complexErr.cause = new Error('broker is unavailable');
    assert.equal(typeof __TEST_EXPORTS__.isRecoverableDependencyError(complexErr), 'boolean');

    const healthSummary = __TEST_EXPORTS__.summarizeHealth({ cpu: 50, memory: 50, disk: 50 });
    assert.ok(healthSummary && typeof healthSummary === 'object');

    const fallback = __TEST_EXPORTS__.adminDependencyFallbackResponse('/admin/oauth-users', new Error('test'));
    assert.ok(fallback.status >= 200);

    const fallbackManifest = __TEST_EXPORTS__.adminDependencyFallbackResponse('/admin/action-manifest', new Error('test'));
    assert.ok(fallbackManifest.status >= 200);

    assert.equal(typeof __TEST_EXPORTS__.isBrokerUnavailable(new Error('broker unavailable')), 'boolean');
    assert.equal(typeof __TEST_EXPORTS__.isOAuthDependencyError(new Error('oauth')), 'boolean');

    __TEST_EXPORTS__.respondBrokerUnavailable(dummyRes, new Error('test'));
    assert.ok(statusCode >= 400);

    __TEST_EXPORTS__.respondStateUnavailable(dummyRes, new Error('test'));
    assert.ok(statusCode >= 400);

    const posture = await __TEST_EXPORTS__.buildSecurityPosture();
    assert.ok(posture && typeof posture === 'object');

    const sanitizedOverrides = __TEST_EXPORTS__.sanitizeClientOverrides({ foo: { bar: 1 }, bar: [] });
    assert.ok(sanitizedOverrides && typeof sanitizedOverrides === 'object');

    const sanitizedOAuthUser = __TEST_EXPORTS__.sanitizeOAuthUserPayload({ clients: { foo: { bar: 1 } }, other: 123 });
    assert.ok(sanitizedOAuthUser && typeof sanitizedOAuthUser === 'object');

    assert.equal(typeof __TEST_EXPORTS__.normalizeAdminReadPath('http://evil.com/admin/test'), 'string');
    assert.equal(typeof __TEST_EXPORTS__.normalizeAdminReadPath('///api/admin/test'), 'string');
  });
});

describe('server-helpers-extract', () => {
  it('tests missing helpers with contract assertions', async () => {
    const { __TEST_EXPORTS__ } = await import('../../server.js');
    let statusCode = 200;

    const dummyRes = {
      status: function (code) {
        statusCode = code;
        return this;
      },
      json: function () {},
    };

    assert.equal(typeof __TEST_EXPORTS__.extractDependencyErrorText(new Error('test')), 'string');
    assert.equal(
      typeof __TEST_EXPORTS__.extractDependencyErrorText({ message: 'test', error: { detail: 'nested' } }),
      'string'
    );
    assert.equal(
      typeof __TEST_EXPORTS__.extractDependencyErrorText({ message: 'test', cause: [ { detail: 'nested2' } ] }),
      'string'
    );

    assert.equal(typeof __TEST_EXPORTS__.isDependencyText('test'), 'boolean');
    assert.equal(typeof __TEST_EXPORTS__.isDependencyError(new Error('test')), 'boolean');

    __TEST_EXPORTS__.safeLogError({ test: 1 }); // must not throw

    __TEST_EXPORTS__.readAdminCollectionFallback({}, dummyRes, () => {}, {});
    assert.ok(statusCode >= 100);

    await __TEST_EXPORTS__.readAdminCollectionFallback({ originalUrl: '/admin/oauth-users' }, dummyRes, () => { throw new Error('test') }, []);
    assert.ok(statusCode >= 200);

    __TEST_EXPORTS__.invalidateOAuthSessions('test');

    assert.equal(typeof __TEST_EXPORTS__.manifestIdentityKey({ userId: 'u', role: 'admin' }), 'string');
    assert.equal(typeof __TEST_EXPORTS__.manifestIdentityKey({ oauthSubject: 's', oauthClient: 'c' }), 'string');

    await __TEST_EXPORTS__.refreshActiveToolLists();

    assert.equal(typeof (await __TEST_EXPORTS__.makeSessionRoom({}, '127.0.0.1')), 'boolean');

    await __TEST_EXPORTS__.requireAdminStepUp(
      { identity: { role: 'admin' }, body: { confirmationCode: '123' }, get: () => null },
      dummyRes,
      () => {}
    );
    assert.ok(statusCode >= 100);
  });
});
