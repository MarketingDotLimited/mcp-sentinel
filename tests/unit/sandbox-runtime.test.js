import '../test-env.js';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sandbox-runtime-'));
const runtime = path.join(directory, 'podman');
await fs.writeFile(
  runtime,
  `#!/usr/bin/env node
if (process.argv[2] === 'rm') {
  if (process.env.FAIL_RM === '1') process.exit(1);
  process.exit(0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  if (input === 'TIMEOUT') setInterval(() => {}, 1000);
  else if (input === 'LARGE') process.stdout.write('x'.repeat(1100000));
  else process.stdout.write('executed:' + input);
});
`,
  { mode: 0o755 }
);
process.env.PATH = `${directory}:${process.env.PATH}`;
process.env.SANDBOX_RUNTIME = 'podman';
process.env.SANDBOX_IMAGE_NODE = `registry.example.test/node@sha256:${'a'.repeat(64)}`;
process.env.SANDBOX_IMAGE_PYTHON = `registry.example.test/python@sha256:${'b'.repeat(64)}`;
process.env.SANDBOX_SECCOMP_PROFILE = '/etc/mcp-sentinel/sandbox/seccomp.json';
process.env.SANDBOX_APPARMOR_PROFILE = 'mcp-sentinel-sandbox';
const { runSandboxedCode } = await import(`../../tools/docker.js?test=${Date.now()}`);

after(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('rootless OCI sandbox contract', () => {
  it('runs fixed digest-pinned runtimes with networking denied', async () => {
    const result = await runSandboxedCode({ language: 'node', code: 'hello', files: { 'fixture.txt': 'data' } });
    assert.equal(result.success, true);
    assert.equal(result.stdout, 'executed:hello');
    assert.equal(result.network, 'denied');
    assert.equal(result.truncated, false);
  });

  it('requires both policy enablement and per-call confirmation for network access', async () => {
    await assert.rejects(
      runSandboxedCode({ language: 'python', code: 'print(1)', allowNetwork: true, confirm: true }),
      /SANDBOX_ALLOW_NETWORK/
    );
    process.env.SANDBOX_ALLOW_NETWORK = 'true';
    process.env.SANDBOX_NETWORK = 'mcp-egress';
    await assert.rejects(
      runSandboxedCode({ language: 'python', code: 'print(1)', allowNetwork: true, confirm: false }),
      /requires confirm/
    );
    const result = await runSandboxedCode({
      language: 'python',
      code: 'print(1)',
      allowNetwork: true,
      confirm: true,
    });
    assert.equal(result.network, 'approved-egress');
  });

  it('classifies timeout and output truncation as failures', async () => {
    const timedOut = await runSandboxedCode({ language: 'node', code: 'TIMEOUT', timeout: 1 });
    assert.equal(timedOut.timedOut, true);
    assert.equal(timedOut.success, false);
    const large = await runSandboxedCode({ language: 'node', code: 'LARGE' });
    assert.equal(large.truncated, true);
    assert.equal(large.success, false);
    assert.ok(Buffer.byteLength(large.stdout) <= 1024 * 1024);
  });

  it('rejects unsupported runtimes, unsafe files, and unpinned images before execution', async () => {
    await assert.rejects(runSandboxedCode({ language: 'bash', code: 'id' }), /Unsupported language/);
    await assert.rejects(
      runSandboxedCode({ language: 'node', code: 'x', files: { '../escape': 'x' } }),
      /Invalid filename/
    );
    const image = process.env.SANDBOX_IMAGE_NODE;
    process.env.SANDBOX_IMAGE_NODE = 'registry.example.test/node:latest';
    await assert.rejects(runSandboxedCode({ language: 'node', code: 'x' }), /pinned by sha256/);
    process.env.SANDBOX_IMAGE_NODE = image;
  });

  it('requires SANDBOX_NETWORK when network is allowed', async () => {
    process.env.SANDBOX_ALLOW_NETWORK = 'true';
    delete process.env.SANDBOX_NETWORK;
    await assert.rejects(
      runSandboxedCode({ language: 'node', code: 'x', allowNetwork: true, confirm: true }),
      /SANDBOX_NETWORK must identify/
    );
  });

  it('handles child process spawn errors', async () => {
    const oldPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    await assert.rejects(
      runSandboxedCode({ language: 'node', code: 'x' }),
      /Sandbox runtime failed: spawn podman ENOENT/
    );
    process.env.PATH = oldPath;
  });

  it('rejects invalid SANDBOX_RUNTIME', async () => {
    process.env.SANDBOX_RUNTIME = 'invalid';
    await assert.rejects(runSandboxedCode({ language: 'node', code: 'x' }), /SANDBOX_RUNTIME must be podman or docker/);
  });

  it('rejects docker runtime if not explicitly allowed', async () => {
    process.env.SANDBOX_RUNTIME = 'docker';
    process.env.SANDBOX_ALLOW_DOCKER = 'false';
    await assert.rejects(runSandboxedCode({ language: 'node', code: 'x' }), /Docker sandbox runtime is disabled/);
    process.env.SANDBOX_RUNTIME = 'podman'; // restore
  });

  it('rejects invalid files object', async () => {
    await assert.rejects(runSandboxedCode({ language: 'node', code: 'x', files: null }), /files must be an object/);
  });

  it('validates code properly', async () => {
    await assert.rejects(runSandboxedCode({ language: 'node', code: '' }), /code is required/);
    await assert.rejects(runSandboxedCode({ language: 'node', code: null }), /code is required/);
    await assert.rejects(runSandboxedCode({ language: 'node', code: 'a'.repeat(256 * 1024 + 1) }), /limit/);
  });

  it('validates files content properly', async () => {
    await assert.rejects(runSandboxedCode({ language: 'node', code: 'x', files: { 'a.txt': 123 } }), /string content/);
    await assert.rejects(
      runSandboxedCode({ language: 'node', code: 'x', files: { 'a.txt': 'a'.repeat(1024 * 1024 + 1) } }),
      /byte limit/
    );
    const manyFiles = {};
    for (let i = 0; i < 51; i++) manyFiles[`f${i}.txt`] = 'x';
    await assert.rejects(runSandboxedCode({ language: 'node', code: 'x', files: manyFiles }), /at most/);
  });

  it('handles custom timeout bounds', async () => {
    const res1 = await runSandboxedCode({ language: 'node', code: 'x', timeout: 0 }); // hits min 1
    const res2 = await runSandboxedCode({ language: 'node', code: 'x', timeout: 1000 }); // hits max 120
    assert.equal(res1.success, true);
    assert.equal(res2.success, true);
  });

  it('ignores rm failure on terminate', async () => {
    process.env.FAIL_RM = '1';
    const timedOut = await runSandboxedCode({ language: 'node', code: 'TIMEOUT', timeout: 1 });
    assert.equal(timedOut.timedOut, true);
    delete process.env.FAIL_RM;
  });

  it('handles missing SANDBOX_RUNTIME', async () => {
    delete process.env.SANDBOX_RUNTIME;
    const res = await runSandboxedCode({ language: 'node', code: 'x' });
    assert.equal(res.success, true);
    process.env.SANDBOX_RUNTIME = 'podman';
  });
});
