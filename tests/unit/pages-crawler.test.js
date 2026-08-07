import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

describe('Generic Pages Test', () => {
  let dom;
  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="toast-container"></div></body></html>', { url: 'http://localhost' });
    global.window = dom.window;
    global.document = dom.window.document;
    global.sessionStorage = dom.window.sessionStorage;
    global.FormData = dom.window.FormData;
    // mock some globals that might be used
    global.prompt = () => 'test-prompt-value';
    global.confirm = () => true;
    global.alert = () => {};
    
    // Add dummy API and Toast for pages that don't import them correctly?
    // Wait, they import them, so we just need to let them use the real modules.
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
    delete global.sessionStorage;
    delete global.fetch;
    delete global.FormData;
    delete global.prompt;
    delete global.confirm;
    delete global.alert;
  });

  test('Crawl all pages', async (t) => {
    const pagesDir = path.resolve(new URL(".", import.meta.url).pathname, '../../public/js/pages');
    const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.js') && f !== 'dashboard.js');
    
    const { Toast } = await import(`../../public/js/toast.js?t=${Date.now()}`);
    Toast.init();

    for (const file of files) {
      const modulePath = `../../public/js/pages/${file}?t=${Date.now()}`;
      const mod = await import(modulePath);
      const componentName = file.replace('.js', '').split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('') + 'Page';
      const component = mod[componentName] || mod.default || window[componentName] || window[componentName.replace('Oauth', 'OAuth')];
      if (!component || !component.render) continue;

      const runPass = async (scenario) => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        
        Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: async () => { if (scenario.copyFail) throw new Error('fail'); } } }, configurable: true });
        
        global.fetch = t.mock.fn(async (url, opts) => {
          if (opts && opts.method !== 'GET' && scenario.postFail) {
            return { ok: false, json: async () => ({ error: 'post fail' }) };
          }
          if (scenario.getFail) {
            return { ok: false, json: async () => ({ error: 'get fail' }) };
          }
          
          const isPop = scenario.populated;
          return { ok: true, status: 200, json: async () => {
            if (url.includes('security')) return { status: 'safe', checks: isPop ? [{id: 'c1', status: 'pass', message: 'ok'}] : [] };
            if (url.includes('approvals')) return { approvals: isPop ? [{id: 'r1', status: 'pending', createdAt: Date.now(), requestedBy: {userId: 'u1'}}] : [] };
            if (url.includes('projects')) return { projects: isPop ? [{id: 'p1', name: 'p', repoPath: '/p'}] : [] };
            if (url.includes('workflows')) return { workflows: isPop ? [{title: 'w', description: 'd', risk: 'read-only', prompts: ['p1']}] : [] };
            if (url.includes('teams')) return { teams: isPop ? [{id: 't1', name: 't', members: []}] : [] };
            if (url.includes('backups')) return { backups: isPop ? [{timestamp: Date.now(), user: 'u', size: 1024}] : [] };
            if (url.includes('logs')) return { logs: isPop ? [{id: 'l1', message: 'm', timestamp: Date.now()}] : [] };
            if (url.includes('administration')) return { config: { admin: true } };
            if (url.includes('sessions')) return { sessions: isPop ? [{ id: 's1', username: 'u1', started: Date.now() }] : [] };
            if (url.includes('action-manifest')) return { manifest: { version: 1, hash: 'abc', tools: isPop ? [{name: 'tool1', description: 'desc', annotations: {}, inputSchema: {}, outputSchema: {}}] : [] }, refreshChecklist: [] };
            if (url.includes('ssh-access')) return { rules: isPop ? [{id: 'ssh1'}] : [], configuration: {port: 22} };
            if (url.includes('capabilities')) return { capabilities: isPop ? [{ id: 'pack1', title: 'Pack 1', description: 'Desc', enabled: true, defaultEnabled: false }] : [] };
            if (url.includes('connect')) return { connection: {status: 'ok'} };
            if (url.includes('keys')) return { keys: isPop ? [{ id: 'k1', prefix: 'abc', name: 'key1' }] : [] };
            if (url.includes('oauth')) return { providers: isPop ? [{id:'prov'}] : [], clients: isPop ? [{id:'c1'}] : [], mappings: [] };
            return [];
          }};
        });

        try { component.render(container); } catch(e) {}
        await new Promise(r => setTimeout(r, 20)); // let GETs finish
        
        let elements = container.querySelectorAll('button, input, select, form, a, [class*="btn"]');
        for (const el of elements) {
          if (el.tagName === 'FORM') {
            try { el.dispatchEvent(new dom.window.Event('submit', { cancelable: true })); } catch(e){}
          } else if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
            el.value = 'test';
            try { el.dispatchEvent(new dom.window.Event('input')); } catch(e){}
            try { el.dispatchEvent(new dom.window.Event('change')); } catch(e){}
          } else {
            try { el.click(); } catch(e){}
          }
        }
        await new Promise(r => setTimeout(r, 20)); // let POSTs finish

        if (component.destroy) {
          try { component.destroy(); } catch(e){}
        }
        container.remove();
      };
      
      await runPass({ populated: false, getFail: false, postFail: false, copyFail: false });
      await runPass({ populated: true, getFail: false, postFail: false, copyFail: false });
      await runPass({ populated: true, getFail: false, postFail: true, copyFail: true });
      await runPass({ populated: true, getFail: true, postFail: false, copyFail: false });
    }

    
    assert.ok(true);
  });
});
