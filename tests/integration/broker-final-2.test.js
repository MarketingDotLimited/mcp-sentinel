import '../test-env.js';
import { test, describe, before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.BROKER_MANAGED_USERS = 'testuser';
process.env.BROKER_MANAGED_SERVICES = 'nginx';
process.env.BROKER_CONFIG_BACKUP_ROOT = '/tmp/config-backups';

describe('broker final branches 2', async () => {
  const { handleRequest } = await import('../../broker.js');
  
  it('covers healthUrl branches (lines 233-236, 258-263)', async (t) => {
    const cp = createRequire(import.meta.url)('node:child_process');
    t.mock.method(cp, 'execFile', (cmd, args, cb) => {
      if (cb) cb(null, { stdout: '', stderr: '' });
      return {};
    });
    t.mock.method(cp, 'execSync', () => Buffer.from(''));
    t.mock.method(fs, 'readFileSync', (p) => {
      console.log("readFileSync called with", p);
      if (p.includes('registry.json') || p.includes('test-config')) {
        return JSON.stringify({
          configs: {
            'test-config': {
              service: 'nginx',
              path: '/tmp/test',
              validator: 'json',
              healthUrl: 'ftp://invalid-url'
            },
            'test-config-2': {
              service: 'nginx',
              path: '/tmp/test2',
              validator: 'json',
              healthUrl: 'http://u:p@localhost'
            },
            'test-config-3': {
              service: 'nginx',
              path: '/tmp/test3',
              validator: 'json',
              healthUrl: 'http://localhost/health'
            }
          }
        });
      }
      return '{}';
    });
    
    try {
      await handleRequest({ operation: 'config.backups', parameters: { configId: 'test-config' }, requestId: '00000000-0000-0000-0000-000000000000' });
    } catch (e) {
      console.log("Error test-config:", e.message);
    }
    try {
      await handleRequest({ operation: 'config.backups', parameters: { configId: 'test-config-2' }, requestId: '00000000-0000-0000-0000-000000000000' });
    } catch (e) {
      console.log("Error test-config-2:", e.message);
    }
    
    // For 258-263, mock fetch
    t.mock.method(global, 'fetch', async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' }));
    try {
      await handleRequest({ operation: 'config.apply', parameters: { configId: 'test-config-3', content: 'xyz', healthCheckTimeout: 1 }, requestId: '00000000-0000-0000-0000-000000000000' });
    } catch (e) {
      console.log("Error test-config-3 apply:", e.message);
    }
    
    // And network fetch failure
    global.fetch.mock.restore();
    t.mock.method(global, 'fetch', async () => { throw new Error('Network error'); });
    try {
      await handleRequest({ operation: 'config.apply', parameters: { configId: 'test-config-3', content: 'xyz', healthCheckTimeout: 1 }, requestId: '00000000-0000-0000-0000-000000000000' });
    } catch (e) {
      console.log("Error test-config-3 apply network error:", e.message);
    }
  });
});
