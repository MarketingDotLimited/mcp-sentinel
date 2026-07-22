import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { secureExec } from './exec.js';

class SystemMonitor {
  constructor() {
    this.intervalId = null;
    this.subscribers = new Map(); // sessionId -> Set of alerts
    this.lastFired = new Map(); // alertKey -> timestamp
    this.previousCpu = null;
    this.latestStats = { cpu: null, memory: null, disk: null, uptime: null, loadAvg: null };
    this.startedAt = Date.now();
    this.database = null;
  }

  start(sendNotificationFn) {
    if (this.intervalId) return;
    this.sendNotification = sendNotificationFn;
    // Always collect baseline stats, even without subscribers
    this.collectStats();
    this.intervalId = setInterval(() => {
      this.collectStats();
      this.checkAll();
    }, 10000);
  }

  async collectStats() {
    try {
      const [cpu, mem, disk, uptime, loadAvg] = await Promise.all([
        this.getSysCpu(),
        this.getSysMem(),
        this.getSysDisk(),
        this.getUptime(),
        this.getLoadAvg(),
      ]);
      this.latestStats = { cpu, memory: mem, disk, uptime, loadAvg };
    } catch (e) {
      console.error('[Monitor] Stats collection failed:', e);
    }
  }

  getLatestStats() {
    return { ...this.latestStats };
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  persistenceDatabase() {
    if (this.database) return this.database;
    const databaseFile = process.env.MCP_STATE_DB;
    if (!databaseFile) throw new Error('Persistent alerts require MCP_STATE_DB');
    this.database = new DatabaseSync(path.resolve(databaseFile));
    this.database.exec(`CREATE TABLE IF NOT EXISTS alert_subscriptions (
      id TEXT PRIMARY KEY,
      owner_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;`);
    return this.database;
  }

  attachPersistent(sessionId, ownerKey) {
    if (!process.env.MCP_STATE_DB || !ownerKey) return;
    let rows;
    try {
      rows = this.persistenceDatabase()
        .prepare('SELECT id, payload FROM alert_subscriptions WHERE owner_key = ?')
        .all(ownerKey);
    } catch (error) {
      console.error('[Monitor] Persistent alert restore failed:', error.message);
      return;
    }
    if (!this.subscribers.has(sessionId)) this.subscribers.set(sessionId, new Map());
    for (const row of rows) this.subscribers.get(sessionId).set(row.id, JSON.parse(row.payload));
  }

  subscribe(sessionId, ownerKey, alertType, threshold, cooldownSeconds = 300, persistent = false) {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Map());
    }
    const id = crypto.randomUUID();
    const subscription = {
      type: alertType,
      threshold,
      cooldown: cooldownSeconds * 1000,
      id,
      persistent,
      ownerKey,
    };
    this.subscribers.get(sessionId).set(id, subscription);
    if (persistent) {
      this.persistenceDatabase()
        .prepare('INSERT INTO alert_subscriptions(id, owner_key, payload, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, ownerKey, JSON.stringify(subscription), new Date().toISOString());
    }
    return id;
  }

  unsubscribe(sessionId, ownerKey, id) {
    const subs = this.subscribers.get(sessionId);
    if (subs?.has(id)) {
      const sub = subs.get(id);
      if (sub.ownerKey !== ownerKey) throw new Error('Alert subscription is not owned by this identity');
      subs.delete(id);
      if (subs.size === 0) this.subscribers.delete(sessionId);
      if (sub.persistent) {
        this.persistenceDatabase()
          .prepare('DELETE FROM alert_subscriptions WHERE id = ? AND owner_key = ?')
          .run(id, ownerKey);
      }
    }
  }

  unsubscribeAll(sessionId) {
    this.subscribers.delete(sessionId);
  }

  getActiveAlerts(sessionId) {
    const subs = this.subscribers.get(sessionId);
    if (!subs) return [];
    return Array.from(subs.values()).map(sub => ({
      id: sub.id,
      type: sub.type,
      threshold: sub.threshold,
      cooldownSeconds: sub.cooldown / 1000,
      lastFired: this.lastFired.get(`${sessionId}:${sub.id}`)
        ? new Date(this.lastFired.get(`${sessionId}:${sub.id}`)).toISOString()
        : 'Never',
    }));
  }

