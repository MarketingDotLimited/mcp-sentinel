import '../test-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('server edge cases catch', async () => {
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; };
  console.log = () => {};
  
  await import('../../server.js');
  
  let exit0Called = false;
  process.exit = (code) => { if (code === 0) exit0Called = true; };
  
  const auditPath = path.join(process.cwd(), 'audit.js');
  fs.renameSync(auditPath, auditPath + '.bak');
  
  const sigtermListener = process.listeners('SIGTERM').find(f => f.toString().includes('gracefulShutdown'));
  if (sigtermListener) sigtermListener();
  
  for (let i = 0; i < 20; i++) {
    if (exit0Called) break;
    await new Promise(r => setTimeout(r, 100));
  }
  
  fs.renameSync(auditPath + '.bak', auditPath);
  
  assert.equal(exit0Called, true);
  process.exit = origExit;
  setTimeout(() => process.exit(0), 10);
});
