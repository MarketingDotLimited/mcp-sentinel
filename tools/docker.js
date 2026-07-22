import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MAX_CODE_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 50;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9._/-]*(?::[a-zA-Z0-9._-]+)?@sha256:[a-f0-9]{64}$/;

const LANGUAGE_CONFIG = Object.freeze({
  python: { imageEnv: 'SANDBOX_IMAGE_PYTHON', command: ['python3', '-'] },
  node: { imageEnv: 'SANDBOX_IMAGE_NODE', command: ['node', '-'] },
});

function getRuntime() {
  const runtime = process.env.SANDBOX_RUNTIME || 'podman';
  if (!['podman', 'docker'].includes(runtime)) {
    throw new Error('SANDBOX_RUNTIME must be podman or docker');
  }
  if (runtime === 'docker' && process.env.SANDBOX_ALLOW_DOCKER !== 'true') {
    throw new Error('Docker sandbox runtime is disabled; use rootless Podman');
  }
  return runtime;
}

function getPinnedImage(language) {
  const config = LANGUAGE_CONFIG[language];
  if (!config) {
    throw new Error(`Unsupported language: ${language}. Allowed: ${Object.keys(LANGUAGE_CONFIG).join(', ')}`);
  }
  const image = process.env[config.imageEnv];
  if (!image || !DIGEST_IMAGE.test(image)) {
    throw new Error(`${config.imageEnv} must name an image pinned by sha256 digest`);
  }
  return { ...config, image };
}

function validateFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('files must be an object mapping filenames to string contents');
  }
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) throw new Error(`files may contain at most ${MAX_FILES} entries`);

  let totalBytes = 0;
  for (const [filename, content] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(filename) || path.basename(filename) !== filename) {
      throw new Error(`Invalid filename: ${filename}`);
    }
    if (typeof content !== 'string') throw new Error(`File '${filename}' must have string content`);
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > MAX_FILE_BYTES) throw new Error(`files exceed the ${MAX_FILE_BYTES}-byte limit`);
  }
  return entries;
}

function buildRuntimeArgs({ runtime, image, command, name, tempDir, allowNetwork }) {
  const network = allowNetwork ? process.env.SANDBOX_NETWORK : 'none';
  if (allowNetwork && !network) {
    throw new Error('SANDBOX_NETWORK must identify a preconfigured egress-filtered network');
  }

  const args = [
    'run',
    '--rm',
    '--name',
    name,
    '--interactive',
    '--memory',
    '256m',
    '--memory-swap',
    '256m',
    '--cpus',
    '0.5',
    '--pids-limit',
    '64',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--network',
    network,
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=64m',
  ];

  const seccomp = process.env.SANDBOX_SECCOMP_PROFILE;
  const apparmor = process.env.SANDBOX_APPARMOR_PROFILE;
  if (seccomp) args.push('--security-opt', `seccomp=${seccomp}`);
  if (apparmor) args.push('--security-opt', `apparmor=${apparmor}`);
  if (runtime === 'podman') args.push('--userns', 'keep-id');

  if (tempDir) {
    args.push('--volume', `${tempDir}:/workspace:ro`);
  } else {
    args.push('--tmpfs', '/workspace:rw,noexec,nosuid,nodev,size=64m');
  }
  args.push('--workdir', '/workspace', image, ...command);
  return args;
}

async function forceRemove(runtime, name) {
  try {
    await execFileAsync(runtime, ['rm', '--force', name], { timeout: 5000, maxBuffer: 64 * 1024 });
  } catch {
    // The container may already have exited and removed itself.
  }
}

export async function runSandboxedCode({
  language,
  code,
  allowNetwork = false,
  confirm = false,
  timeout = 30,
  files = {},
}) {
  if (!LANGUAGE_CONFIG[language]) {
    throw new Error(`Unsupported language: ${language}. Allowed: ${Object.keys(LANGUAGE_CONFIG).join(', ')}`);
  }
  if (typeof code !== 'string' || code.length === 0) throw new Error('code is required');
  if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw new Error(`code exceeds the ${MAX_CODE_BYTES}-byte limit`);
  const entries = validateFiles(files);
  if (allowNetwork && (!confirm || process.env.SANDBOX_ALLOW_NETWORK !== 'true')) {
    throw new Error('Network access requires confirm=true and SANDBOX_ALLOW_NETWORK=true');
  }

  const { image, command } = getPinnedImage(language);
  const validTimeout = Math.min(Math.max(Number.parseInt(timeout, 10) || 30, 1), 120);
  const runtime = getRuntime();
  const name = `mcp-sandbox-${crypto.randomUUID()}`;
  const startedAt = Date.now();
  let tempDir;

  try {
    if (entries.length) {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-sandbox-'));
      await fs.chmod(tempDir, 0o700);
      for (const [filename, content] of entries) {
        await fs.writeFile(path.join(tempDir, filename), content, { mode: 0o400, flag: 'wx' });
      }
    }

    const args = buildRuntimeArgs({ runtime, image, command, name, tempDir, allowNetwork });
    return await new Promise((resolve, reject) => {
      const child = spawn(runtime, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
      const stdout = [];
      const stderr = [];
      let outputBytes = 0;
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const terminate = () => {
        child.kill('SIGKILL');
        void forceRemove(runtime, name);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, validTimeout * 1000);

      const capture = target => chunk => {
        const remaining = MAX_OUTPUT_BYTES - outputBytes;
        if (remaining <= 0) {
          truncated = true;
          terminate();
          return;
        }
        const kept = chunk.subarray(0, remaining);
        target.push(kept);
        outputBytes += kept.length;
        if (kept.length < chunk.length) {
          truncated = true;
          terminate();
        }
      };

      child.stdout.on('data', capture(stdout));
      child.stderr.on('data', capture(stderr));
      child.once('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Sandbox runtime failed: ${error.message}`));
      });
      child.once('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          success: exitCode === 0 && !timedOut && !truncated,
          exitCode,
          signal,
          durationMs: Date.now() - startedAt,
          network: allowNetwork ? 'approved-egress' : 'denied',
          timedOut,
          truncated,
          stdout: Buffer.concat(stdout).toString('utf8').trim(),
          stderr: Buffer.concat(stderr).toString('utf8').trim(),
        });
      });

      child.stdin.on('error', () => {});
      child.stdin.end(code);
    });
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  }
}
