// ============================================================
//  tools/files.js - File System Operations
// ============================================================
import fs from 'fs/promises';
import path from 'path';
import { secureExec } from '../lib/exec.js';
import { logSecurityEvent } from '../audit.js';

// fs streams available if needed for future large-file streaming

async function enforceOwnership(safePath, identity) {
  if (identity.role !== 'admin') {
    try {
      await secureExec(['chown', '-R', identity.userId, safePath], { role: 'admin' });
    } catch (e) {}
  }
}

// Paths that are NEVER accessible, regardless of role
const ABSOLUTE_FORBIDDEN_PATHS = ['/proc/kcore', '/dev/mem', '/dev/kmem'];

// Paths restricted to admin only
const ADMIN_ONLY_PATHS = ['/etc/shadow', '/etc/gshadow', '/etc/sudoers', '/root', '/boot', '/sys', '/proc'];

async function resolveSafePath(inputPath, identity) {
  let resolved = path.resolve(inputPath);

  if (identity.role !== 'admin') {
    if (
      resolved === '/tmp' ||
      resolved.startsWith('/tmp/') ||
      resolved === '/var/tmp' ||
      resolved.startsWith('/var/tmp/')
    ) {
      const privateTmp = `/tmp/mcp-${identity.userId}`;
      await fs.mkdir(privateTmp, { recursive: true, mode: 0o700 });
      try {
        await secureExec(['chown', identity.userId, privateTmp], { role: 'admin' });
      } catch (e) {}

      if (resolved === '/tmp' || resolved === '/var/tmp') {
        resolved = privateTmp;
      } else if (resolved.startsWith('/tmp/')) {
        resolved = path.join(privateTmp, resolved.slice(5));
      } else if (resolved.startsWith('/var/tmp/')) {
        resolved = path.join(privateTmp, resolved.slice(9));
      }
    }
  }

  for (const p of ABSOLUTE_FORBIDDEN_PATHS) {
    if (resolved === p || resolved.startsWith(p + '/')) {
      throw new Error(`Access to '${resolved}' is permanently forbidden`);
    }
  }

  let real = resolved;
  try {
    real = await fs.realpath(resolved);
  } catch {
    let current = resolved;
    let parent = path.dirname(current);
    while (current !== parent) {
      try {
        const parentReal = await fs.realpath(parent);
        real = path.join(parentReal, resolved.slice(parent.length));
        break;
      } catch {
        current = parent;
        parent = path.dirname(current);
      }
    }
  }

  for (const p of ABSOLUTE_FORBIDDEN_PATHS) {
    if (real === p || real.startsWith(p + '/')) {
      throw new Error(`Access to '${real}' is permanently forbidden via symlink`);
    }
  }

  if (identity.role !== 'admin') {
    const privateTmp = `/tmp/mcp-${identity.userId}`;
    const allowed = [`/home/${identity.userId}`, privateTmp];
    const isResolvedAllowed = allowed.some(a => resolved === a || resolved.startsWith(a + '/'));
    const isRealAllowed = allowed.some(a => real === a || real.startsWith(a + '/'));
    if (!isResolvedAllowed || !isRealAllowed) {
      throw new Error(`Access to '${resolved}' is not permitted for your role`);
    }
  } else {
    for (const p of ADMIN_ONLY_PATHS) {
      if (real === p || real.startsWith(p + '/')) {
        logSecurityEvent({
          ip: 'internal',
          event: 'ADMIN_SENSITIVE_ACCESS',
          detail: { userId: identity.userId, path: real },
        });
        return resolved;
      }
    }
  }

  return resolved;
}

// ── Tool: read_file ────────────────────────────────────────

export async function readFile({ filePath, encoding = 'utf8', maxBytes = 1048576 }, identity) {
  if (!filePath) throw new Error('filePath is required');
  const safe = await resolveSafePath(filePath, identity);

  const stat = await fs.stat(safe);
  if (stat.isDirectory()) throw new Error(`'${safe}' is a directory, use list_directory instead`);

  const actualMaxBytes = Math.min(maxBytes, 50 * 1024 * 1024);
  const size = stat.size;
  if (size > actualMaxBytes) {
    // Return first maxBytes
    const buf = Buffer.alloc(actualMaxBytes);
    const fh = await fs.open(safe, 'r');
    try {
      await fh.read(buf, 0, actualMaxBytes, 0);
    } finally {
      await fh.close();
    }
    return {
      content: buf.toString(encoding),
      truncated: true,
      size,
      read_bytes: actualMaxBytes,
    };
  }

  const content = await fs.readFile(safe, encoding);
  return { content, truncated: false, size };
}

// ── Tool: write_file ───────────────────────────────────────

export async function writeFile({ filePath, content, mode = 'overwrite', encoding = 'utf8' }, identity) {
  if (!filePath) throw new Error('filePath is required');
  if (content === undefined) throw new Error('content is required');

  const safe = await resolveSafePath(filePath, identity);
  const dir = path.dirname(safe);

  // Ensure parent dir exists
  await fs.mkdir(dir, { recursive: true });

  if (mode === 'append') {
    await fs.appendFile(safe, content, encoding);
  } else {
    await fs.writeFile(safe, content, { encoding, flag: 'w' });
  }

  await enforceOwnership(safe, identity);

  const stat = await fs.stat(safe);
  return {
    success: true,
    path: safe,
    size: stat.size,
    mode,
  };
}

