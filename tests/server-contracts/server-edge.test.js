import '../test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('server edge cases', async () => {
  const origExit = process.exit;
  const origError = console.error;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; };
  console.error = () => {};
  
  const { __TEST_EXPORTS__ } = await import('../../server.js');
  
  // Populate activeTransports to hit coverage
  let closed = false;
  __TEST_EXPORTS__.activeTransports.set('fake-id', {
    transport: { close: () => { closed = true; } }
  });
  __TEST_EXPORTS__.activeTransports.set('fake-id-2', {
    transport: { close: () => { throw new Error(); } }
  });
  
  let exit0Called = false;
  process.exit = (code) => { if (code === 0) exit0Called = true; };
  const origLog = console.log;
  console.log = () => {};
  
  const sigintListener = process.listeners('SIGINT').find(f => f.toString().includes('gracefulShutdown'));
  if (sigintListener) sigintListener();
  
  for (let i = 0; i < 20; i++) {
    if (exit0Called) break;
    await new Promise(r => setTimeout(r, 100));
  }
  
  assert.equal(exit0Called, true);
  assert.equal(closed, true);
  
  process.exit = origExit;
  console.log = origLog;
  
});
