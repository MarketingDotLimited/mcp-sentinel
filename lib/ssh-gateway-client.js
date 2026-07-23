import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertRemoteBrokerOperation } from './remote-operation-policy.js';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const masterConnections = new Map();

function connectionFingerprint(connection) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        connection.id,
        connection.host,
        connection.port,
        connection.username,
        connection.credentialId,
        connection.hostKey,
        connection.policyVersion || 0,
      ])
    )
    .digest('hex')
    .slice(0, 20);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error('Invalid SSH connection limit');
  return parsed;
}

function validateHost(value) {
  if (
    typeof value !== 'string' ||
    value.length > 253 ||
    (!net.isIP(value) &&
      !/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(
        value
      ))
  )
    throw new Error('Invalid SSH host');
  return value;
}

export function validateSshConnection(connection) {
  if (!connection || typeof connection !== 'object' || Array.isArray(connection))
    throw new Error('Registered SSH connection is required');
  if (typeof connection.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(connection.id))
    throw new Error('SSH connection ID must be a UUID');
  const host = validateHost(connection.host);
  const port = boundedInteger(connection.port, 22, 1, 65535);
  const username = String(connection.username || '');
  if (!/^[a-z_][a-z0-9_.-]{0,31}$/i.test(username) || username === 'root')
    throw new Error('SSH gateway user must be a non-root Unix account');
  const credentialId = String(connection.credentialId || '');
  if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(credentialId)) throw new Error('Invalid SSH credential ID');
  const hostKey = String(connection.hostKey || '').trim();
  if (!/^(?:ssh-ed25519|ecdsa-sha2-nistp256|rsa-sha2-512) [A-Za-z0-9+/]+={0,2}$/.test(hostKey))
    throw new Error('A pinned SSH host public key is required');
  return {
    ...connection,
    host,
    port,
    username,
    credentialId,
    hostKey,
    connectTimeoutSeconds: boundedInteger(connection.connectTimeoutSeconds, 10, 2, 60),
  };
}

function killTree(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export function runSshProcess(
  args,
  { input = '', timeoutMs = 30_000, signal, maxOutputBytes = MAX_RESPONSE_BYTES } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/ssh', args, {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      killTree(child);
      finish(Object.assign(new Error('SSH gateway request cancelled'), { name: 'AbortError' }));
    };
    const collect = target => chunk => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        killTree(child);
        finish(new Error('SSH gateway response exceeded the output limit'));
      } else target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', error => finish(new Error(`SSH client failed: ${error.message}`)));
    child.once('close', (exitCode, childSignal) =>
      finish(null, {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        signal: childSignal,
      })
    );
    const timer = setTimeout(() => {
      killTree(child);
      finish(Object.assign(new Error('SSH gateway request timed out'), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    timer.unref?.();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    child.stdin.end(input);
  });
}

async function regularProtectedFile(file, description) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error(`${description} must be a private regular file`);
  return file;
}

async function connectionFiles(connection) {
  const runtimeRoot = path.resolve(process.env.MCP_SSH_RUNTIME_DIR || '/run/mcp-sentinel/ssh');
  const credentialRoot = path.resolve(
    process.env.MCP_SSH_CREDENTIAL_DIR || process.env.CREDENTIALS_DIRECTORY || '/etc/mcp-sentinel/credentials'
  );
  await fs.mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(runtimeRoot, 0o700);
  const keyFile = path.join(credentialRoot, `ssh-${connection.credentialId}`);
  await regularProtectedFile(keyFile, 'SSH private key credential');
  const fingerprint = connectionFingerprint(connection);
  const knownHosts = path.join(runtimeRoot, `known-hosts-${connection.id}-${fingerprint}`);
  const hostLabel = connection.port === 22 ? connection.host : `[${connection.host}]:${connection.port}`;
  const expected = `${hostLabel} ${connection.hostKey}\n`;
  let current = null;
  try {
    current = await fs.readFile(knownHosts, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current !== expected) {
    const temporary = `${knownHosts}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, expected, { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, knownHosts);
  }
  await regularProtectedFile(knownHosts, 'Pinned known-hosts file');
  return {
    keyFile,
    knownHosts,
    controlPath: path.join(runtimeRoot, `control-${connection.id}-${fingerprint}`),
  };
}

function baseArguments(connection, files) {
  return [
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    `UserKnownHostsFile=${files.knownHosts}`,
    '-o',
    'GlobalKnownHostsFile=/dev/null',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    `ConnectTimeout=${connection.connectTimeoutSeconds}`,
    '-o',
    'ServerAliveInterval=15',
    '-o',
    'ServerAliveCountMax=2',
    '-o',
    'ControlMaster=auto',
    '-o',
    'ControlPersist=60',
    '-o',
    `ControlPath=${files.controlPath}`,
    '-o',
    'ClearAllForwardings=yes',
    '-o',
    'ForwardAgent=no',
    '-o',
    'PermitLocalCommand=no',
    '-o',
    'RequestTTY=no',
    '-o',
    'LogLevel=ERROR',
    '-p',
    String(connection.port),
    '-i',
    files.keyFile,
  ];
}

async function ensureMaster(connection, files, runner) {
  const cacheKey = connectionFingerprint(connection);
  if (masterConnections.has(cacheKey)) return masterConnections.get(cacheKey);
  const attempt = (async () => {
    const destination = `${connection.username}@${connection.host}`;
    const base = baseArguments(connection, files);
    const check = await runner([...base, '-O', 'check', '--', destination], { timeoutMs: 5000 }).catch(() => ({
      exitCode: 255,
    }));
    if (check.exitCode === 0) return;
    const started = await runner([...base, '-MNf', '--', destination], {
      timeoutMs: (connection.connectTimeoutSeconds + 5) * 1000,
    });
    if (started.exitCode !== 0)
      throw new Error(`SSH connection failed: ${started.stderr.trim() || 'authentication failed'}`);
  })();
  masterConnections.set(cacheKey, attempt);
  try {
    await attempt;
  } catch (error) {
    masterConnections.delete(cacheKey);
    throw error;
  }
}

export async function sshGatewayCall(connectionInput, operation, parameters = {}, options = {}) {
  const connection = validateSshConnection(connectionInput);
  assertRemoteBrokerOperation(operation);
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))
    throw new Error('SSH gateway parameters must be an object');
  const requestId = crypto.randomUUID();
  const request = `${JSON.stringify({ requestId, operation, parameters })}\n`;
  if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) throw new Error('SSH gateway request is too large');
  const files = await connectionFiles(connection);
  const runner = options.runner || runSshProcess;
  await ensureMaster(connection, files, runner);
  const destination = `${connection.username}@${connection.host}`;
  const response = await runner([...baseArguments(connection, files), '-T', '--', destination], {
    input: request,
    timeoutMs: options.timeoutMs || 30_000,
    signal: options.signal,
    maxOutputBytes: MAX_RESPONSE_BYTES,
  });
  let parsed;
  try {
    parsed = JSON.parse(response.stdout.trim());
  } catch {
    if (response.exitCode !== 0)
      throw new Error(`SSH node gateway failed: ${response.stderr.trim() || `exit ${response.exitCode}`}`);
    throw new Error('SSH node gateway returned an invalid response');
  }
  if (parsed.requestId !== requestId) throw new Error('SSH node gateway response ID mismatch');
  if (parsed.ok !== true) throw new Error(parsed.error || 'SSH node gateway rejected the request');
  return parsed.result;
}

export function clearSshConnectionCache() {
  masterConnections.clear();
}
