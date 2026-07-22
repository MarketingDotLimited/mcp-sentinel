// ============================================================
//  tools/system.js - System Information & Command Execution
// ============================================================
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = parseInt(process.env.MAX_OUTPUT_SIZE || '1048576');

// ── Tool: get_system_info ──────────────────────────────────

export async function getSystemInfo(_, identity) {
  const isAd = identity.role === 'admin';
  const tasks = [
    execFileAsync('uptime', ['-p']),
    execFileAsync('free', ['-h']),
    execFileAsync('cat', ['/proc/loadavg']),
  ];
  if (isAd) {
    tasks.push(execFileAsync('df', ['-h', '--output=source,fstype,size,used,avail,pcent,target']));
    tasks.push(execFileAsync('who'));
  }

  const results = await Promise.allSettled(tasks);
  
  const uptimeOut = results[0];
  const freeOut = results[1];
  const loadOut = results[2];
  const dfOut = isAd ? results[3] : {};
  const whoOut = isAd ? results[4] : {};

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
  };

  if (isAd) {
    info.disk_usage = dfOut.value?.stdout?.trim() || 'N/A';
    info.logged_in_users = whoOut.value?.stdout?.trim() || 'N/A';
    info.network_interfaces = getNetworkInfo();
  } else {
    info.disk_usage = 'Access Denied';
    info.logged_in_users = 'Access Denied';
    info.network_interfaces = 'Access Denied';
  }

  return info;
}

// ── Tool: get_processes ────────────────────────────────────

export async function getProcesses({ filter, asUser }, identity) {
  let psArgs;
  if (identity.role === 'admin') {
    if (asUser) {
      psArgs = ['-u', asUser, '--sort=-%cpu', '-o', 'pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,time,cmd'];
    } else {
      psArgs = ['aux', '--sort=-%cpu'];
    }
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
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'uid=']);
    const ownerUid = stdout.trim();
    const { stdout: idOut } = await execFileAsync('id', ['-u', identity.userId]);
    const callerUid = idOut.trim();

    if (ownerUid !== callerUid) {
      throw new Error(`Permission denied: process ${pid} does not belong to your UID`);
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
