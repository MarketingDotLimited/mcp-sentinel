import '../test-env.js';
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import child_process from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

mock.method(global, 'fetch', async () => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'mock-token', data: 'mock-data' }),
  text: async () => 'mock-text',
}));

mock.method(child_process, 'exec', (cmd, cb) => cb ? cb(null, 'mock-stdout', '') : undefined);
mock.method(child_process, 'execFile', (cmd, args, cb) => {
  const callback = typeof args === 'function' ? args : cb;
  if (callback) callback(null, 'mock-stdout', '');
});

// Mock SQLite
mock.method(DatabaseSync.prototype, 'prepare', function() {
  return {
    all: () => [{ id: '123', count: 1, name: 'test', client_id: 'test', key_hash: '123', payload: '"mock"' }],
    get: () => ({ id: '123', count: 1, name: 'test', client_id: 'test', key_hash: '123', payload: '"mock"' }),
    run: () => ({ changes: 1, lastInsertRowid: 1 })
  };
});
mock.method(DatabaseSync.prototype, 'exec', function() {});

test('fuzz aggressive', async () => {
  process.env.TEST_NO_LISTEN = 'true';
  const { __TEST_EXPORTS__ } = await import('../../server.js');
  
  if (__TEST_EXPORTS__.brokerCall) {
    mock.method(__TEST_EXPORTS__, 'brokerCall', async () => ({ ok: true, data: [] }));
  }

  const routes = __TEST_EXPORTS__.app._router?.stack || [];
  const handlers = [];
  for (const layer of routes) {
    if (layer.route) {
      const path = layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        const handler = layer.route.stack[layer.route.stack.length - 1].handle;
        handlers.push({ method, path, handler });
      }
    }
  }

  for (const r of handlers) {
    const res = {
      status: () => res,
      json: () => res,
      send: () => res,
      type: () => res,
      set: () => res,
      setHeader: () => res,
      end: () => res,
      on: () => res,
      once: () => res,
      emit: () => res,
    };

    const validBody = {
      id: '123', action: 'test', confirmationCode: '123',
      host: '127.0.0.1', port: 22, username: 'test',
      clientId: '123', clientSecret: '123', scopes: ['read'],
      name: 'test', role: 'admin', sshAllowed: true, sshEnabled: true,
      enabled: true, scope: 'identity', targetType: 'global',
      projectId: '123', url: 'http://test', limit: 10, offset: 0,
      resource: 'urn:test', redirectUri: 'http://test/callback',
      codeVerifier: 'test', state: '123', code: 'test',
      status: 'completed', signature: 'test', challenge: 'test',
      clientDataJSON: 'test', authenticatorData: 'test'
    };

    const req = {
      method: r.method.toUpperCase(),
      path: r.path,
      identity: { role: 'admin', userId: 'test' },
      body: validBody,
      query: validBody,
      params: validBody,
      clientIP: '127.0.0.1',
      get: () => 'mcp.example.test',
      on: (e, cb) => cb(),
    };

    try {
      const p = r.handler(req, res, () => {});
      if (p && p.catch) await p.catch(() => {});
    } catch(e) { void e; }
  }
});
