import test, { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import crypto from 'crypto';
import fsPromises from 'fs/promises';
import { DatabaseSync } from 'node:sqlite';

const fsReadFile = mock.fn();
mock.module('fs/promises', {
  namedExports: {
    readFile: fsReadFile,
  },
});

const secureExecMock = mock.fn();
mock.module('../lib/exec.js', {
  namedExports: {
    secureExec: secureExecMock,
  },
});

const { monitor } = await import('../lib/monitor.js');
const SystemMonitor = monitor.constructor;

describe('SystemMonitor', () => {
  let sysMonitor;
  const dbFile = '.test.db';

  beforeEach(async () => {
    sysMonitor = new SystemMonitor();
    fsReadFile.mock.resetCalls();
    secureExecMock.mock.resetCalls();
    process.env.MCP_STATE_DB = dbFile;
    try {
      await fsPromises.unlink(dbFile);
    } catch (e) {
      // Ignore
    }
  });

  afterEach(async () => {
    sysMonitor.stop();
    mock.restoreAll();
    try {
      if (sysMonitor.database) sysMonitor.database.close();
    } catch (e) {}
    try {
      await fsPromises.unlink(dbFile);
    } catch (e) {
      // Ignore
    }
  });

  it('start and stop work', () => {
    assert.equal(sysMonitor.intervalId, null);
    sysMonitor.start(() => {});
    assert.ok(sysMonitor.intervalId);

    // Test double start does not override
    const oldId = sysMonitor.intervalId;
    sysMonitor.start(() => {});
    assert.equal(sysMonitor.intervalId, oldId);

    sysMonitor.stop();
    assert.equal(sysMonitor.intervalId, null);

    // Double stop
    sysMonitor.stop();
  });

  it('interval triggers collectStats and checkAll', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    let collectCalled = false;
    let checkCalled = false;
    sysMonitor.collectStats = async () => {
      collectCalled = true;
    };
    sysMonitor.checkAll = async () => {
      checkCalled = true;
    };

    sysMonitor.start(() => {});

    mock.timers.tick(10000);
    assert.ok(collectCalled);
    assert.ok(checkCalled);

    sysMonitor.stop();
    mock.timers.reset();
  });

  it('collectStats populates latestStats', async () => {
    fsReadFile.mock.mockImplementation(async file => {
      if (file === '/proc/stat') return 'cpu  100 0 100 800 0 0 0 0\n';
      if (file === '/proc/meminfo') return 'MemTotal: 1000\nMemAvailable: 400\n';
      if (file === '/proc/uptime') return '1234.56 789.01';
      if (file === '/proc/loadavg') return '0.5 0.4 0.3';
      return '';
    });
    secureExecMock.mock.mockImplementation(async () => {
      return { stdout: 'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/root 100 50 50 50% /\n' };
    });

    await sysMonitor.collectStats();

    const stats = sysMonitor.getLatestStats();
    assert.equal(stats.cpu, null);
    assert.equal(stats.memory, 60);
    assert.equal(stats.disk, 50);
    assert.equal(stats.uptime, 1234.56);
    assert.deepEqual(stats.loadAvg, { '1m': 0.5, '5m': 0.4, '15m': 0.3 });

    // Call again to get CPU
    fsReadFile.mock.mockImplementation(async file => {
      if (file === '/proc/stat') return 'cpu  200 0 200 1600 0 0 0 0\n';
      if (file === '/proc/meminfo') return 'MemTotal: 1000\nMemAvailable: 400\n';
      if (file === '/proc/uptime') return '1234.56 789.01';
      if (file === '/proc/loadavg') return '0.5 0.4 0.3';
      return '';
    });

    await sysMonitor.collectStats();
    const stats2 = sysMonitor.getLatestStats();
    assert.equal(stats2.cpu, 20.5);
  });

  it('collectStats catches errors', async () => {
    const originalConsoleError = console.error;
    let errorCalled = false;
    console.error = () => {
      errorCalled = true;
    };

    sysMonitor.getSysCpu = async () => {
      throw new Error('fail');
    };

    await sysMonitor.collectStats();
    assert.ok(errorCalled);
    console.error = originalConsoleError;
  });

  it('getSysCpu returns null if format is wrong', async () => {
    fsReadFile.mock.mockImplementation(async () => 'not cpu\n');
    const res = await sysMonitor.getSysCpu();
    assert.equal(res, null);
  });

  it('getSysMem returns null if format is wrong', async () => {
    fsReadFile.mock.mockImplementation(async () => 'MemTotal: 1000\n');
    const res = await sysMonitor.getSysMem();
    assert.equal(res, null);
  });

  it('getSysDisk returns null if format is wrong', async () => {
    secureExecMock.mock.mockImplementation(async () => {
      return { stdout: 'Filesystem\n' };
    });
    const res = await sysMonitor.getSysDisk();
    assert.equal(res, null);
  });

  it('persistenceDatabase throws without MCP_STATE_DB', () => {
    delete process.env.MCP_STATE_DB;
    assert.throws(() => sysMonitor.persistenceDatabase(), /Persistent alerts require MCP_STATE_DB/);
  });

  it('persistenceDatabase initializes database', () => {
    const db = sysMonitor.persistenceDatabase();
    assert.ok(db);

    const db2 = sysMonitor.persistenceDatabase();
    assert.equal(db, db2);
  });

  it('attachPersistent ignores if no MCP_STATE_DB or ownerKey', () => {
    sysMonitor.attachPersistent('session1', null);
    assert.equal(sysMonitor.subscribers.size, 0);

    delete process.env.MCP_STATE_DB;
    sysMonitor.attachPersistent('session1', 'owner1');
    assert.equal(sysMonitor.subscribers.size, 0);
  });

  it('attachPersistent restores subscriptions', () => {
    const db = sysMonitor.persistenceDatabase();
    db.prepare('INSERT INTO alert_subscriptions(id, owner_key, payload, updated_at) VALUES (?, ?, ?, ?)').run(
      'id1',
      'owner1',
      JSON.stringify({ type: 'cpu_threshold', threshold: 80, id: 'id1' }),
      new Date().toISOString()
    );

    sysMonitor.attachPersistent('session1', 'owner1');
    assert.ok(sysMonitor.subscribers.has('session1'));
    assert.ok(sysMonitor.subscribers.get('session1').has('id1'));
  });

  it('attachPersistent catches database errors', () => {
    mock.method(DatabaseSync.prototype, 'prepare', () => {
      throw new Error('DB fail');
    });

    const originalConsoleError = console.error;
    let errorCalled = false;
    console.error = () => {
      errorCalled = true;
    };

    sysMonitor.attachPersistent('session1', 'owner1');
    assert.ok(errorCalled);
    assert.equal(sysMonitor.subscribers.has('session1'), false);

    console.error = originalConsoleError;
  });

  it('subscribe creates subscription', () => {
    const id = sysMonitor.subscribe('session1', 'owner1', 'cpu_threshold', 90, 300, true);

    assert.ok(id);
    assert.ok(sysMonitor.subscribers.get('session1').has(id));

    const db = sysMonitor.persistenceDatabase();
    const rows = db.prepare('SELECT * FROM alert_subscriptions WHERE id = ?').all(id);
    assert.equal(rows.length, 1);
  });

  it('unsubscribe deletes subscription', () => {
    const id = sysMonitor.subscribe('session1', 'owner1', 'cpu_threshold', 90, 300, true);

    assert.throws(() => sysMonitor.unsubscribe('session1', 'owner2', id), /Alert subscription is not owned/);

    sysMonitor.unsubscribe('session1', 'owner1', 'bad-id'); // does nothing

    sysMonitor.unsubscribe('session1', 'owner1', id);
    assert.equal(sysMonitor.subscribers.has('session1'), false);

    const db = sysMonitor.persistenceDatabase();
    const rows = db.prepare('SELECT * FROM alert_subscriptions WHERE id = ?').all(id);
    assert.equal(rows.length, 0);
  });

  it('unsubscribeAll clears session', () => {
    sysMonitor.subscribe('session1', 'owner1', 'cpu_threshold', 90);
    sysMonitor.unsubscribeAll('session1');
    assert.equal(sysMonitor.subscribers.has('session1'), false);
  });

  it('getActiveAlerts returns formatted alerts', () => {
    const id = sysMonitor.subscribe('session1', 'owner1', 'cpu_threshold', 90, 300);
    sysMonitor.lastFired.set(`session1:${id}`, Date.now());

    const alerts = sysMonitor.getActiveAlerts('session1');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].id, id);
    assert.equal(alerts[0].threshold, 90);
    assert.notEqual(alerts[0].lastFired, 'Never');

    assert.deepEqual(sysMonitor.getActiveAlerts('bad-session'), []);

    const id2 = sysMonitor.subscribe('session1', 'owner1', 'memory_threshold', 80, 300);
    const alerts2 = sysMonitor.getActiveAlerts('session1');
    assert.equal(alerts2.find(a => a.id === id2).lastFired, 'Never');
  });

  it('checkAll ignores if no subscribers', async () => {
    await sysMonitor.checkAll();
  });

  it('checkAll triggers alerts correctly', async () => {
    const sentNotifications = [];
    sysMonitor.sendNotification = (sessionId, payload) => sentNotifications.push({ sessionId, payload });

    const idCpu = sysMonitor.subscribe('session1', 'owner1', 'cpu_threshold', 90, 300);
    const idMem = sysMonitor.subscribe('session1', 'owner1', 'memory_threshold', 80, 300);
    const idDisk = sysMonitor.subscribe('session1', 'owner1', 'disk_threshold', 70, 300);

    sysMonitor.latestStats = { cpu: 95, memory: 85, disk: 75 };

    await sysMonitor.checkAll();

    assert.equal(sentNotifications.length, 3);
    assert.ok(sentNotifications.some(n => n.payload.params.id === idCpu));
    assert.ok(sentNotifications.some(n => n.payload.params.id === idMem));
    assert.ok(sentNotifications.some(n => n.payload.params.id === idDisk));

    sentNotifications.length = 0;
    await sysMonitor.checkAll();
    assert.equal(sentNotifications.length, 0);
  });

  it('checkAll catches errors', async () => {
    sysMonitor.subscribe('session1', 'owner1', 'cpu_threshold', 90, 300);
    sysMonitor.latestStats = { cpu: 95 };

    sysMonitor.sendNotification = () => {
      throw new Error('Network error');
    };

    const originalConsoleError = console.error;
    let errorCalled = false;
    console.error = () => {
      errorCalled = true;
    };

    await sysMonitor.checkAll();

    assert.ok(errorCalled);
    console.error = originalConsoleError;
  });
});
