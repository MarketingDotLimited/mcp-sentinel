import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

describe('scope-registry.js', () => {
  let dom;
  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.Event = dom.window.Event;
    global.sessionStorage = dom.window.sessionStorage;
  });

  afterEach(() => {
    if (dom && dom.window) dom.window.close();
    delete global.window;
    delete global.document;
    delete global.Event;
    delete global.sessionStorage;
    delete global.fetch;
  });

  test('scope registry functions', async (t) => {
    const { API } = await import(`../../public/js/api.js?t=${Date.now()}`);
    const { loadScopeRegistry, renderScopeSelector, getSelectedScopes, applyRoleTemplate } = await import(`../../public/js/scope-registry.js?t=${Date.now()}`);

    global.fetch = t.mock.fn(async () => ({ ok: true, json: async () => ({
      groups: {
        read: { label: 'Read', tools: ['t1', 't2'] },
        write: { label: 'Write', tools: ['t3'] }
      },
      templates: [
        { id: 'admin', scopes: ['*'] },
        { id: 'reader', scopes: ['read', 't3'] },
        { id: 'none', scopes: [] }
      ]
    })}));

    await loadScopeRegistry();

    const container = document.createElement('div');
    renderScopeSelector(container, ['read', 't3'], 'hybrid');

    assert.ok(container.innerHTML.includes('Read'));
    
    // Check all functionality
    const chkAll = container.querySelector('.scope-chk-all');
    chkAll.checked = true;
    chkAll.dispatchEvent(new Event('change'));
    
    let scopes = getSelectedScopes(container);
    assert.deepEqual(scopes, ['*']);
    
    chkAll.checked = false;
    chkAll.dispatchEvent(new Event('change'));

    // Check group functionality
    const groupChks = container.querySelectorAll('.scope-chk-group');
    groupChks[0].checked = true; // read
    groupChks[0].dispatchEvent(new Event('change'));

    const toolChks = container.querySelectorAll('.scope-chk-tool');
    assert.strictEqual(toolChks[0].disabled, true);
    assert.strictEqual(toolChks[0].checked, true);

    toolChks[2].checked = true; // t3
    toolChks[2].dispatchEvent(new Event('change'));

    scopes = getSelectedScopes(container);
    assert.deepEqual(scopes, ['read', 't3']);

    // Apply template
    applyRoleTemplate(container, 'admin');
    scopes = getSelectedScopes(container);
    assert.deepEqual(scopes, ['*']);

    applyRoleTemplate(container, 'reader');
    scopes = getSelectedScopes(container);
    assert.deepEqual(scopes, ['read', 't3']);
    
    applyRoleTemplate(container, 'unknown'); // nothing happens
    applyRoleTemplate(container, null); // nothing happens

    // test load error
    global.fetch = t.mock.fn(async () => ({ ok: false, json: async () => ({ error: 'bad' })}));
    await loadScopeRegistry();
  });
});
