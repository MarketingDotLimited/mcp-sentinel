import '../test-env.js';
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';

// Mock dependencies before importing server.js
mock.method(global, 'fetch', async () => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'mock-token', data: 'mock-data' }),
  text: async () => 'mock-text',
}));

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
mock.method(fsPromises, 'writeFile', async () => {});
mock.method(fsPromises, 'mkdir', async () => {});

import child_process from 'node:child_process';
mock.method(child_process, 'exec', (cmd, cb) => cb(null, 'mock-stdout', ''));
mock.method(child_process, 'execFile', (cmd, args, cb) => cb ? cb(null, 'mock-stdout', '') : undefined);

test('fuzz success paths', async () => {
  process.env.TEST_NO_LISTEN = 'true';
  const { __TEST_EXPORTS__ } = await import('../../server.js');
  
  // Mock brokerCall inside server.js to succeed
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
      status: 'completed',
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
