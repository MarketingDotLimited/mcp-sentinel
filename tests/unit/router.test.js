import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('router.js', () => {
  let dom;
  beforeEach(() => {
    dom = new JSDOM(
      '<!DOCTYPE html><html><body><div id="main-content"></div><nav id="sidebar" style="display:none"></nav><button id="mobile-toggle" hidden></button><a class="nav-link" href="#/dashboard"></a><a class="nav-link" href="#/login"></a></body></html>',
      { url: 'http://localhost' }
    );
    global.window = dom.window;
    global.document = dom.window.document;
    global.sessionStorage = dom.window.sessionStorage;
  });

  afterEach(() => {
    if (dom && dom.window) dom.window.close();
    delete global.window;
    delete global.document;
    delete global.sessionStorage;
  });

  test('Router basic', async t => {
    const { Auth } = await import(`../../public/js/auth.js?t=${Date.now()}`);
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
    const { Router } = await import(`../../public/js/router.js?t=${Date.now()}`);

    API.clearToken();

    let pageRendered = false;
    let pageDestroyed = false;
    const dummyPage = {
      render: c => {
        pageRendered = true;
        c.textContent = 'dummy';
      },
      destroy: () => {
        pageDestroyed = true;
      },
    };

    Router.register('/login', dummyPage);

    window.location.hash = '#/unknown';
    Router.init();

    // Auth guard redirects to /login because not logged in
    assert.strictEqual(window.location.hash, '#/login');
    // Calling navigate again manually
    Router.navigate();

    assert.strictEqual(pageRendered, true);
    assert.strictEqual(document.getElementById('sidebar').style.display, 'none');

    // Login
    API.setToken('test');

    window.location.hash = '#/login';
    Router.navigate(); // Should redirect to /dashboard
    assert.strictEqual(window.location.hash, '#/dashboard');

    // Default route
    window.location.hash = '#/unknown';
    Router.navigate();
    assert.strictEqual(window.location.hash, '#/dashboard');

    Router.currentPage = null;
    Router.register('/dashboard', {
      render: c => {
        c.textContent = 'dash';
      },
    });
    Router.navigate();
    assert.strictEqual(document.getElementById('main-content').textContent, 'dash');

    // Test small screen
    Object.defineProperty(window, 'innerWidth', { value: 500 });
    Router.navigate();
    assert.strictEqual(document.getElementById('sidebar').getAttribute('aria-hidden'), 'true');
  });
});
