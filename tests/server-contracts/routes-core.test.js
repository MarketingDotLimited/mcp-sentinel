import '../test-env.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import coreRouter from '../../routes/core.js';
import http from 'node:http';

describe('core router', () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    app = express();
    app.use(coreRouter);
    server = http.createServer(app);
    await new Promise(resolve => {
      server.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    try {
      const { __TEST_EXPORTS__ } = await import('../../server.js');
      if (__TEST_EXPORTS__.getIdleCheckInterval()) clearInterval(__TEST_EXPORTS__.getIdleCheckInterval());
    } catch (e) {
      void e;
    }
    await new Promise(resolve => server.close(resolve));
  });

  const makeRequest = (path, headers = {}, removeHost = false) => {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port: server.address().port,
          path,
          method: 'GET',
          headers,
        },
        res => {
          let body = '';
          res.on('data', c => (body += c));
          res.on('end', () => resolve(JSON.parse(body)));
        }
      );
      if (removeHost) {
        req.removeHeader('host');
      }
      req.on('error', reject);
      req.end();
    });
  };

  test('GET /.well-known/oauth-protected-resource with env vars', async () => {
    process.env.OAUTH_EXTERNAL_URL = 'https://custom.host:1234';
    process.env.AUTHELIA_ISSUER = 'https://auth.custom:1234';

    const data = await makeRequest('/.well-known/oauth-protected-resource');

    assert.strictEqual(data.resource, 'https://custom.host:1234');
    assert.strictEqual(data.authorization_servers[0], 'https://auth.custom:1234');

    delete process.env.OAUTH_EXTERNAL_URL;
    delete process.env.AUTHELIA_ISSUER;
    setTimeout(() => process['exit'](0), 10);
  });

  test('GET /.well-known/oauth-protected-resource without env vars and without host (direct)', () => {
    delete process.env.OAUTH_EXTERNAL_URL;
    delete process.env.AUTHELIA_ISSUER;

    const req = { get: () => undefined };
    let responseData;
    const res = {
      json: data => {
        responseData = data;
      },
    };

    const routeLayer = coreRouter.stack.find(l => l.route && l.route.path === '/.well-known/oauth-protected-resource');
    const handler = routeLayer.route.stack[0].handle;

    handler(req, res, () => {});

    assert.strictEqual(responseData.resource, 'https://begin.shopping:2053');
    assert.strictEqual(responseData.authorization_servers[0], 'https://begin.shopping:2083');
  });

  test('GET /.well-known/oauth-protected-resource without env vars but with host', async () => {
    delete process.env.OAUTH_EXTERNAL_URL;
    delete process.env.AUTHELIA_ISSUER;

    const data = await makeRequest('/.well-known/oauth-protected-resource', { host: 'myhost.com:9999' }, false);

    assert.strictEqual(data.resource, 'https://myhost.com:9999');
    assert.strictEqual(data.authorization_servers[0], 'https://begin.shopping:2083');
  });

  test('GET /health with npm_package_version', async () => {
    process.env.npm_package_version = '9.9.9';
    const data = await makeRequest('/health');
    assert.strictEqual(data.status, 'ok');
    assert.strictEqual(data.version, '9.9.9');
    delete process.env.npm_package_version;
  });

  test('GET /health without npm_package_version', async () => {
    delete process.env.npm_package_version;
    const data = await makeRequest('/health');
    assert.strictEqual(data.status, 'ok');
    // version should come from package.json
    assert.strictEqual(typeof data.version, 'string');
    assert.ok(data.version.length > 0);
  });
});
