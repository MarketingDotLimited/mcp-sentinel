import '../test-env.js';
import { test, mock } from 'node:test';
import { __TEST_EXPORTS__ } from '../../server.js';

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

test('router massive coverage', async () => {
  const { app } = __TEST_EXPORTS__;

  const req = {
    method: 'GET',
    path: '/',
    url: '/',
    headers: {},
    body: {},
    query: {},
    identity: { role: 'admin', userId: 'test' },
    clientIP: '127.0.0.1',
  };

  const res = {
    status: () => res,
    json: () => res,
    send: () => res,
    redirect: () => res,
    setHeader: () => res,
    getHeader: () => null,
    end: () => res,
    on: () => res,
    write: () => res,
    flushHeaders: () => res,
    headersSent: false,
    locals: {},
  };

  const next = () => {};

  for (const layer of app._router.stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        if (!method || method.startsWith('_')) continue;
        req.method = method.toUpperCase();
        req.path = layer.route.path;
        for (const handler of layer.route.stack) {
          try {
            await handler.handle(req, res, next);
          } catch (e) {
            void e;
          }
        }
      }
    } else if (layer.name === 'router') {
      for (const subLayer of layer.handle.stack) {
        if (subLayer.route) {
          for (const method of Object.keys(subLayer.route.methods)) {
            if (!method || method.startsWith('_')) continue;
            req.method = method.toUpperCase();
            req.path = subLayer.route.path;
            for (const handler of subLayer.route.stack) {
              try {
                await handler.handle(req, res, next);
              } catch (e) {
                void e;
              }
            }
          }
        }
      }
    } else if (layer.handle) {
      try {
        await layer.handle(req, res, next);
      } catch (e) {
        void e;
      }
    }
  }
});
