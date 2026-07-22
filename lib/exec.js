import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

/**
 * Execute a command with proper privilege separation and cgroups limits.
 * - Admin: runs directly as root (with cgroup limits)
 * - User: wrapped in `runuser -u <userId> --` (with cgroup limits)
 * @param {string[]} cmd - Command and arguments array
 * @param {object} identity - { userId, role }
 * @param {object} opts - execFile options (timeout, maxBuffer, etc.)
 */
export async function secureExec(cmd, identity, opts = {}) {
  const mem = process.env.TOOL_MAX_MEMORY || '512M';
  const cpu = process.env.TOOL_MAX_CPU_QUOTA || '50%';
  const wallTime = parseInt(process.env.TOOL_MAX_WALL_TIME || '60', 10);
  const maxBuf = parseInt(process.env.TOOL_MAX_OUTPUT || '5242880', 10);

  const options = { timeout: wallTime * 1000, maxBuffer: maxBuf, ...opts };

  if (identity.role === 'admin') {
    // Admin: apply resource limits but no privilege drop
    try {
      return await execFileAsync(
        'systemd-run',
        ['--scope', '--quiet', '-p', `MemoryMax=${mem}`, '-p', `CPUQuota=${cpu}`, ...cmd],
        options
      );
    } catch (err) {
      if (err.code === 137 || err.code === 143 || err.signal === 'SIGKILL' || err.signal === 'SIGTERM') {
        const error = new Error('Process killed: memory limit or timeout exceeded');
        error.code = 'OOM_KILLED';
        throw error;
      }
      throw err;
    }
  }

  // Validate userId exists as a real Unix account
  await execFileAsync('id', [identity.userId]);

  // User: resource limits + privilege drop
  try {
    return await execFileAsync(
      'systemd-run',
      [
        '--scope',
        '--quiet',
        '-p',
        `MemoryMax=${mem}`,
        '-p',
        `CPUQuota=${cpu}`,
        'runuser',
        '-u',
        identity.userId,
        '--',
        ...cmd,
      ],
      options
    );
  } catch (err) {
    if (err.code === 137 || err.code === 143 || err.signal === 'SIGKILL' || err.signal === 'SIGTERM') {
      const error = new Error('Process killed: memory limit or timeout exceeded');
      error.code = 'OOM_KILLED';
      throw error;
    }
    throw err;
  }
}
