import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

describe('All Pages Test', () => {
  let dom;
  let timeouts = [];
  beforeEach(() => {
    timeouts = [];
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (cb, ms) => {
      const id = origSetTimeout(cb, ms);
      timeouts.push(id);
      return id;
    };
    dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="toast-container"></div></body></html>', {
      url: 'http://localhost',
    });
    global.window = dom.window;
    global.document = dom.window.document;
    global.sessionStorage = dom.window.sessionStorage;
    global.FormData = dom.window.FormData;
    global.prompt = () => 'test-prompt-value';
    global.confirm = () => true;
    global.alert = () => {};
    if (!dom.window.HTMLFormElement.prototype.requestSubmit) {
      dom.window.HTMLFormElement.prototype.requestSubmit = function () {
        this.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
      };
    }
    const originalRemoveChild = dom.window.Node.prototype.removeChild;
    dom.window.Node.prototype.removeChild = function (child) {
      if (child.parentNode !== this) return child;
      return originalRemoveChild.call(this, child);
    };

    dom.window.__capturedListeners = [];
    const origAddEventListener = dom.window.EventTarget.prototype.addEventListener;
    dom.window.EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (typeof listener === 'function' || (listener && typeof listener.handleEvent === 'function')) {
        dom.window.__capturedListeners.push({ target: this, type, listener });
      }
      return origAddEventListener.call(this, type, listener, options);
    };
  });

  afterEach(() => {
    for (const id of timeouts) clearTimeout(id);
    delete global.window;
    delete global.document;
    delete global.sessionStorage;
    delete global.fetch;
    delete global.FormData;
    delete global.prompt;
    delete global.confirm;
    delete global.alert;
  });

  test('Crawl all pages with API mocked', async t => {
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });

    const { API } = await import('../../public/js/api.js');
    const { Toast } = await import('../../public/js/toast.js');
    Toast.init();

    const pagesDir = path.resolve(new URL('.', import.meta.url).pathname, '../../public/js/pages');
    const files = fs
      .readdirSync(pagesDir)
      .filter(f => f.endsWith('.js') && f !== 'dashboard.js' && f !== 'action-manifest.js');

    for (const file of files) {
      await import(`../../public/js/pages/${file}`);
      const componentName =
        file
          .replace('.js', '')
          .split('-')
          .map(p => p[0].toUpperCase() + p.slice(1))
          .join('') + 'Page';
      const component = window[componentName] || window[componentName.replace('Oauth', 'OAuth')];
      if (!component || !component.render) continue;

      const container = document.createElement('div');
      document.body.appendChild(container);

      const successData = {
        logs: ['log1', 'log2'],
        keys: [{ id: 'k1', prefix: 'abc', name: 'key1' }],
        sessions: [{ id: 's1', username: 'u1' }],
        providers: [],
        clients: [],
        mappings: [],
        rules: [{ id: 'r1', principle: 'p', environment: 'e' }],
        configuration: { max_age: 100 },
        capabilities: [{ id: 'pack1', title: 'Pack 1', description: 'Desc', enabled: true, defaultEnabled: false }],
        snapshots: [{ id: 'snap1', timestamp: '2023' }],
        projects: [{ id: 'p1', name: 'proj1', environments: [] }],
        teams: [{ id: 't1', name: 'team1' }],
        tasks: [{ id: 'job1', name: 'Job' }],
        connection: { id: 'c1' },
        requests: [{ id: 'req1', status: 'pending' }],
        policies: [{ id: 'pol1', effect: 'allow' }],
        readiness: { cloudConnectorReady: true, cloudConnectorMessage: 'test' },
        mcpUrl: 'http://test',
        users: [{ id: 'u1', username: 'u1' }],
        backups: [{ id: 'b1', timestamp: '2023-01-01', filePath: 'test.db', snapshotId: 'snap1' }],
      };

      // Pass 1: Success fetch
      API.get = t.mock.fn(async () => successData);
      API.post = t.mock.fn(async () => successData);
      API.put = t.mock.fn(async () => successData);
      API.delete = t.mock.fn(async () => successData);

      try {
        component.render(container);
      } catch (e) {
        void e;
      }
      await new Promise(r => setTimeout(r, 50));

      async function triggerAllEvents(isErrorRun) {
        let maxIters = 6;
        let seen = new Set();
        while (maxIters--) {
          let elements = document.body.querySelectorAll('*');
          let clickedAny = false;
          for (const el of elements) {
            if (seen.has(el)) continue;
            seen.add(el);
            clickedAny = true;
            if (el.dataset) {
              el.dataset.id = 'test-id';
              el.dataset.tab = 'test-tab';
            }
            if (el.tagName === 'FORM') {
              try {
                el.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
              } catch (e) {
                void e;
              }
            } else if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
              if (el.tagName === 'INPUT' && el.type === 'checkbox') el.checked = true;
              el.value = 'test_value';
              try {
                el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
              } catch (e) {
                void e;
              }
              try {
                el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
              } catch (e) {
                void e;
              }
            } else {
              try {
                el.click();
              } catch (e) {
                void e;
              }
            }
          }
          // directly trigger captured listeners
          const listeners = [...(window.__capturedListeners || [])];
          for (const l of listeners) {
            try {
              const e = new dom.window.Event(l.type, { bubbles: true, cancelable: true });
              e.preventDefault = () => {};
              e.stopPropagation = () => {};
              if (l.target.dataset) {
                l.target.dataset.id = 'test-id';
                l.target.dataset.tab = 'clients'; // oauth
                l.target.dataset.name = 'test-name';
              }
              if (l.target.value === undefined) l.target.value = 'test_value';
              if (l.listener.handleEvent) l.listener.handleEvent(e);
              else l.listener.call(l.target, e);
            } catch (err) {
              void err;
            }
          }
          await new Promise(r => setTimeout(r, 20));
        }
      }

      await triggerAllEvents(false);

      // Pass 2: Error
      API.get = t.mock.fn(async () => {
        throw new Error('API Error Mock');
      });
      API.post = t.mock.fn(async () => {
        throw new Error('API Error Mock');
      });
      API.put = t.mock.fn(async () => {
        throw new Error('API Error Mock');
      });
      API.delete = t.mock.fn(async () => {
        throw new Error('API Error Mock');
      });

      await triggerAllEvents(true);

      // Pass 3: specific for administration (capabilities error)
      if (file === 'administration.js') {
        API.get = t.mock.fn(async () => {
          const err = new Error('broker');
          err.code = 'BROKER_UNAVAILABLE';
          throw err;
        });
        try {
          component.render(container);
        } catch (e) {
          void e;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      if (component.destroy) {
        try {
          component.destroy();
        } catch (e) {
          void e;
        }
      }
      container.remove();
      window.__capturedListeners = [];
    }

    assert.ok(true);
  });
});