  async checkAll() {
    if (this.subscribers.size === 0) return;
    const { cpu, memory: mem, disk } = this.latestStats;

    try {
      for (const [sessionId, subs] of this.subscribers.entries()) {
        for (const sub of subs.values()) {
          const alertKey = `${sessionId}:${sub.id}`;
          const lastTime = this.lastFired.get(alertKey) || 0;
          if (Date.now() - lastTime < sub.cooldown) continue;

          let fired = false;
          let details = null;

          if (sub.type === 'cpu_threshold' && cpu !== null && cpu >= sub.threshold) {
            fired = true;
            details = `CPU usage is ${cpu.toFixed(1)}% (threshold: ${sub.threshold}%)`;
          } else if (sub.type === 'memory_threshold' && mem !== null && mem >= sub.threshold) {
            fired = true;
            details = `Memory usage is ${mem.toFixed(1)}% (threshold: ${sub.threshold}%)`;
          } else if (sub.type === 'disk_threshold' && disk !== null && disk >= sub.threshold) {
            fired = true;
            details = `Root disk usage is ${disk.toFixed(1)}% (threshold: ${sub.threshold}%)`;
          }

          if (fired) {
            this.lastFired.set(alertKey, Date.now());
            if (this.sendNotification) {
              this.sendNotification(sessionId, {
                method: 'notifications/mcp-sentinel/alert',
                params: {
                  id: sub.id,
                  type: sub.type,
                  threshold: sub.threshold,
                  details,
                  firedAt: new Date().toISOString(),
                  resourceUri: 'mcp-sentinel://alerts/current',
                },
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('[Monitor] Check failed:', e);
    }
  }

  async getSysCpu() {
    try {
      const stat = await fs.readFile('/proc/stat', 'utf8');
      const lines = stat.split('\n');
      const cpuLine = lines.find(l => l.startsWith('cpu '));
      if (!cpuLine) return null;

      const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + parts[4]; // idle + iowait
      const total = parts.reduce((a, b) => a + b, 0);

      let usage = null;
      if (this.previousCpu) {
        const diffIdle = idle - this.previousCpu.idle;
        const diffTotal = total - this.previousCpu.total;
        usage = ((1000 * (diffTotal - diffIdle)) / diffTotal + 5) / 10;
      }
      this.previousCpu = { idle, total };
      return usage;
    } catch {
      return null;
    }
  }

  async getSysMem() {
    try {
      const meminfo = await fs.readFile('/proc/meminfo', 'utf8');
      const totalMatch = meminfo.match(/MemTotal:\s+(\d+)/);
      const availableMatch = meminfo.match(/MemAvailable:\s+(\d+)/);
      if (totalMatch && availableMatch) {
        const total = parseInt(totalMatch[1], 10);
        const avail = parseInt(availableMatch[1], 10);
        return ((total - avail) / total) * 100;
      }
      return null;
    } catch {
      return null;
    }
  }

  async getSysDisk() {
    try {
      const { stdout } = await secureExec(['df', '/'], { role: 'admin' });
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) return null;
      const parts = lines[1].trim().split(/\s+/);
      const usePct = parts[4].replace('%', '');
      return parseInt(usePct, 10);
    } catch {
      return null;
    }
  }

  async getUptime() {
    try {
      const data = await fs.readFile('/proc/uptime', 'utf8');
      return parseFloat(data.split(' ')[0]);
    } catch {
      return null;
    }
  }

  async getLoadAvg() {
    try {
      const data = await fs.readFile('/proc/loadavg', 'utf8');
      const parts = data.trim().split(' ');
      return { '1m': parseFloat(parts[0]), '5m': parseFloat(parts[1]), '15m': parseFloat(parts[2]) };
    } catch {
      return null;
    }
  }
}

export const monitor = new SystemMonitor();
