import '../test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('validateConfig fatal rate limits', async () => {
  const origExit = process.exit;
  const origError = console.error;
  let exitCode = null;
  process.exit = code => {
    exitCode = code;
  };
  console.error = () => {};

  process.env.RATE_LIMIT_MAX_REQUESTS = '-1';

  await import('../../server.js');

  assert.equal(exitCode, 1);

  process.exit = origExit;
  console.error = origError;
  delete process.env.RATE_LIMIT_MAX_REQUESTS;
  setTimeout(() => process['exit'](0), 10);
});
