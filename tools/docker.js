import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

export async function runSandboxedCode({ language, code, allowNetwork = false, timeout = 30, files = {} }, identity) {
  const allowedLanguages = ['python', 'node', 'bash'];
  if (!allowedLanguages.includes(language)) {
    throw new Error(`Unsupported language: ${language}. Allowed: ${allowedLanguages.join(', ')}`);
  }

  if (!code || typeof code !== 'string') {
    throw new Error('code is required');
  }

  const validTimeout = Math.min(Math.max(parseInt(timeout, 10) || 30, 1), 120);

  // Setup temporary directory for files if needed
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('files must be an object mapping filenames to string contents');
  }

  let tempDir = null;
  if (Object.keys(files).length > 0) {
    const sessionId = crypto.randomBytes(16).toString('hex');
    tempDir = `/tmp/mcp-sandbox-${sessionId}`;
    await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
    try {
      for (const [filename, content] of Object.entries(files)) {
        if (!filename || filename.includes('..') || filename.includes('/') || path.basename(filename) !== filename) {
          throw new Error(`Invalid filename: ${filename}`);
        }
        if (typeof content !== 'string') {
          throw new Error(`File '${filename}' must have string content`);
        }
        await fs.writeFile(path.join(tempDir, filename), content, { mode: 0o600 });
      }
    } catch (err) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw err;
    }
  }

  const dockerArgs = [
    'run', '--rm', '-i',
    '--memory', '256m',
    '--memory-swap', '256m',
    '--cpus', '0.5',
    '--pids-limit', '64',
    '--security-opt', 'no-new-privileges',
    '--cap-drop', 'ALL',
    '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    '--network', allowNetwork ? 'bridge' : 'none',
  ];

  if (tempDir) {
    // Mount the temp dir into /workspace
    dockerArgs.push('-v', `${tempDir}:/workspace:ro`); // read-only mount
  } else {
    dockerArgs.push('--tmpfs', '/workspace:rw,exec,nosuid,size=64m');
  }

  dockerArgs.push(`mcp-sandbox-${language}`);

  return new Promise((resolve, reject) => {
    const child = execFile('docker', dockerArgs, { timeout: validTimeout * 1000, maxBuffer: 1048576 }, (err, stdout, stderr) => {
      // Cleanup temp dir
      if (tempDir) {
        fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }

      let truncated = false;
      let out = stdout || '';
      let errOut = stderr || '';

      if (err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        truncated = true;
        out += '\n[OUTPUT TRUNCATED AT 1MB]';
      }

      if (err && err.killed) {
        errOut += `\n[PROCESS KILLED AFTER ${validTimeout}s TIMEOUT]`;
      }

      resolve({
        success: !err,
        stdout: out.trim(),
        stderr: errOut.trim(),
        truncated,
      });
    });

    child.stdin.write(code);
    child.stdin.end();
  });
}
