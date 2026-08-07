import '../test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('server catch block', async () => {
  const origExit = process.exit;
  const origError = console.error;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; };
  console.error = () => {};
  
  const oldPort = process.env.PORT;
  process.env.PORT = '-1';
  delete process.env.TEST_NO_LISTEN;
  
  await import('../../server.js');
  
  for (let i = 0; i < 20; i++) {
    if (exitCode === 1) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(exitCode, 1);
  
  // Now server is null! Let's trigger gracefulShutdown
  let exit0Called = false;
  process.exit = (code) => { if (code === 0) exit0Called = true; };
  const origLog = console.log;
  console.log = () => {};
  
  const sigtermListener = process.listeners('SIGTERM').find(f => f.toString().includes('gracefulShutdown'));
  if (sigtermListener) sigtermListener();
  
  for (let i = 0; i < 20; i++) {
    if (exit0Called) break;
    await new Promise(r => setTimeout(r, 50));
  }
  
  assert.equal(exit0Called, true);
  
  const handles = process._getActiveHandles();
  for (const h of handles) {
    if (h && typeof h.unref === 'function') try { h.unref(); } catch(e) {}
    if (h && typeof h.close === 'function') try { h.close(); } catch(e) {}
  }
  
  process.exit = origExit;
  console.error = origError;
  console.log = origLog;
  process.env.PORT = oldPort;
  process.env.TEST_NO_LISTEN = 'true';
  setTimeout(() => process.exit(0), 10);
});
