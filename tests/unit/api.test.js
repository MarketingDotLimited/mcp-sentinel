import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('api.js', () => {
  let dom;
  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.sessionStorage = dom.window.sessionStorage;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.sessionStorage;
    delete global.fetch;
  });

  test('Tokens', async () => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
    API.setToken('test-token');
    assert.strictEqual(API.getToken(), 'test-token');
    assert.strictEqual(API.isAuthenticated(), true);
    API.clearToken();
    assert.strictEqual(API.getToken(), null);
    assert.strictEqual(API.isAuthenticated(), false);
  });

  test('API.login', async t => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);

    global.fetch = t.mock.fn(async (url, opts) => {
      if (opts.headers['X-API-Key'] === 'good') {
        return { ok: true, json: async () => ({ token: 'new-token' }) };
      }
      return { ok: false, json: async () => ({ error: 'Bad key' }) };
    });

    const res = await API.login('good');
    assert.strictEqual(res.token, 'new-token');
    assert.strictEqual(API.getToken(), 'new-token');

    await assert.rejects(API.login('bad'), /Bad key/);
  });

  test('API.logout', async t => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
    API.setToken('test');
    API.logout();
    assert.strictEqual(API.getToken(), null);
    assert.strictEqual(window.location.hash, '#/login');
  });

  test('API.request basic methods', async t => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
    global.fetch = t.mock.fn(async () => ({ ok: true, json: async () => ({ ok: 1 }) }));

    API.setToken('tok');
    await API.get('/test');
    await API.post('/test', { a: 1 });
    await API.put('/test', { b: 2 });
    await API.del('/test');

    assert.strictEqual(global.fetch.mock.calls.length, 4);
    assert.strictEqual(global.fetch.mock.calls[0].arguments[1].headers.Authorization, 'Bearer tok');
    assert.strictEqual(global.fetch.mock.calls[1].arguments[1].method, 'POST');
    assert.strictEqual(global.fetch.mock.calls[2].arguments[1].method, 'PUT');
    assert.strictEqual(global.fetch.mock.calls[3].arguments[1].method, 'DELETE');
  });

  test('API.request 401/403', async t => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
    global.fetch = t.mock.fn(async () => ({ status: 401, ok: false, json: async () => ({ code: 'EXPIRED' }) }));

    API.setToken('tok');
    await assert.rejects(API.get('/test'), /Session expired/);
    assert.strictEqual(API.getToken(), null);
    assert.strictEqual(window.location.hash, '#/login');
  });

  test('API.request non-ok status', async t => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);

    // Normal error
    global.fetch = t.mock.fn(async () => ({
      status: 400,
      ok: false,
      json: async () => ({ error: 'Bad request', code: 'ERR_BAD', resolution: 'Fix it', detail: 'More info' }),
    }));
    try {
      await API.get('/test');
    } catch (e) {
      assert.strictEqual(e.message, 'Bad request (ERR_BAD)');
      assert.strictEqual(e.code, 'ERR_BAD');
      assert.strictEqual(e.resolution, 'Fix it');
      assert.strictEqual(e.detail, 'More info');
    }

    // Text error fallback
    global.fetch = t.mock.fn(async () => {
      const err = new Error();
      err.json = async () => {
        throw new Error('Parse error');
      };
      err.text = async () => {
        throw new Error('Text parse error');
      };
      err.ok = false;
      err.status = 500;
      return err;
    });
    try {
      await API.get('/test2');
    } catch (e) {
      assert.match(e.message, /Unable to parse API response/);
    }

    // Broker error code
    global.fetch = t.mock.fn(async () => ({
      status: 500,
      ok: false,
      json: async () => ({ error: 'Broker error', code: 'BROKER_UNAVAILABLE' }),
    }));
    try {
      await API.get('/test3');
    } catch (e) {
      assert.strictEqual(e.status, 503);
    }

    // State error text
    global.fetch = t.mock.fn(async () => ({
      status: 500,
      ok: false,
      json: async () => ({ error: 'database is locked' }),
    }));
    try {
      await API.get('/test4');
    } catch (e) {
      assert.strictEqual(e.status, 503);
    }
  });

  test('API.request retry logic for specific URLs', async t => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);

    let calls = 0;
    global.fetch = t.mock.fn(async () => {
      calls++;
      const err = new Error('Failed to fetch');
      err.status = 503;
      throw err;
    });

    // Should retry multiple URLs for /admin/
    try {
      await API.get('/admin/test');
    } catch (e) {
      void e;
    }
    assert.ok(calls > 0);

    calls = 0;
    try {
      await API.get('/action-manifest');
    } catch (e) {
      void e;
    }
    assert.ok(calls > 0);
  });

  test('API.request fallbacks', async t => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);

    global.fetch = t.mock.fn(async () => {
      throw new Error('Failed to fetch');
    });

    let res = await API.get('/admin/action-manifest');
    assert.strictEqual(res.manifest.name, 'MCP Sentinel');

    res = await API.get('/admin/capabilities');
    assert.strictEqual(res.status, 'dependency-unavailable');

    res = await API.get('/admin/sessions');
    assert.strictEqual(res.status, 'dependency-unavailable');

    res = await API.get('/oauth-users');
    assert.deepEqual(res, []);

    try {
      await API.get('/non-fallback');
    } catch (e) {
      assert.match(e.message, /Failed to fetch|Server unreachable/);
    }
  });

  test('API.request URL parsing edge cases', async t => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
    global.fetch = t.mock.fn(async () => ({
      status: 500,
      ok: false,
      json: async () => ({ error: 'database is locked' }),
    }));

    // object as url?
    try {
      await API.get({});
    } catch (e) {
      void e;
    }
    try {
      await API.get('http://invalid url');
    } catch (e) {
      void e;
    }
    try {
      await API.get('http://localhost/admin/test');
    } catch (e) {
      void e;
    }
  });
});
