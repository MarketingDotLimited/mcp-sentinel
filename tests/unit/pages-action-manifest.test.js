import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('action-manifest.js', () => {
  let dom;
  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="toast-container"></div></body></html>', { url: 'http://localhost' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.sessionStorage = dom.window.sessionStorage;
    global.FormData = dom.window.FormData;
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.sessionStorage;
    delete global.fetch;
    delete global.FormData;
  });

  test('ActionManifestPage logic', async (t) => {
    const { API } = await import('../../public/js/api.js');
    const { Toast } = await import('../../public/js/toast.js');
    Toast.init();
    await import('../../public/js/pages/action-manifest.js');
    const page = window.ActionManifestPage;
    const container = document.createElement('div');
    
    // Case 1: broker check success but unhealthy
    API.get = t.mock.fn(async (url) => {
      if (url.includes('action-manifest')) throw new Error('bad');
      if (url.includes('broker-status')) return { broker: { healthy: false } };
      return {};
    });
    page.render(container);
    await new Promise(r => setTimeout(r, 50));
    assert.match(container.textContent, /blocked while the privilege broker is unhealthy/);
    
    // Case 2: broker check throws
    API.get = t.mock.fn(async (url) => {
      if (url.includes('action-manifest')) throw new Error('bad');
      if (url.includes('broker-status')) throw new Error('broken');
      return {};
    });
    page.render(container);
    await new Promise(r => setTimeout(r, 50));
    assert.match(container.textContent, /currently unavailable/);

    // Case 3: success with checklist
    API.get = t.mock.fn(async (url) => {
      if (url.includes('action-manifest')) return { 
        manifest: { version: 1, hash: 'abc', tools: [{ name: 't1', title: 't1', description: 'd', annotations: { readOnlyHint: 'yes' } }] },
        refreshChecklist: ['item1', 'item2']
      };
      return {};
    });
    page.render(container);
    await new Promise(r => setTimeout(r, 50));
    assert.match(container.textContent, /item1/);

    // Case 4: confirm refresh success
    API.get = t.mock.fn(async (url) => {
      if (url.includes('action-manifest')) return { 
        manifest: { version: 1, hash: 'abc', tools: [] },
        refreshChecklist: []
      };
      return {};
    });
    API.post = t.mock.fn(async (url, options) => {
      if (url.includes('action-refresh-status')) return {};
      return {};
    });
    page.render(container);
    await new Promise(r => setTimeout(r, 50));
    
    const form = container.querySelector('form');
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 50));
    
    // Case 5: confirm refresh fails
    API.post = t.mock.fn(async (url, options) => {
      if (url.includes('action-refresh-status')) throw new Error('failed refresh');
      return {};
    });
    page.render(container);
    await new Promise(r => setTimeout(r, 50));
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 50));

    // Also test refresh-manifest button
    container.querySelector('#refresh-manifest').click();
    await new Promise(r => setTimeout(r, 50));
    
    // also test empty currentManifest early exit
    page.destroy();
    page.render(container);
    // force currentManifest to be null
    API.get = t.mock.fn(async () => { throw new Error('bad') });
    container.querySelector('#refresh-manifest').click();
    await new Promise(r => setTimeout(r, 50));
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }));

    page.destroy();
    
    // Case 6: broker check success and healthy
    API.get = t.mock.fn(async (url) => {
      if (url.includes('action-manifest')) throw new Error('bad');
      if (url.includes('broker-status')) return { broker: { healthy: true } };
      return {};
    });
    page.render(container);
    await new Promise(r => setTimeout(r, 50));
    assert.ok(container.textContent.includes('Unable to load the action manifest: bad'));
    
    page.destroy();
  });
});
