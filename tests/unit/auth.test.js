import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('auth.js', () => {
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

  test('Auth interactions', async t => {
    const { Auth } = await import(`../../public/js/auth.js?t=${Date.now()}`);
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
    const { Toast } = await import(`../../public/js/toast.js?t=${Date.now()}`);

    Toast.container = null; // reset toast

    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });

    Auth.init();

    // Test not logged in, no timer started
    assert.strictEqual(Auth.isLoggedIn(), false);

    global.fetch = t.mock.fn(async () => ({ ok: true, json: async () => ({ token: 'auth-token' }) }));

    await Auth.login('key');
    assert.strictEqual(Auth.isLoggedIn(), true);

    // Simulate events
    document.dispatchEvent(new dom.window.Event('click'));

    // Advance time almost to timeout
    t.mock.timers.tick(29 * 60 * 1000);
    assert.strictEqual(Auth.isLoggedIn(), true);

    // Should trigger timeout now
    t.mock.timers.tick(2 * 60 * 1000);
    assert.strictEqual(Auth.isLoggedIn(), false); // it calls API.logout(), which clears token
    assert.strictEqual(window.location.hash, '#/login');

    // Reset and test manual logout
    await Auth.login('key');
    Auth.logout();
    assert.strictEqual(Auth.isLoggedIn(), false);

    t.mock.timers.reset();
  });
});
