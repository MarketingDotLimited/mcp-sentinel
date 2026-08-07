import { test, describe, mock, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'node:http';

mock.module('../security.js', {
  namedExports: {
    // Return 401 to ensure rate limiter counts it as an unsuccessful request
    authenticate: (req, res, next) => res.status(401).json({ error: 'unauth' }),
    authenticateJWT: (req, res, next) => next(),
    issueToken: (req, res) => res.json({ token: 'mock' }),
    getClientIP: () => '1.2.3.4',
    revokeSessionToken: (req, res) => res.json({ success: true }),
  },
});

mock.module('../audit.js', {
  namedExports: {
    logSecurityEvent: mock.fn(),
  },
});

import authRouter from '../routes/auth.js';
import { logSecurityEvent } from '../audit.js';

describe('auth router', () => {
  let app;
  let server;
  let baseUrl;

  before(async () => {
    app = express();
    // trust proxy to ensure IP is read properly if needed
    app.set('trust proxy', 1);
    app.use('/auth', authRouter);
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, () => {
        baseUrl = `http://localhost:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('rate limiter blocks after 10 requests', async () => {
    let lastStatus;
    let lastBody;

    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${baseUrl}/auth/token`, {
        method: 'POST',
        headers: {
          'x-forwarded-for': '1.2.3.4'
        }
      });
      lastStatus = res.status;
      lastBody = await res.json();
    }

    assert.strictEqual(lastStatus, 429);
    assert.deepStrictEqual(lastBody, { error: 'Too many authentication attempts' });
  });
});
