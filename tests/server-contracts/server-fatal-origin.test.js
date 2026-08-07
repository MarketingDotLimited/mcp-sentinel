import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('validateConfig fatal origins', async () => {
  process.env.AUDIT_HMAC_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.AUDIT_CHECKPOINT_FILE = '/tmp/test-checkpoint.json';
  process.env.AUDIT_LOG_FILE = '/tmp/test-audit.log';
  try { fs.unlinkSync('/tmp/test-checkpoint.json'); } catch(e) { void e; }
  try { fs.unlinkSync('/tmp/test-audit.log'); } catch(e) { void e; }
  
  await import('../test-env.js');

  const origExit = process.exit;
  const origError = console.error;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; };
  console.error = () => {};
  
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGINS = '  ';
  
  await import('../../server.js');
  
  assert.equal(exitCode, 1);
  
  process.exit = origExit;
  console.error = origError;
  process.env.NODE_ENV = 'test';
  delete process.env.AUDIT_HMAC_KEY;
  
});
