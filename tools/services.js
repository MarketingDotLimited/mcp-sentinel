// ============================================================
//  tools/services.js - systemd Service Management (Admin Only)
// ============================================================
import { brokerCall } from '../lib/broker-client.js';

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

  const allowedActions = ['start', 'stop', 'restart', 'reload', 'status', 'is-active'];
  if (!allowedActions.includes(action)) {
    throw new Error(`Invalid action. Use one of: ${allowedActions.join(', ')}`);
  }

  const { stdout, stderr } = await brokerCall('service.action', { service, action });

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

  const [status, logs] = await Promise.all([
    brokerCall('service.status', { service }),
    brokerCall('journal.read', { service, lines: 20 }),
  ]);

  return {
    service,
    active: status.active || 'unknown',
    enabled: status.enabled || 'unknown',
    status_output: status.status || '',
    recent_logs: logs.stdout || 'No logs available',
  };
}

// ── Tool: list_services ────────────────────────────────────

export async function listServices({ filter, state }, identity) {
  requireAdmin(identity);

  const { stdout } = await brokerCall('service.list', state ? { state } : {});

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
  if (service) validateServiceName(service);
  const { stdout, stderr } = await brokerCall('journal.read', {
    ...(service ? { service } : {}),
    lines: validLines,
    ...(since ? { since } : {}),
    ...(priority ? { priority } : {}),
  });

  return { logs: stdout.trim() || 'No logs found', stderr: stderr?.trim() };
}

// ── Tool: manage_firewall ──────────────────────────────────

export async function manageFirewall({ action, port, protocol = 'tcp', rule, rollbackId }, identity) {
  requireAdmin(identity);

  const allowedActions = ['status', 'allow', 'deny', 'delete', 'list', 'confirm'];

  if (!allowedActions.includes(action)) {
    throw new Error(`Invalid firewall action. Use one of: ${allowedActions.join(', ')}`);
  }

  if (port) {
    const p = parseInt(port, 10);
    if (isNaN(p) || p < 1 || p > 65535) throw new Error('Port must be between 1 and 65535');
  }

  if (action === 'status' || action === 'list') {
    const { stdout, stderr } = await brokerCall('firewall.status', {});
    return { action, output: stdout || stderr };
  }
  if (action === 'confirm') {
    if (!rollbackId) throw new Error('rollbackId is required to confirm a firewall change');
    return brokerCall('firewall.confirm', { rollbackId });
  }
  if (action === 'delete' && !rule) {
    throw new Error('Rule must be allow or deny for delete action');
  }
  if (action === 'delete' && port && rule) {
    if (!['allow', 'deny'].includes(rule)) throw new Error('Rule must be allow or deny for delete action');
  }
  if (!port) {
    throw new Error('Invalid combination of action and parameters');
  }
  const result = await brokerCall('firewall.rule', { action, port: Number(port), protocol, rule });
  const { stdout, stderr } = result;

  return {
    action,
    output: stdout.trim() || stderr.trim(),
    rollbackId: result.rollbackId,
    rollbackAt: result.rollbackAt,
  };
}
