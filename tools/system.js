// ============================================================
//  tools/system.js - System Information & Command Execution
// ============================================================
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = parseInt(process.env.MAX_OUTPUT_SIZE || '1048576');

// Commands that are NEVER allowed, regardless of role
const ABSOLUTE_BLACKLIST = [
  /rm\s+-[rf]+\s+\/(?!\w)/,           // rm -rf /
  /mkfs/,                              // format filesystem
  /dd\s+if=\/dev\/zero\s+of=\/dev/,   // disk wipe
  /:\(\)\s*\{\s*:|:&\s*\};:/,         // fork bomb
  />\s*\/dev\/s[dr][a-z]/,            // overwrite block device
  /shred\s+.*\/dev\//,                // shred block device
  /chmod\s+777\s+\/(?!\w)/,           // chmod 777 /
];

// Extra restrictions for non-admin users
const USER_BLACKLIST = [
  /sudo/,
  /passwd/,
  /useradd/,
  /userdel/,
  /usermod/,
  /visudo/,
  /iptables/,
  /ufw/,
  /systemctl\s+(start|stop|restart|enable|disable|mask)/,
  /service\s+\w+\s+(start|stop|restart)/,
  /reboot/,
  /shutdown/,
  /halt/,
  /poweroff/,
  /init\s+[0-6]/,
  /pkill\s+-9/,
  /kill\s+-9\s+1\b/,                  // kill init
];

function isCommandAllowed(command, role) {
  // Check absolute blacklist
  for (const pattern of ABSOLUTE_BLACKLIST) {
    if (pattern.test(command)) {
      return { allowed: false, reason: `Command matches absolute blacklist: ${pattern}` };
    }
  }

  // Check user blacklist for non-admin roles
  if (role !== 'admin') {
    for (const pattern of USER_BLACKLIST) {
      if (pattern.test(command)) {
        return { allowed: false, reason: `Command not permitted for role '${role}'` };
      }
    }
  }

  return { allowed: true };
}

// ── Tool: run_command ──────────────────────────────────────

export async function runCommand({ command, workingDir, timeout = 30, asUser }, identity) {
  if (!command) throw new Error('command is required');

  if (asUser && !/^[a-z_][a-z0-9_\\-]{0,31}$/.test(asUser)) {
    throw new Error('Invalid username for asUser');
  }

  const check = isCommandAllowed(command, identity.role);
  if (!check.allowed) {
    throw new Error(`Command blocked: ${check.reason}`);
  }

  // Determine working directory
  const cwd = workingDir || (identity.role === 'admin' ? '/' : `/home/${identity.userId}`);

  // Build execution options
  const execOpts = {
    cwd,
    timeout: Math.min(timeout, identity.role === 'admin' ? 300 : 60) * 1000,
    maxBuffer: MAX_OUTPUT,
    shell: '/bin/bash',
    env: {
      PATH: process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: cwd,
      USER: asUser || identity.userId,
      SHELL: '/bin/bash',
      TERM: 'xterm-256color',
      LANG: process.env.LANG || 'en_US.UTF-8',
    },
  };

  // Run as different user if admin requests it
  try {
    let stdout, stderr;
    if (asUser && identity.role === 'admin' && asUser !== 'root') {
      ({ stdout, stderr } = await execFileAsync('su', ['-s', '/bin/bash', asUser, '-c', command], execOpts));
    } else {
      ({ stdout, stderr } = await execFileAsync('/bin/bash', ['-c', command], execOpts));
    }
    return {
      stdout: truncate(stdout),
      stderr: truncate(stderr),
      exitCode: 0,
    };
  } catch (err) {
    return {
      stdout: truncate(err.stdout || ''),
      stderr: truncate(err.stderr || err.message),
      exitCode: err.code || 1,
    };
  }
}

// ── Tool: get_system_info ──────────────────────────────────

export async function getSystemInfo(_, identity) {
  const [uptimeOut, dfOut, freeOut, whoOut, loadOut] = await Promise.allSettled([
    execFileAsync('uptime', ['-p']),
    execFileAsync('df', ['-h', '--output=source,fstype,size,used,avail,pcent,target']),
    execFileAsync('free', ['-h']),
    execFileAsync('who'),
    execFileAsync('cat', ['/proc/loadavg']),
  ]);

  const info = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    kernel: os.release(),
    uptime: uptimeOut.value?.stdout?.trim() || 'N/A',
    cpus: os.cpus().length,
    cpu_model: os.cpus()[0]?.model || 'Unknown',
    load_avg: loadOut.value?.stdout?.trim() || os.loadavg().join(' '),
    total_memory: formatBytes(os.totalmem()),
    free_memory: formatBytes(os.freemem()),
    memory_usage: freeOut.value?.stdout?.trim() || 'N/A',
    disk_usage: dfOut.value?.stdout?.trim() || 'N/A',
    logged_in_users: whoOut.value?.stdout?.trim() || 'N/A',
    network_interfaces: getNetworkInfo(),
    timestamp: new Date().toISOString(),
  };

  return info;
}

// ── Tool: get_processes ────────────────────────────────────

export async function getProcesses({ filter, asUser }, identity) {
  let psArgs;
  if (identity.role === 'admin') {
    psArgs = ['aux', '--sort=-%cpu'];
  } else {
    psArgs = ['-u', identity.userId, '--sort=-%cpu', '-o', 'pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,time,cmd'];
  }

  const { stdout } = await execFileAsync('ps', psArgs);
  let output = stdout.trim();

  if (filter) {
    const lines = output.split('\n');
    const header = lines[0];
    const filtered = lines.slice(1).filter(l => l.toLowerCase().includes(filter.toLowerCase()));
    output = [header, ...filtered].join('\n');
  }

  return { processes: output };
}

// ── Tool: kill_process ─────────────────────────────────────

export async function killProcess({ pid, signal = 'TERM' }, identity) {
  if (!pid) throw new Error('pid is required');

  const validSignals = ['TERM', 'KILL', 'HUP', 'INT', 'USR1', 'USR2'];
  if (!validSignals.includes(signal.toUpperCase())) {
    throw new Error(`Invalid signal. Use one of: ${validSignals.join(', ')}`);
  }

  // Non-admin can only kill their own processes
  if (identity.role !== 'admin') {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'user=']);
    const owner = stdout.trim();
    if (owner !== identity.userId) {
      throw new Error(`Permission denied: process ${pid} belongs to user '${owner}'`);
    }
  }

  const { stdout, stderr } = await execFileAsync('kill', [`-${signal.toUpperCase()}`, String(pid)]);
  return { success: true, message: `Signal ${signal} sent to PID ${pid}` };
}

// ── Helpers ────────────────────────────────────────────────

function truncate(str) {
  if (!str) return '';
  if (str.length > MAX_OUTPUT) {
    return str.slice(0, MAX_OUTPUT) + `\n[... output truncated at ${MAX_OUTPUT} bytes]`;
  }
  return str;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return `${val.toFixed(1)} ${units[i]}`;
}

function getNetworkInfo() {
  const ifaces = os.networkInterfaces();
  return Object.entries(ifaces).reduce((acc, [name, addrs]) => {
    acc[name] = addrs.map(a => `${a.address}/${a.cidr?.split('/')[1] || '?'} (${a.family})`);
    return acc;
  }, {});
}
