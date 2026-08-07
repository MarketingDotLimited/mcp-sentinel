import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import events from 'node:events';

const execFileMock = mock.fn((cmd, args, opts, cb) => cb(null, '', ''));
const spawnMock = mock.fn();
mock.module('child_process', {
  namedExports: {
    execFile: execFileMock,
    spawn: spawnMock
  }
});

const fsMock = {
  mkdtemp: mock.fn(async () => '/tmp/mock-dir'),
  chmod: mock.fn(async () => {}),
  writeFile: mock.fn(async () => {}),
  rm: mock.fn(async () => {})
};
mock.module('fs/promises', { namedExports: fsMock, defaultExport: fsMock });

const docker = await import('../tools/docker.js');

test('docker tools', async (t) => {
  let originalEnv;

  t.beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.SANDBOX_RUNTIME = 'podman';
    process.env.SANDBOX_IMAGE_PYTHON = 'python@sha256:1111111111111111111111111111111111111111111111111111111111111111';
    process.env.SANDBOX_IMAGE_NODE = 'node@sha256:2222222222222222222222222222222222222222222222222222222222222222';
    
    execFileMock.mock.resetCalls();
    spawnMock.mock.resetCalls();
    fsMock.mkdtemp.mock.resetCalls();
    fsMock.chmod.mock.resetCalls();
    fsMock.writeFile.mock.resetCalls();
    fsMock.rm.mock.resetCalls();
  });

  t.afterEach(() => {
    process.env = originalEnv;
  });

  const setupSpawnMock = ({ exitCode = 0, stdoutStr = 'output', stderrStr = '', delay = 10 } = {}) => {
    spawnMock.mock.mockImplementation(() => {
      const child = new events.EventEmitter();
      child.stdout = new events.EventEmitter();
      child.stderr = new events.EventEmitter();
      child.stdin = {
        on: () => {},
        end: () => {}
      };
      child.kill = mock.fn();
      
      setTimeout(() => {
        if (stdoutStr) child.stdout.emit('data', Buffer.from(stdoutStr));
        if (stderrStr) child.stderr.emit('data', Buffer.from(stderrStr));
      }, delay / 2);

      setTimeout(() => {
        child.emit('close', exitCode, null);
      }, delay);
      
      return child;
    });
  };

  await t.test('runSandboxedCode throws on unsupported language', async () => {
    await assert.rejects(
      docker.runSandboxedCode({ language: 'go', code: 'print("hi")' }),
      /Unsupported language: go/
    );
  });

  await t.test('runSandboxedCode throws on missing/empty code', async () => {
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: '' }),
      /code is required/
    );
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: null }),
      /code is required/
    );
  });

  await t.test('runSandboxedCode throws if code exceeds limit', async () => {
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'a'.repeat(256 * 1024 + 1) }),
      /code exceeds the 262144-byte limit/
    );
  });

  await t.test('runSandboxedCode throws on invalid files object', async () => {
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', files: [] }),
      /files must be an object/
    );
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', files: null }),
      /files must be an object/
    );
  });

  await t.test('runSandboxedCode throws on too many files', async () => {
    const files = {};
    for (let i = 0; i < 51; i++) files[`file${i}.txt`] = 'content';
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', files }),
      /files may contain at most 50 entries/
    );
  });

  await t.test('runSandboxedCode throws on invalid filename', async () => {
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', files: { '../file.txt': 'content' } }),
      /Invalid filename: ..\/file.txt/
    );
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', files: { '!invalid': 'content' } }),
      /Invalid filename: !invalid/
    );
  });

  await t.test('runSandboxedCode throws on invalid file content', async () => {
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', files: { 'file.txt': 123 } }),
      /File 'file.txt' must have string content/
    );
  });

  await t.test('runSandboxedCode throws on excessive file size', async () => {
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', files: { 'file.txt': 'a'.repeat(1024 * 1024 + 1) } }),
      /files exceed the 1048576-byte limit/
    );
  });

  await t.test('runSandboxedCode throws on network requested but unconfirmed/disabled', async () => {
    process.env.SANDBOX_ALLOW_NETWORK = 'false';
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', allowNetwork: true }),
      /Network access requires confirm=true and SANDBOX_ALLOW_NETWORK=true/
    );
    process.env.SANDBOX_ALLOW_NETWORK = 'true';
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', allowNetwork: true, confirm: false }),
      /Network access requires confirm=true and SANDBOX_ALLOW_NETWORK=true/
    );
  });

  await t.test('runSandboxedCode throws on invalid runtime configuration', async () => {
    process.env.SANDBOX_RUNTIME = 'invalid';
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")' }),
      /SANDBOX_RUNTIME must be podman or docker/
    );
    
    process.env.SANDBOX_RUNTIME = 'docker';
    process.env.SANDBOX_ALLOW_DOCKER = 'false';
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")' }),
      /Docker sandbox runtime is disabled/
    );
  });

  await t.test('runSandboxedCode throws on missing pinned image', async () => {
    delete process.env.SANDBOX_IMAGE_PYTHON;
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")' }),
      /SANDBOX_IMAGE_PYTHON must name an image pinned by sha256 digest/
    );
    
    process.env.SANDBOX_IMAGE_PYTHON = 'invalid-image';
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")' }),
      /SANDBOX_IMAGE_PYTHON must name an image pinned by sha256 digest/
    );
  });

  await t.test('runSandboxedCode throws when allowNetwork is true but no network configured', async () => {
    process.env.SANDBOX_ALLOW_NETWORK = 'true';
    delete process.env.SANDBOX_NETWORK;
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")', allowNetwork: true, confirm: true }),
      /SANDBOX_NETWORK must identify a preconfigured egress-filtered network/
    );
  });

  await t.test('runSandboxedCode successful execution', async () => {
    setupSpawnMock({ stdoutStr: 'hello world' });
    const result = await docker.runSandboxedCode({ language: 'python', code: 'print("hello world")' });
    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'hello world');
    assert.equal(result.network, 'denied');
  });

  await t.test('runSandboxedCode successful execution with network and files', async () => {
    process.env.SANDBOX_ALLOW_NETWORK = 'true';
    process.env.SANDBOX_NETWORK = 'my-net';
    setupSpawnMock({ stdoutStr: 'hello world' });
    
    const result = await docker.runSandboxedCode({ 
      language: 'node', 
      code: 'console.log("hello world")', 
      allowNetwork: true, 
      confirm: true,
      files: { 'test.js': 'content' }
    });
    
    assert.equal(result.success, true);
    assert.equal(result.network, 'approved-egress');
    assert.equal(fsMock.mkdtemp.mock.calls.length, 1);
    assert.equal(fsMock.writeFile.mock.calls.length, 1);
    assert.equal(fsMock.rm.mock.calls.length, 1);
  });

  await t.test('runSandboxedCode handles execution failure (exit code)', async () => {
    setupSpawnMock({ exitCode: 1, stderrStr: 'error message' });
    const result = await docker.runSandboxedCode({ language: 'python', code: 'error' });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, 'error message');
  });

  await t.test('runSandboxedCode handles timeout', async () => {
    spawnMock.mock.mockImplementation(() => {
      const child = new events.EventEmitter();
      child.stdout = new events.EventEmitter();
      child.stderr = new events.EventEmitter();
      child.stdin = { on: () => {}, end: () => {} };
      child.kill = mock.fn();
      
      setTimeout(() => child.emit('close', null, 'SIGKILL'), 2000);
      return child;
    });
    
    // Pass a very small timeout for the test to be fast
    const result = await docker.runSandboxedCode({ language: 'python', code: 'while True: pass', timeout: 1 });
    assert.equal(result.success, false);
    assert.equal(result.timedOut, true);
  });

  await t.test('runSandboxedCode handles output truncation', async () => {
    spawnMock.mock.mockImplementation(() => {
      const child = new events.EventEmitter();
      child.stdout = new events.EventEmitter();
      child.stderr = new events.EventEmitter();
      child.stdin = { on: () => {}, end: () => {} };
      child.kill = mock.fn();
      
      setTimeout(() => {
        child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 10, 'a'));
      }, 5);
      
      setTimeout(() => child.emit('close', 0, null), 15);
      return child;
    });
    
    const result = await docker.runSandboxedCode({ language: 'python', code: 'print("a" * 2000000)' });
    assert.equal(result.success, false);
    assert.equal(result.truncated, true);
  });
  
  await t.test('runSandboxedCode includes security opts if defined', async () => {
    process.env.SANDBOX_SECCOMP_PROFILE = 'seccomp.json';
    process.env.SANDBOX_APPARMOR_PROFILE = 'apparmor_prof';
    setupSpawnMock();
    await docker.runSandboxedCode({ language: 'python', code: 'print("hi")' });
    
    assert.equal(spawnMock.mock.calls.length, 1);
    const args = spawnMock.mock.calls[0].arguments[1];
    assert(args.includes('seccomp=seccomp.json'));
    assert(args.includes('apparmor=apparmor_prof'));
  });

  await t.test('runSandboxedCode catches runtime startup error', async () => {
    spawnMock.mock.mockImplementation(() => {
      const child = new events.EventEmitter();
      child.stdout = new events.EventEmitter();
      child.stderr = new events.EventEmitter();
      child.stdin = { on: () => {}, end: () => {} };
      
      setTimeout(() => child.emit('error', new Error('spawn failed')), 5);
      return child;
    });
    
    await assert.rejects(
      docker.runSandboxedCode({ language: 'python', code: 'print("hi")' }),
      /Sandbox runtime failed: spawn failed/
    );
  });
});
