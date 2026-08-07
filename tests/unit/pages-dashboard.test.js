import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('dashboard.js', () => {
  let dom;
  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'http://localhost' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.sessionStorage = dom.window.sessionStorage;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.sessionStorage;
    delete global.fetch;
    delete global.Toast;
  });

  test('DashboardPage', async t => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
    const { Toast } = await import(`../../public/js/toast.js?t=${Date.now()}`);
    const { DashboardPage } = await import(`../../public/js/pages/dashboard.js?t=${Date.now()}`);

    t.mock.timers.enable({ apis: ['setInterval', 'Date'] });

    const container = document.createElement('div');

    // 1. Success with one data shape
    global.fetch = t.mock.fn(async () => ({
      ok: true,
      json: async () => ({
        cpu: 50,
        memory: 70,
        disk: 90,
        loadAvg: { '1m': 1, '5m': 2, '15m': 3 },
        activeSessions: 5,
        totalKeys: 10,
        serverUptime: 90000,
        healthSummary: { status: 'needs-attention', message: 'help' },
      }),
    }));

    DashboardPage.render(container);
    // wait for async fetchStats
    await new Promise(r => process.nextTick(r));

    // 2. Success with another data shape (arrays)
    global.fetch = t.mock.fn(async () => ({
      ok: true,
      json: async () => ({
        cpu: 90,
        memory: 90,
        disk: 10,
        load: [1, 2, 3],
        apiKeys: 2,
        uptime: 30,
        healthSummary: { status: 'watch', message: 'look' },
      }),
    }));
    t.mock.timers.tick(5000);
    await new Promise(r => process.nextTick(r));

    // 3. Success with empty/missing data shape
    global.fetch = t.mock.fn(async () => ({
      ok: true,
      json: async () => ({
        healthSummary: { status: 'good' },
      }),
    }));
    t.mock.timers.tick(5000);
    await new Promise(r => process.nextTick(r));

    // 4. Failure
    global.Toast = Toast;
    global.window.Toast = Toast;
    global.fetch = t.mock.fn(async () => ({ ok: false, json: async () => ({ error: 'bad' }) }));
    Toast.error = t.mock.fn();
    t.mock.timers.tick(5000);
    await new Promise(r => setTimeout(r, 10));
    assert.ok(Toast.error.mock.calls.length >= 1, 'Toast.error should be called');

    DashboardPage.destroy();

    t.mock.timers.reset();
  });
});
