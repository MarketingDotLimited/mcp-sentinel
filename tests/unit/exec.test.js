import "../test-env.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { secureExec } from "../../lib/exec.js";

test('secureExec validation', async () => {
  // Test invalid commands
  await assert.rejects(secureExec('not array', 'identity'), /Command must be a non-empty string array/);
  await assert.rejects(secureExec([], 'identity'), /Command must be a non-empty string array/);
  await assert.rejects(secureExec([1, 2], 'identity'), /Command must be a non-empty string array/);

  // Test privileged executables
  await assert.rejects(
    secureExec(['sudo', 'id'], 'identity'),
    /Privileged executable 'sudo' is available only through the typed broker/
  );
  await assert.rejects(
    secureExec(['/usr/bin/docker', 'run'], 'identity'),
    /Privileged executable 'docker' is available only through the typed broker/
  );
});

test('secureExec success', async () => {
  const result = await secureExec(['echo', 'hello'], 'identity');
  assert.equal(result.stdout, 'hello\n');
});

test('secureExec regular error', async () => {
  await assert.rejects(secureExec(['false'], 'identity'), err => {
    assert.notEqual(err.message, 'Process terminated by timeout or cancellation');
    assert.equal(err.code, 1);
    return true;
  });

  await assert.rejects(secureExec(['nonexistent-command-999'], 'identity'), err => {
    assert.notEqual(err.message, 'Process terminated by timeout or cancellation');
    assert.equal(err.code, 'ENOENT');
    return true;
  });
});

test('secureExec timeout (err.killed)', async () => {
  await assert.rejects(secureExec(['sleep', '10'], 'identity', { timeout: 1 }), err => {
    assert.equal(err.message, 'Process terminated by timeout or cancellation');
    assert.equal(err.code, 'TIMEOUT');
    assert.equal(err.signal, 'SIGTERM');
    return true;
  });
});

test('secureExec cancellation (ABORT_ERR)', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(secureExec(['sleep', '10'], 'identity', { signal: ac.signal }), err => {
    assert.equal(err.message, 'Process terminated by timeout or cancellation');
    assert.equal(err.code, 'CANCELLED');
    return true;
  });
});

test('secureExec self-inflicted SIGKILL', async () => {
  await assert.rejects(secureExec(['sh', '-c', 'kill -9 $$'], 'identity'), err => {
    assert.equal(err.message, 'Process terminated by timeout or cancellation');
    assert.equal(err.code, 'TIMEOUT');
    assert.equal(err.signal, 'SIGKILL');
    return true;
  });
});

test('secureExec self-inflicted SIGTERM', async () => {
  await assert.rejects(secureExec(['sh', '-c', 'kill -15 $$'], 'identity'), err => {
    assert.equal(err.message, 'Process terminated by timeout or cancellation');
    assert.equal(err.code, 'TIMEOUT');
    assert.equal(err.signal, 'SIGTERM');
    return true;
  });
});