// ── Tool: delete_file ──────────────────────────────────────

export async function deleteFile({ filePath, recursive = false }, identity) {
  if (!filePath) throw new Error('filePath is required');
  const safe = await resolveSafePath(filePath, identity);

  const stat = await fs.stat(safe);

  if (stat.isDirectory()) {
    if (!recursive) {
      throw new Error('Use recursive=true to delete directories');
    }
    if (identity.role !== 'admin' && safe === `/home/${identity.userId}`) {
      throw new Error('Cannot delete your own home directory');
    }
    await fs.rm(safe, { recursive: true, force: true });
  } else {
    await fs.unlink(safe);
  }

  return { success: true, deleted: safe };
}

// ── Tool: list_directory ───────────────────────────────────

export async function listDirectory({ dirPath, showHidden = false, detailed = true }, identity) {
  if (!dirPath) throw new Error('dirPath is required');
  const safe = await resolveSafePath(dirPath, identity);

  const entries = await fs.readdir(safe, { withFileTypes: true });
  const visible = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'));

  if (!detailed) {
    return { path: safe, entries: visible.map(e => e.name) };
  }

  const details = await Promise.all(
    visible.map(async entry => {
      try {
        const fullPath = path.join(safe, entry.name);
        const stat = await fs.lstat(fullPath);
        return {
          name: entry.name,
          type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file',
          size: stat.size,
          permissions: (stat.mode & 0o777).toString(8),
          owner_uid: stat.uid,
          modified: stat.mtime.toISOString(),
        };
      } catch {
        return { name: entry.name, type: 'unknown', error: 'stat failed' };
      }
    })
  );

  const limitedDetails = details.slice(0, 10000);
  return { path: safe, count: details.length, entries: limitedDetails };
}

// ── Tool: move_file ────────────────────────────────────────

export async function moveFile({ sourcePath, destPath }, identity) {
  if (!sourcePath || !destPath) throw new Error('sourcePath and destPath are required');
  const safeSrc = await resolveSafePath(sourcePath, identity);
  const safeDst = await resolveSafePath(destPath, identity);

  await fs.rename(safeSrc, safeDst);
  await enforceOwnership(safeDst, identity);
  return { success: true, from: safeSrc, to: safeDst };
}

// ── Tool: copy_file ────────────────────────────────────────

export async function copyFile({ sourcePath, destPath }, identity) {
  if (!sourcePath || !destPath) throw new Error('sourcePath and destPath are required');
  const safeSrc = await resolveSafePath(sourcePath, identity);
  const safeDst = await resolveSafePath(destPath, identity);

  await fs.cp(safeSrc, safeDst, { recursive: true });
  await enforceOwnership(safeDst, identity);
  return { success: true, from: safeSrc, to: safeDst };
}

// ── Tool: get_file_info ────────────────────────────────────

export async function getFileInfo({ filePath }, identity) {
  if (!filePath) throw new Error('filePath is required');
  const safe = await resolveSafePath(filePath, identity);

  const [stat, lstat] = await Promise.all([fs.stat(safe).catch(() => null), fs.lstat(safe).catch(() => null)]);

  if (!stat) throw new Error(`Path '${safe}' does not exist`);

  // Get checksum for files
  let checksum = null;
  if (stat.isFile() && stat.size < 100 * 1024 * 1024) {
    try {
      const { stdout } = await secureExec(['sha256sum', safe], identity);
      checksum = stdout.split(' ')[0];
    } catch {
      /* ignore */
    }
  }

  return {
    path: safe,
    type: lstat?.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'file',
    size: stat.size,
    size_human: formatBytes(stat.size),
    permissions: (stat.mode & 0o777).toString(8),
    owner_uid: stat.uid,
    group_gid: stat.gid,
    created: stat.birthtime.toISOString(),
    modified: stat.mtime.toISOString(),
    accessed: stat.atime.toISOString(),
    sha256: checksum,
    is_symlink: lstat?.isSymbolicLink() || false,
  };
}

// ── Tool: search_files ────────────────────────────────────

export async function searchFiles({ searchPath, pattern, maxResults = 50, fileType }, identity) {
  if (!searchPath || !pattern) throw new Error('searchPath and pattern are required');
  const safe = await resolveSafePath(searchPath, identity);

  const args = [safe, '-name', pattern];
  if (fileType === 'file') args.push('-type', 'f');
  if (fileType === 'directory') args.push('-type', 'd');
  args.push('-maxdepth', '10');

  const { stdout } = await secureExec(['find', ...args], identity, { timeout: 30000 });
  const results = stdout.trim().split('\n').filter(Boolean).slice(0, maxResults);
  return { results, count: results.length };
}

// ── Helper ─────────────────────────────────────────────────

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0,
    val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(1)} ${units[i]}`;
}
