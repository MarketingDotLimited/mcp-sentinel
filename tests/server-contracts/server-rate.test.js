import '../test-env.js';
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';

test('rate limit handler', async () => {
  process.env.RATE_LIMIT_MAX_REQUESTS = '1'; // 1 request allowed
  process.env.TEST_NO_LISTEN = 'false';
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';

  const { __TEST_EXPORTS__ } = await import('../../server.js');

  if (__TEST_EXPORTS__.brokerCall) {
    mock.method(__TEST_EXPORTS__, 'brokerCall', async () => ({ ok: true, data: [] }));
  }

  const server = __TEST_EXPORTS__.getServer();
  while (!server.address()) await new Promise(r => setTimeout(r, 10));
  const port = server.address().port;

  // Make 2 requests. 2nd should be 429!
  const res1 = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res1.status, 200);

  const res2 = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res2.status, 429);

  // also test authenticatedLimiter!
  // It uses req.identity, so we can just mock it or send a real token!
  // Wait, if it returns 429, it covered the globalLimiter block!

  server.closeAllConnections();
  await new Promise(r => server.close(r));
  if (__TEST_EXPORTS__.getIdleCheckInterval()) clearInterval(__TEST_EXPORTS__.getIdleCheckInterval());
});
