import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

const PRIVILEGED_EXECUTABLES = new Set([
  'systemctl',
  'journalctl',
  'ufw',
  'useradd',
  'userdel',
  'usermod',
  'chpasswd',
  'chown',
  'chmod',
  'kill',
  'runuser',
  'sudo',
  'su',
  'docker',
  'podman',
]);

/**
 * Execute a fixed, unprivileged command as the Sentinel service account.
 * Privilege changes are never performed here; typed operations must use the broker.
 */
export async function secureExec(cmd, identity, opts = {}) {
  if (!Array.isArray(cmd) || !cmd.length || !cmd.every(value => typeof value === 'string'))
    throw new Error('Command must be a non-empty string array');
  const executable = cmd[0].split('/').pop();
  if (PRIVILEGED_EXECUTABLES.has(executable))
    throw new Error(`Privileged executable '${executable}' is available only through the typed broker`);
  const wallTime = parseInt(process.env.TOOL_MAX_WALL_TIME || '60', 10);
  const maxBuf = parseInt(process.env.TOOL_MAX_OUTPUT || '5242880', 10);
  const options = { timeout: wallTime * 1000, maxBuffer: maxBuf, ...opts };
  try {
    return await execFileAsync(cmd[0], cmd.slice(1), options);
  } catch (err) {
    if (err.killed || err.code === 'ABORT_ERR' || err.signal === 'SIGKILL' || err.signal === 'SIGTERM') {
      const error = new Error('Process terminated by timeout or cancellation');
      error.code = err.code === 'ABORT_ERR' ? 'CANCELLED' : 'TIMEOUT';
      error.signal = err.signal;
      throw error;
    }
    throw err;
  }
}
