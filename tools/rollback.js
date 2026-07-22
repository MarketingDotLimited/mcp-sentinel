import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { secureExec } from '../lib/exec.js';

const BACKUP_DIR = path.join(process.cwd(), 'backups', 'configs');

function requireAdmin(identity) {
  if (identity.role !== 'admin') {
    throw new Error('Config rollback tools require admin role');
  }
}

async function ensureBackupDir() {
  await fs.mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
}

export async function applyConfig({ filePath, newContent, serviceName, syntaxCheckCmd, healthCheckTimeout = 15 }, identity) {
  requireAdmin(identity);
  if (!filePath || !newContent || !serviceName) {
    throw new Error('filePath, newContent, and serviceName are required');
  }

  const timeoutSecs = Math.max(5, Math.min(parseInt(healthCheckTimeout, 10), 60));

  await ensureBackupDir();

  // 1. Snapshot
  const pathHash = crypto.createHash('sha256').update(filePath).digest('hex');
  const fileBackupDir = path.join(BACKUP_DIR, pathHash);
  await fs.mkdir(fileBackupDir, { recursive: true, mode: 0o700 });

  const timestamp = Date.now().toString();
  const backupPath = path.join(fileBackupDir, `${timestamp}.bak`);
  const metaPath = path.join(fileBackupDir, `${timestamp}.meta.json`);

  let originalStat = null;
  let originalContent = null;
  try {
    originalStat = await fs.stat(filePath);
    originalContent = await fs.readFile(filePath);
    await fs.writeFile(backupPath, originalContent);
    await fs.writeFile(metaPath, JSON.stringify({
      originalPath: filePath,
      mode: originalStat.mode,
      uid: originalStat.uid,
      gid: originalStat.gid,
      timestamp: new Date(parseInt(timestamp)).toISOString(),
      userId: identity.userId,
    }));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // File doesn't exist yet, that's fine.
  }

  // 2. Syntax Check (optional)
  if (syntaxCheckCmd && Array.isArray(syntaxCheckCmd) && syntaxCheckCmd.length > 0) {
    // Write to a temp file and run check
    const tmpPath = `/tmp/mcp_config_test_${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(tmpPath, newContent);
    
    // Replace %s in cmd with tmpPath if requested, else append tmpPath
    const cmd = syntaxCheckCmd.map(arg => arg === '%s' ? tmpPath : arg);
    try {
      await secureExec(cmd, identity, { timeout: 10000 });
    } catch (e) {
      await fs.unlink(tmpPath).catch(()=>{});
      throw new Error(`Syntax check failed: ${e.stderr || e.message}`);
    }
    await fs.unlink(tmpPath).catch(()=>{});
  }

  // 3. Write new content
  await fs.writeFile(filePath, newContent);
  if (originalStat) {
    await fs.chown(filePath, originalStat.uid, originalStat.gid);
    await fs.chmod(filePath, originalStat.mode);
  }

  // 4. Restart service
  try {
    await secureExec(['systemctl', 'restart', serviceName], identity, { timeout: 30000 });
  } catch (e) {
    await rollback(filePath, originalContent, originalStat);
    throw new Error(`Failed to restart service '${serviceName}': ${e.stderr || e.message}. Configuration rolled back.`);
  }

  // 5. Poll for health
  const endTime = Date.now() + (timeoutSecs * 1000);
  let isHealthy = false;
  
  while (Date.now() < endTime) {
    try {
      const { stdout } = await secureExec(['systemctl', 'is-active', serviceName], identity, { timeout: 5000 });
      if (stdout.trim() === 'active') {
        isHealthy = true;
        break;
      }
    } catch (e) {
      // is-active returns non-zero if not active
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // 6. Rollback if failed
  if (!isHealthy) {
    await rollback(filePath, originalContent, originalStat);
    
    // Fetch logs
    let logs = '';
    try {
      const { stdout } = await secureExec(['journalctl', '-u', serviceName, '-n', '50', '--no-pager'], identity, { timeout: 10000 });
      logs = stdout.trim();
    } catch (e) {}

    await secureExec(['systemctl', 'restart', serviceName], identity, { timeout: 30000 }).catch(()=>{});

    throw new Error(`Service '${serviceName}' failed to reach active state within ${timeoutSecs}s. Configuration rolled back.\nLogs:\n${logs}`);
  }

  // Cleanup old backups (keep last 10)
  try {
    const files = await fs.readdir(fileBackupDir);
    const metas = files.filter(f => f.endsWith('.meta.json')).sort();
    if (metas.length > 10) {
      for (const m of metas.slice(0, metas.length - 10)) {
        await fs.unlink(path.join(fileBackupDir, m)).catch(()=>{});
        await fs.unlink(path.join(fileBackupDir, m.replace('.meta.json', '.bak'))).catch(()=>{});
      }
    }
  } catch (e) {}

  return { success: true, message: `Configuration applied and service '${serviceName}' is healthy.` };
}

async function rollback(filePath, originalContent, originalStat) {
  if (originalContent !== null) {
    await fs.writeFile(filePath, originalContent);
    if (originalStat) {
      await fs.chown(filePath, originalStat.uid, originalStat.gid);
      await fs.chmod(filePath, originalStat.mode);
    }
  } else {
    await fs.unlink(filePath).catch(()=>{});
  }
}

export async function listConfigBackups({ filePath }, identity) {
  requireAdmin(identity);
  if (!filePath) throw new Error('filePath is required');

  const pathHash = crypto.createHash('sha256').update(filePath).digest('hex');
  const fileBackupDir = path.join(BACKUP_DIR, pathHash);

  try {
    const files = await fs.readdir(fileBackupDir);
    const metas = files.filter(f => f.endsWith('.meta.json'));
    
    const backups = [];
    for (const m of metas) {
      try {
        const meta = JSON.parse(await fs.readFile(path.join(fileBackupDir, m), 'utf8'));
        const stat = await fs.stat(path.join(fileBackupDir, m.replace('.meta.json', '.bak')));
        backups.push({
          timestamp: m.replace('.meta.json', ''),
          date: meta.timestamp,
          userId: meta.userId,
          size: stat.size,
        });
      } catch (e) {}
    }

    return { backups: backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp)) };
  } catch (e) {
    if (e.code === 'ENOENT') return { backups: [] };
    throw e;
  }
}

export async function restoreConfig({ filePath, timestamp }, identity) {
  requireAdmin(identity);
  if (!filePath || !timestamp) throw new Error('filePath and timestamp are required');

  const pathHash = crypto.createHash('sha256').update(filePath).digest('hex');
  const backupPath = path.join(BACKUP_DIR, pathHash, `${timestamp}.bak`);
  const metaPath = path.join(BACKUP_DIR, pathHash, `${timestamp}.meta.json`);

  try {
    const content = await fs.readFile(backupPath);
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));

    await fs.writeFile(filePath, content);
    await fs.chown(filePath, meta.uid, meta.gid);
    await fs.chmod(filePath, meta.mode);

    return { success: true, message: `Configuration restored from backup ${timestamp}` };
  } catch (e) {
    throw new Error(`Failed to restore backup: ${e.message}`);
  }
}
