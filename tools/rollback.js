import { brokerCall } from '../lib/broker-client.js';

function requireAdmin(identity) {
  if (identity.role !== 'admin') throw new Error('Configuration tools require admin role');
}

function safeConfigId(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_.-]{1,63}$/.test(value)) throw new Error('Invalid configId');
  return value;
}

export async function applyConfig({ configId, newContent, healthCheckTimeout = 20 }, identity) {
  requireAdmin(identity);
  if (typeof newContent !== 'string' || !newContent.length) throw new Error('newContent is required');
  return brokerCall(
    'config.apply',
    { configId: safeConfigId(configId), content: newContent, healthCheckTimeout },
    { timeoutMs: (Math.min(Math.max(Number(healthCheckTimeout) || 20, 5), 60) + 40) * 1000 }
  );
}

export async function listConfigBackups({ configId }, identity) {
  requireAdmin(identity);
  return brokerCall('config.backups', { configId: safeConfigId(configId) });
}

export async function restoreConfig({ configId, timestamp }, identity) {
  requireAdmin(identity);
  if (typeof timestamp !== 'string' || !/^\d{10,16}$/.test(timestamp)) throw new Error('Invalid timestamp');
  return brokerCall('config.restore', { configId: safeConfigId(configId), timestamp }, { timeoutMs: 75_000 });
}
