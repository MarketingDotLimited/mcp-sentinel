// ============================================================
//  tools/services.js - systemd Service Management (Admin Only)
// ============================================================
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function requireAdmin(identity) {
  if (identity.role !== 'admin') {
    throw new Error('Service management requires admin role');
  }
}

function validateServiceName(name) {
  // Only allow safe service name characters
  if (!/^[a-zA-Z0-9_\-\.\@]+$/.test(name)) {
    throw new Error(`Invalid service name: '${name}'`);
  }
  if (name.startsWith('-')) throw new Error('Service name cannot start with -');
  // Prevent directory traversal
  if (name.includes('..') || name.includes('/')) {
    throw new Error('Invalid service name');
  }
}

// ── Tool: manage_service ───────────────────────────────────

export async function manageService({ service, action }, identity) {
  requireAdmin(identity);
  if (!service || !action) throw new Error('service and action are required');
  validateServiceName(service);

  const allowedActions = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'status', 'is-active'];
  if (!allowedActions.includes(action)) {
    throw new Error(`Invalid action. Use one of: ${allowedActions.join(', ')}`);
  }

  const { stdout, stderr } = await execFileAsync(
    'systemctl',
    [action, '--', service],
    { timeout: 30000 }
  );

  return {
    service,
    action,
    output: stdout.trim() || stderr?.trim() || 'Command executed',
  };
}

// ── Tool: get_service_status ───────────────────────────────

export async function getServiceStatus({ service }, identity) {
  requireAdmin(identity);
  if (!service) throw new Error('service is required');
  validateServiceName(service);

  const [statusOut, activeOut, enabledOut, logsOut] = await Promise.allSettled([
    execFileAsync('systemctl', ['status', service, '--no-pager', '-l']),
    execFileAsync('systemctl', ['is-active', service]),
    execFileAsync('systemctl', ['is-enabled', service]),
    execFileAsync('journalctl', ['-u', service, '-n', '20', '--no-pager', '--output=short']),
  ]);

  return {
    service,
    active: activeOut.value?.stdout?.trim() || 'unknown',
    enabled: enabledOut.value?.stdout?.trim() || 'unknown',
    status_output: statusOut.value?.stdout?.trim() || statusOut.reason?.message || '',
    recent_logs: logsOut.value?.stdout?.trim() || 'No logs available',
  };
}

// ── Tool: list_services ────────────────────────────────────

export async function listServices({ filter, state }, identity) {
  requireAdmin(identity);

  const args = ['list-units', '--type=service', '--no-pager', '--all', '--plain'];
  if (state) args.push(`--state=${state}`);

  const { stdout } = await execFileAsync('systemctl', args, { timeout: 15000 })
    .catch(err => ({ stdout: err.stdout || '' }));

  let lines = stdout.trim().split('\n').filter(Boolean);

  if (filter) {
    lines = lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()));
  }

  return { services: lines.join('\n'), count: lines.length };
}

// ── Tool: get_journal_logs ─────────────────────────────────

export async function getJournalLogs({ service, lines = 50, since, priority }, identity) {
  requireAdmin(identity);

  const validLines = Math.max(1, Math.min(Math.floor(lines), 500));
  const args = ['--no-pager', '--output=short-iso', `-n`, String(validLines)];

  if (service) {
    validateServiceName(service);
    args.push('-u', service);
  }
  if (since) {
    if (!/^[0-9a-zA-Z\s\-:]+$/.test(since)) throw new Error('Invalid since format');
    args.push('--since', since);
  }
  if (priority) args.push('-p', priority); // emerg,alert,crit,err,warning,notice,info,debug

  const { stdout, stderr } = await execFileAsync('journalctl', args, { timeout: 20000 })
    .catch(err => ({ stdout: err.stdout || '', stderr: err.stderr || '' }));

  return { logs: stdout.trim() || 'No logs found', stderr: stderr?.trim() };
}

// ── Tool: manage_firewall ──────────────────────────────────

export async function manageFirewall({ action, port, protocol = 'tcp', rule }, identity) {
  requireAdmin(identity);

  const allowedActions = ['status', 'enable', 'disable', 'allow', 'deny', 'delete', 'list'];

  if (!allowedActions.includes(action)) {
    throw new Error(`Invalid firewall action. Use one of: ${allowedActions.join(', ')}`);
  }

  if (port) {
    const p = parseInt(port, 10);
    if (isNaN(p) || p < 1 || p > 65535) throw new Error('Port must be between 1 and 65535');
  }

  let command, args;

  if (action === 'status' || action === 'list') {
    command = 'ufw';
    args = ['status', 'verbose'];
  } else if (action === 'enable') {
    command = 'ufw';
    args = ['--force', 'enable'];
  } else if (action === 'disable') {
    command = 'ufw';
    args = ['disable'];
  } else if (action === 'allow' && port) {
    command = 'ufw';
    args = ['allow', `${port}/${protocol}`];
  } else if (action === 'deny' && port) {
    command = 'ufw';
    args = ['deny', `${port}/${protocol}`];
  } else if (action === 'delete' && port && rule) {
    if (!['allow', 'deny'].includes(rule)) throw new Error('Rule must be allow or deny for delete action');
    command = 'ufw';
    args = ['delete', rule, `${port}/${protocol}`];
  } else {
    throw new Error('Invalid combination of action and parameters');
  }

  const { stdout, stderr } = await execFileAsync(command, args, { timeout: 15000 });

  return { action, output: stdout.trim() || stderr.trim() };
}
