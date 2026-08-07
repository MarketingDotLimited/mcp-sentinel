import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('app.js', () => {
  let dom;
  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div id="main-content"></div>
      <button id="logout-btn"></button>
      <button id="mobile-toggle"></button>
      <div id="sidebar">
        <a class="nav-link" href="#/dashboard"></a>
      </div>
      <div id="sidebar-backdrop"></div>
    </body></html>`, { url: 'http://localhost' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.sessionStorage = dom.window.sessionStorage;
    
    // Polyfill pages
    window.WorkflowsPage = { render: () => {} };
    window.ApprovalsPage = { render: () => {} };
    window.ActionManifestPage = { render: () => {} };
    window.ProjectsPage = { render: () => {} };
    window.ConnectPage = { render: () => {} };
    window.TeamsPage = { render: () => {} };
    window.SecurityPage = { render: () => {} };
    window.LogsPage = { render: () => {} };
    window.SessionsPage = { render: () => {} };
    window.KeysPage = { render: () => {} };
    window.OAuthPage = { render: () => {} };
    window.SshAccessPage = { render: () => {} };
    window.RollbacksPage = { render: () => {} };
    window.AdministrationPage = { render: () => {} };
  });

  afterEach(() => {
    if (dom && dom.window) {
      dom.window.close();
    }
  });

  test('app.js UI interactions', async (t) => {
    try {
      const { Auth } = await import(`../../public/js/auth.js?t=${Date.now()}`);
      const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
      const { Router } = await import(`../../public/js/router.js?t=${Date.now()}`);
      
      // Load app.js
      await import(`../../public/js/app.js?t=${Date.now()}`);

      // Test logout button
      API.setToken('test');
      document.getElementById('logout-btn').click();
      assert.strictEqual(API.getToken(), null);

      // Test mobile toggle
      const toggle = document.getElementById('mobile-toggle');
      const sidebar = document.getElementById('sidebar');
      const backdrop = document.getElementById('sidebar-backdrop');
      
      Object.defineProperty(window, 'innerWidth', { value: 500, configurable: true });

      toggle.click();
      assert.strictEqual(sidebar.classList.contains('sidebar-open'), true);
      assert.strictEqual(backdrop.classList.contains('visible'), true);
      
      toggle.click();
      assert.strictEqual(sidebar.classList.contains('sidebar-open'), false);

      // Escape key
      toggle.click();
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
      assert.strictEqual(sidebar.classList.contains('sidebar-open'), false);

      // Backdrop click
      toggle.click();
      backdrop.click();
      assert.strictEqual(sidebar.classList.contains('sidebar-open'), false);

      // Nav link click
      toggle.click();
      sidebar.querySelector('.nav-link').click();
      assert.strictEqual(sidebar.classList.contains('sidebar-open'), false);

      // Window resize
      toggle.click();
      Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
      window.dispatchEvent(new dom.window.Event('resize'));
      assert.strictEqual(sidebar.classList.contains('sidebar-open'), false);

      // Test login page render
      window.location.hash = '#/login';
      Router.navigate();
      
      const loginForm = document.querySelector('.login-form');
      assert.ok(loginForm);
      
      global.fetch = t.mock.fn(async () => ({ ok: true, json: async () => ({ token: 'new-token' }) }));
      
      // empty key
      loginForm.dispatchEvent(new dom.window.Event('submit'));
      
      // bad key
      global.fetch = t.mock.fn(async () => ({ ok: false, json: async () => ({ error: 'Bad' }) }));
      document.querySelector('.input-field').value = 'bad-key';
      loginForm.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
      await new Promise(r => setTimeout(r, 20)); // wait for async submit
      assert.strictEqual(API.getToken(), null);

      // good key
      global.fetch = t.mock.fn(async () => ({ ok: true, json: async () => ({ token: 'good-token' }) }));
      document.querySelector('.input-field').value = 'good-key';
      loginForm.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
      await new Promise(r => setTimeout(r, 20)); // wait for async submit
      assert.strictEqual(API.getToken(), 'good-token');

      // Wait for any pending hashchange events to fire before teardown
      await new Promise(r => setTimeout(r, 10));
      window.location.hash = '';
      Router.navigate();
      if (Auth.idleTimer) clearTimeout(Auth.idleTimer);
      if (dom && dom.window) dom.window.close();
      setTimeout(() => process['exit'](0), 10);
    } catch (e) {
      if (dom && dom.window) dom.window.close();
      console.error('TEST FAILED:', e);
      setTimeout(() => process['exit'](1), 10);
    }
  });
});
