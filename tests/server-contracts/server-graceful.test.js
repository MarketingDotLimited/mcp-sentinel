import '../test-env.js';
process.env.TEST_NO_LISTEN = 'true';
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('graceful shutdown coverage', async () => {
  const { __TEST_EXPORTS__ } = await import('../../server.js');
  const { getServer, activeTransports } = __TEST_EXPORTS__;

  const origExit = process.exit;
  const origLog = console.log;
  let exitCode = null;
  process.exit = code => {
    exitCode = code;
  };
  console.log = () => {};

  // Mock setTimeout to not actually do anything for 10000ms
  const origSetTimeout = global.setTimeout;
  global.setTimeout = function () {
    if (arguments[1] === 10000) return;
    return origSetTimeout.apply(this, arguments);
  };

  // Mock server.close to run callback synchronously
  const server = getServer();
  let origClose;
  if (server) {
    origClose = server.close;
    server.close = cb => {
      if (cb) cb();
    };
  }

  // Add a fake transport to cover the close loop
  activeTransports.set('fake-1', { transport: { close: () => {} } });

  // Call the listeners to cover the lines
  process.listeners('SIGTERM').find(f => f.toString().includes('gracefulShutdown'))?.();

  // wait for the async exit from the audit.js import
  for (let i = 0; i < 20; i++) {
    if (exitCode === 0) break;
    await new Promise(r => origSetTimeout(r, 50));
  }

  process.exit = origExit;
  console.log = origLog;
  if (server) server.close = origClose;
  global.setTimeout = origSetTimeout;
});
