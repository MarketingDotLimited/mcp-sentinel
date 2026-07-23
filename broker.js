import net from 'net';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import { DatabaseSync } from 'node:sqlite';
import {
  getOAuthUsers,
  addOAuthUser,
  updateOAuthUser,
  deleteOAuthUser,
  getOAuthClients,
  addOAuthClient,
  deleteOAuthClient,
  getAutheliaHealth,
} from './lib/authelia.js';

const execFileAsync = promisify(execFile);
const SOCKET_PATH = process.env.MCP_BROKER_SOCKET || '/run/mcp-sentinel/broker.sock';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = Number(process.env.BROKER_MAX_OUTPUT_BYTES || 5 * 1024 * 1024);
const PROTECTED_SERVICES = new Set(
  (process.env.BROKER_PROTECTED_SERVICES || 'mcp-sentinel,mcp-sentinel-broker,ssh,sshd,nginx,authelia')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const MANAGED_SERVICES = new Set(
  (process.env.BROKER_MANAGED_SERVICES || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const FIREWALL_PORTS = new Set(
  (process.env.BROKER_FIREWALL_PORTS || '')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isInteger(value) && value >= 1 && value <= 65535)
);
const MANAGEMENT_PORTS = new Set(
  (process.env.BROKER_MANAGEMENT_PORTS || '22,443')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(Number.isInteger)
);
const STATE_DATABASE = process.env.MCP_STATE_DB || '/var/lib/mcp-sentinel/state.sqlite3';
const MANAGED_USERS = new Set(
  (process.env.BROKER_MANAGED_USERS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const MANAGED_GROUPS = new Set(
  (process.env.BROKER_MANAGED_GROUPS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const ALLOWED_SHELLS = new Set(
  (process.env.BROKER_ALLOWED_SHELLS || '/bin/bash,/bin/sh,/usr/sbin/nologin')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);
const CONFIG_REGISTRY_FILE = process.env.BROKER_CONFIG_REGISTRY || '/etc/mcp-sentinel/config-registry.json';
const CONFIG_BACKUP_ROOT = process.env.BROKER_CONFIG_BACKUP_ROOT || '/var/lib/mcp-sentinel/config-backups';
const FIREWALL_SNAPSHOT_ROOT = process.env.BROKER_FIREWALL_SNAPSHOT_ROOT || '/var/lib/mcp-sentinel/firewall-snapshots';
const FIREWALL_ROLLBACK_SCRIPT =
  process.env.BROKER_FIREWALL_ROLLBACK_SCRIPT || '/opt/mcp-sentinel/scripts/firewall-rollback.js';
const GIT_ALLOWED_REPOS = new Set(
  (process.env.BROKER_GIT_ALLOWED_REPOS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => path.resolve(value))
);
const PROJECT_RECIPES = {
  artisan: { argv: ['php', 'artisan', 'test'], target: true, filter: '--filter', laravel: true },
  phpunit: { argv: ['vendor/bin/phpunit'], target: true, filter: '--filter', laravel: true },
  npm: { argv: ['npm', 'test', '--'], target: true },
  'composer-validate': { argv: ['composer', 'validate', '--no-interaction'] },
  pest: { argv: ['vendor/bin/pest'], target: true, filter: '--filter', laravel: true },
  frontend: { argv: ['npm', 'run', 'test', '--'], target: true },
  playwright: { argv: ['node_modules/.bin/playwright', 'test'], target: true },
  python: { argv: ['python3', '-m', 'pytest'], target: true, filter: '-k' },
  go: { argv: ['go', 'test'], target: true, filter: '-run' },
  rust: { argv: ['cargo', 'test'], target: true, filterSeparator: true },
};
const MAX_PROJECT_FILE_BYTES = Number(process.env.BROKER_MAX_PROJECT_FILE_BYTES || 5 * 1024 * 1024);

function exactObject(value, allowed, required = allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('parameters must be an object');
  const keys = Object.keys(value);
  if (keys.some(key => !allowed.includes(key))) throw new Error('Request contains an unknown field');
  if (required.some(key => !(key in value))) throw new Error('Request is missing a required field');
}

function serviceName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.@-]{1,128}$/.test(value) || value.includes('..'))
    throw new Error('Invalid service name');
  if (!MANAGED_SERVICES.has(value)) throw new Error('Service is not registered with the broker');
  return value;
}

async function execute(file, argv, timeout = 30_000) {
  try {
    const result = await execFileAsync(file, argv, { timeout, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: 0 };
  } catch (error) {
    const wrapped = new Error('Registered broker operation failed');
    wrapped.result = {
      stdout: String(error.stdout || '').slice(0, MAX_OUTPUT_BYTES),
      stderr: String(error.stderr || error.message).slice(0, MAX_OUTPUT_BYTES),
      exitCode: Number.isInteger(error.code) ? error.code : null,
    };
    throw wrapped;
  }
}

async function executeWithInput(file, argv, input, timeout = 30_000) {
  try {
    const result = await new Promise((resolve, reject) => {
      const child = execFile(
        file,
        argv,
        { timeout, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) Object.assign(error, { stdout, stderr });
          if (error) reject(error);
          else resolve({ stdout, stderr });
        }
      );
      child.stdin.end(input);
    });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: 0 };
  } catch (error) {
    throw new Error(String(error.stderr || error.message).slice(0, MAX_OUTPUT_BYTES));
  }
}

function validUsername(value) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_.-]{0,31}$/i.test(value) || value === 'root')
    throw new Error('Invalid managed username');
  return value;
}

function projectUsers() {
  try {
    const database = new DatabaseSync(STATE_DATABASE, { readOnly: true });
    try {
      return new Set(
        database
          .prepare('SELECT payload FROM projects')
          .all()
          .map(row => JSON.parse(row.payload).runAsUser)
          .filter(Boolean)
      );
    } finally {
      database.close();
    }
  } catch {
    return new Set();
  }
}

function managedUsername(value) {
  const username = validUsername(value);
  if (!MANAGED_USERS.has(username) && !projectUsers().has(username))
    throw new Error('User is not registered with the broker');
  return username;
}

function passwdRecord(username) {
  const line = fs
    .readFileSync('/etc/passwd', 'utf8')
    .split('\n')
    .find(entry => entry.startsWith(`${username}:`));
  if (!line) throw new Error('Managed user does not exist');
  const [name, , uid, gid, comment, home, shell] = line.split(':');
  return { username: name, uid: Number(uid), gid: Number(gid), comment, home, shell };
}

function validateGroups(value) {
  if (!value) return [];
  if (!Array.isArray(value) || !value.every(group => MANAGED_GROUPS.has(group)))
    throw new Error('Every group must be registered with the broker');
  return [...new Set(value)];
}

function validatePublicKey(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(value))
    throw new Error('Invalid SSH public key');
  const parts = value.trim().split(/\s+/);
  const types = new Set([
    'ssh-rsa',
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'sk-ssh-ed25519@openssh.com',
  ]);
  if (!types.has(parts[0]) || !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[1] || ''))
    throw new Error('Invalid SSH public key payload');
  return value.trim();
}

function authorizedKeysPath(username) {
  const user = passwdRecord(username);
  const home = fs.realpathSync(user.home);
  if (home === '/' || home === '/root') throw new Error('Unsafe managed user home');
  return { user, home, sshDirectory: path.join(home, '.ssh'), file: path.join(home, '.ssh', 'authorized_keys') };
}

function registeredConfig(configId) {
  if (typeof configId !== 'string' || !/^[a-z][a-z0-9_.-]{1,63}$/.test(configId))
    throw new Error('Invalid configuration ID');
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(CONFIG_REGISTRY_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Configuration registry unavailable: ${error.message}`);
  }
  const config = registry.configs?.[configId];
  if (!config || typeof config !== 'object') throw new Error('Configuration is not registered with the broker');
  if (typeof config.path !== 'string' || !path.isAbsolute(config.path))
    throw new Error('Registered configuration path is invalid');
  if (!MANAGED_SERVICES.has(config.service)) throw new Error('Registered configuration service is not manageable');
  if (!['json', 'nginx', 'systemd', 'authelia'].includes(config.validator))
    throw new Error('Registered configuration validator is invalid');
  if (config.healthUrl) {
    const url = new URL(config.healthUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Registered configuration health URL is invalid');
  }
  return { id: configId, ...config };
}

function validateConfiguration(config, candidate) {
  if (config.validator === 'json') {
    JSON.parse(fs.readFileSync(candidate, 'utf8'));
    return Promise.resolve();
  }
  const commands = {
    nginx: ['nginx', ['-t', '-c', candidate]],
    systemd: ['systemd-analyze', ['verify', candidate]],
    authelia: ['authelia', ['validate-config', '--config', candidate]],
  };
  const [executable, argv] = commands[config.validator];
  return execute(executable, argv, 15_000);
}

async function configHealthy(config) {
  const active = await execute('systemctl', ['is-active', '--', config.service]).catch(() => null);
  if (active?.stdout !== 'active') return false;
  if (!config.healthUrl) return true;
  try {
    const response = await fetch(config.healthUrl, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function restartAndVerify(config, timeoutSeconds = 20) {
  await execute('systemctl', ['restart', '--', config.service], 30_000);
  const deadline = Date.now() + Math.min(Math.max(Number(timeoutSeconds) || 20, 5), 60) * 1000;
  do {
    if (await configHealthy(config)) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  } while (Date.now() < deadline);
  return false;
}

function atomicReplace(target, content, metadata) {
  const directory = fs.realpathSync(path.dirname(target));
  const finalPath = path.join(directory, path.basename(target));
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    if (metadata) fs.fchownSync(descriptor, metadata.uid, metadata.gid);
    if (metadata) fs.fchmodSync(descriptor, metadata.mode & 0o777);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, finalPath);
  return finalPath;
}

async function applyRegisteredConfig(config, content, timeoutSeconds, { createBackup = true } = {}) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > 5 * 1024 * 1024)
    throw new Error('Configuration content must be at most 5 MiB');
  let metadata = null;
  let original = null;
  try {
    metadata = fs.lstatSync(config.path);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      throw new Error('Registered configuration must be a regular file');
    original = fs.readFileSync(config.path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const backupDirectory = path.join(CONFIG_BACKUP_ROOT, config.id);
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const timestamp = Date.now().toString();
  if (createBackup && original) {
    fs.writeFileSync(path.join(backupDirectory, `${timestamp}.bak`), original, { mode: 0o600, flag: 'wx' });
    fs.writeFileSync(
      path.join(backupDirectory, `${timestamp}.json`),
      JSON.stringify({
        configId: config.id,
        path: config.path,
        uid: metadata.uid,
        gid: metadata.gid,
        mode: metadata.mode,
      }),
      { mode: 0o600, flag: 'wx' }
    );
  }
  const directory = fs.realpathSync(path.dirname(config.path));
  const candidate = path.join(directory, `.${path.basename(config.path)}.${process.pid}.validate`);
  fs.writeFileSync(candidate, content, { mode: 0o600, flag: 'wx' });
  try {
    await validateConfiguration(config, candidate);
  } catch (error) {
    throw new Error(`Registered validator rejected the configuration: ${error.result?.stderr || error.message}`);
  } finally {
    fs.unlinkSync(candidate);
  }
  atomicReplace(config.path, content, metadata);
  try {
    if (!(await restartAndVerify(config, timeoutSeconds))) throw new Error('Service application health check failed');
  } catch (error) {
    if (original) atomicReplace(config.path, original, metadata);
    else fs.unlinkSync(config.path);
    await execute('systemctl', ['restart', '--', config.service], 30_000).catch(() => {});
    throw new Error(`Configuration was restored after failure: ${error.message}`);
  }
  return { configId: config.id, backup: original ? timestamp : null, service: config.service, healthy: true };
}

function registeredProject(projectId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId))
    throw new Error('Invalid project ID');
  const database = new DatabaseSync(STATE_DATABASE, { readOnly: true });
  try {
    const row = database.prepare('SELECT payload FROM projects WHERE id = ?').get(projectId);
    if (!row) throw new Error('Project is not registered with the broker');
    const project = JSON.parse(row.payload);
    if (!project.runAsUser || project.runAsUser === 'root') throw new Error('Project execution user must be non-root');
    return project;
  } finally {
    database.close();
  }
}

function projectSandboxProperties(project, root, { allowNetwork = false } = {}) {
  const vhostRoot = '/var/www/vhosts';
  const isolationRoot = root.startsWith(`${vhostRoot}${path.sep}`) ? vhostRoot : path.dirname(root);
  if (isolationRoot === path.parse(isolationRoot).root)
    throw new Error('Project root is too broad for filesystem isolation');

  const inaccessible = new Set([path.join(root, '.env'), '/run/docker.sock', '/var/run/docker.sock']);
  for (const entry of fs.readdirSync(root)) {
    if (entry.startsWith('.env') && entry !== '.env.testing') inaccessible.add(path.join(root, entry));
  }
  for (const protectedPath of project.protectedPaths || []) {
    if (typeof protectedPath !== 'string' || path.isAbsolute(protectedPath)) continue;
    const normalized = path.normalize(protectedPath);
    if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) continue;
    inaccessible.add(path.join(root, normalized));
  }

  const networkCredentialPaths = [];
  if (allowNetwork) {
    const user = passwdRecord(project.runAsUser);
    const home = fs.existsSync(user.home) ? fs.realpathSync(user.home) : user.home;
    const sshDirectory = path.join(home, '.ssh');
    if (fs.existsSync(sshDirectory)) {
      const sshStat = fs.lstatSync(sshDirectory);
      const realSshDirectory = fs.realpathSync(sshDirectory);
      if (
        !sshStat.isDirectory() ||
        sshStat.isSymbolicLink() ||
        sshStat.uid !== user.uid ||
        !(realSshDirectory === home || realSshDirectory.startsWith(`${home}${path.sep}`))
      )
        throw new Error('Project SSH credential directory is unsafe');
      networkCredentialPaths.push(`--property=BindReadOnlyPaths=${realSshDirectory}:${sshDirectory}`);
    }
  }

  return [
    '--property=NoNewPrivileges=yes',
    '--property=PrivateTmp=yes',
    '--property=PrivateDevices=yes',
    '--property=PrivateMounts=yes',
    `--property=PrivateNetwork=${allowNetwork ? 'no' : 'yes'}`,
    '--property=ProtectSystem=strict',
    '--property=ProtectHome=tmpfs',
    '--property=ProtectKernelTunables=yes',
    '--property=ProtectKernelModules=yes',
    '--property=ProtectKernelLogs=yes',
    '--property=ProtectControlGroups=yes',
    '--property=RestrictSUIDSGID=yes',
    '--property=RestrictRealtime=yes',
    '--property=LockPersonality=yes',
    '--property=CapabilityBoundingSet=',
    '--property=AmbientCapabilities=',
    '--property=DevicePolicy=closed',
    '--property=RestrictAddressFamilies=AF_INET AF_INET6',
    `--property=TemporaryFileSystem=${isolationRoot}:ro`,
    `--property=BindPaths=${root}:${root}`,
    ...networkCredentialPaths,
    ...[...inaccessible].map(hiddenPath => `--property=InaccessiblePaths=-${hiddenPath}`),
    `--property=ReadWritePaths=${root}`,
  ];
}

function projectFileTarget(projectId, relativePath, { allowRoot = false, mustExist = true } = {}) {
  const project = registeredProject(projectId);
  if (
    typeof relativePath !== 'string' ||
    relativePath.includes('\0') ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes('..')
  )
    throw new Error('Project file path must be relative and cannot traverse');
  const normalized = path.normalize(relativePath || '.');
  if (!allowRoot && normalized === '.') throw new Error('Project root cannot be used for this operation');
  const protectedPrefixes = ['.git', '.env', ...(project.protectedPaths || [])];
  if (
    normalized !== '.' &&
    protectedPrefixes.some(prefix => {
      const cleaned = path.normalize(String(prefix));
      return (
        normalized === cleaned ||
        normalized.startsWith(`${cleaned}${path.sep}`) ||
        path.basename(normalized).startsWith('.env')
      );
    })
  )
    throw new Error('Project path is protected');

  const root = fs.realpathSync(project.rootPath);
  const target = path.resolve(root, normalized);
  if (!(target === root || target.startsWith(`${root}${path.sep}`))) throw new Error('Project file path escapes root');
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not accepted for project file operations');
    const real = fs.realpathSync(target);
    if (!(real === root || real.startsWith(`${root}${path.sep}`)))
      throw new Error('Project file resolves outside root');
    return { project, root, target: real, relativePath: path.relative(root, real) || '.', stat };
  } catch (error) {
    if (error.code !== 'ENOENT' || mustExist) throw error;
    const parent = fs.realpathSync(path.dirname(target));
    if (!(parent === root || parent.startsWith(`${root}${path.sep}`)))
      throw new Error('Project file parent escapes root');
    return { project, root, target: path.join(parent, path.basename(target)), relativePath: normalized, stat: null };
  }
}

function projectFileMetadata(project, descriptor, existing) {
  const user = passwdRecord(project.runAsUser);
  fs.fchownSync(descriptor, existing?.uid ?? user.uid, existing?.gid ?? user.gid);
  fs.fchmodSync(descriptor, existing ? existing.mode & 0o777 : 0o600);
}

function atomicProjectWrite(location, content) {
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_PROJECT_FILE_BYTES) throw new Error('Project file exceeds the mutation limit');
  const directory = path.dirname(location.target);
  const temporary = path.join(
    directory,
    `.${path.basename(location.target)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  const descriptor = fs.openSync(
    temporary,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600
  );
  try {
    fs.writeFileSync(descriptor, content, 'utf8');
    projectFileMetadata(location.project, descriptor, location.stat);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    fs.renameSync(temporary, location.target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function projectFileInfo(location) {
  const stat = fs.lstatSync(location.target);
  let sha256 = null;
  if (stat.isFile() && stat.size <= 100 * 1024 * 1024) {
    const descriptor = fs.openSync(location.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      sha256 = crypto.createHash('sha256').update(fs.readFileSync(descriptor)).digest('hex');
    } finally {
      fs.closeSync(descriptor);
    }
  }
  return {
    projectId: location.project.id,
    path: location.relativePath,
    type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other',
    size: stat.size,
    permissions: (stat.mode & 0o777).toString(8),
    ownerUid: stat.uid,
    groupGid: stat.gid,
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
    sha256,
  };
}

function parseTestingEnvironment(project, root) {
  const envFile = path.join(root, '.env.testing');
  const descriptor = fs.openSync(envFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let contents;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('.env.testing must be a bounded regular file');
    contents = fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
  const values = Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter(line => line && !line.trimStart().startsWith('#') && line.includes('='))
      .map(line => {
        const separator = line.indexOf('=');
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, '$2'),
        ];
      })
  );
  if (values.APP_ENV && values.APP_ENV !== 'testing') throw new Error('.env.testing must set APP_ENV=testing');
  if ((values.DB_DATABASE || values.DATABASE_DATABASE) !== project.testDatabase)
    throw new Error('Testing database does not match the registered test database');
  return values;
}

function projectTestCommand(parameters) {
  exactObject(parameters, ['runId', 'projectId', 'runner', 'target', 'filter'], ['runId', 'projectId', 'runner']);
  if (!/^[0-9a-f-]{36}$/i.test(parameters.runId)) throw new Error('Invalid run ID');
  const project = registeredProject(parameters.projectId);
  const recipe = PROJECT_RECIPES[parameters.runner];
  if (!recipe || !project.permittedTasks?.includes(parameters.runner))
    throw new Error('Project recipe is not registered');
  if (!project.runAsUser || !/^[a-z_][a-z0-9_.-]{0,31}$/i.test(project.runAsUser))
    throw new Error('Project execution user is invalid');
  const root = fs.realpathSync(project.rootPath);
  let target = null;
  if (parameters.target) {
    if (typeof parameters.target !== 'string' || path.isAbsolute(parameters.target) || parameters.target.includes('\0'))
      throw new Error('Test target must be a relative project path');
    const resolved = fs.realpathSync(path.resolve(root, parameters.target));
    if (!(resolved === root || resolved.startsWith(`${root}${path.sep}`)))
      throw new Error('Test target escapes project root');
    target = path.relative(root, resolved) || '.';
  }
  if (recipe.target && !target && !project.allowFullSuite) throw new Error('A target is required for this project');
  if (!recipe.target && target) throw new Error('This recipe does not accept a target');
  if (
    parameters.filter &&
    (typeof parameters.filter !== 'string' ||
      !parameters.filter.trim() ||
      parameters.filter.length > 256 ||
      /[\0\r\n]/.test(parameters.filter))
  )
    throw new Error('Invalid test filter');
  const argv = [...recipe.argv];
  if (target) argv.push(target);
  if (parameters.filter) {
    if (recipe.filter) argv.push(recipe.filter, parameters.filter);
    else if (recipe.filterSeparator) argv.push('--', parameters.filter);
    else throw new Error('This recipe does not accept a filter');
  }
  const testing = recipe.laravel ? parseTestingEnvironment(project, root) : {};
  return { project, root, argv, testing };
}

function gitPath(repo, value) {
  if (typeof value !== 'string' || !value || value.startsWith('-') || path.isAbsolute(value) || value.includes('\0'))
    throw new Error('Git paths must be non-option relative paths');
  const resolved = path.resolve(repo, value);
  if (!(resolved === repo || resolved.startsWith(`${repo}${path.sep}`))) throw new Error('Git path escapes repository');
  return path.relative(repo, resolved) || '.';
}

function gitRef(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(value) || value.includes('..'))
    throw new Error('Invalid Git ref');
  return value;
}

function projectGitCommand(parameters) {
  exactObject(parameters, ['projectId', 'action', 'args'], ['projectId', 'action']);
  const project = registeredProject(parameters.projectId);
  const repo = fs.realpathSync(project.repoPath);
  if (!GIT_ALLOWED_REPOS.has(repo)) throw new Error('Project repository exceeds the broker Git ceiling');
  if (!project.runAsUser || !projectUsers().has(project.runAsUser))
    throw new Error('Project execution user is invalid');
  const permitted = project.permittedGitActions || ['status', 'diff', 'log', 'branch'];
  if (!permitted.includes(parameters.action)) throw new Error('Git recipe is not registered for this project');
  const args = parameters.args || {};
  const argv = [
    'git',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.pager=cat',
    '-c',
    'credential.helper=',
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'protocol.file.allow=never',
    '-c',
    'core.sshCommand=/usr/bin/ssh -F /dev/null -oBatchMode=yes -oStrictHostKeyChecking=yes -oForwardAgent=no -oClearAllForwardings=yes -oPermitLocalCommand=no -oRequestTTY=no',
    '-C',
    repo,
  ];
  if (parameters.action === 'status') {
    exactObject(args, [], []);
    argv.push('status', '--short', '--');
  } else if (parameters.action === 'diff') {
    exactObject(args, [], []);
    argv.push('diff', '--no-ext-diff', '--');
  } else if (parameters.action === 'log') {
    exactObject(args, ['n'], []);
    const count = Number(args.n || 10);
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('Git log count must be 1-100');
    argv.push('log', '-n', String(count), '--oneline', '--');
  } else if (parameters.action === 'branch') {
    exactObject(args, [], []);
    argv.push('branch', '--list');
  } else if (parameters.action === 'add') {
    exactObject(args, ['files']);
    if (!Array.isArray(args.files) || !args.files.length || args.files.length > 100)
      throw new Error('Git add requires 1-100 paths');
    const files = args.files.map(value => gitPath(repo, value));
    if (files.includes('.') && project.allowWholeRepoStage !== true)
      throw new Error('Whole-repository staging is not registered');
    argv.push('add', '--', ...files);
  } else if (parameters.action === 'checkout') {
    exactObject(args, ['branch', 'file', 'create'], []);
    if (Boolean(args.branch) === Boolean(args.file)) throw new Error('Checkout requires exactly one branch or file');
    if (args.branch) argv.push('switch', ...(args.create === true ? ['-c'] : []), gitRef(args.branch));
    else argv.push('checkout', '--', gitPath(repo, args.file));
  } else if (parameters.action === 'commit') {
    exactObject(args, ['message']);
    if (
      typeof args.message !== 'string' ||
      !args.message.trim() ||
      args.message.length > 2000 ||
      /[\r\n\0]/.test(args.message)
    )
      throw new Error('Commit message must be a single line of at most 2000 characters');
    argv.push('commit', '-m', args.message, '--');
  } else if (parameters.action === 'pull') {
    exactObject(args, [], []);
    argv.push('pull', '--ff-only');
  } else if (parameters.action === 'push') {
    exactObject(args, [], []);
    argv.push('push');
  } else {
    throw new Error('Unknown Git recipe');
  }
  return { project, repo, argv };
}

const operations = {
  async 'broker.health'(parameters) {
    exactObject(parameters, [], []);
    const database = new DatabaseSync(STATE_DATABASE, { readOnly: true });
    try {
      const migrations = database.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
      const projects = database
        .prepare('SELECT id, payload FROM projects')
        .all()
        .map(row => ({ id: row.id, ...JSON.parse(row.payload) }));
      const invalidProjectUsers = projects
        .filter(project => !project.runAsUser || !projectUsers().has(project.runAsUser))
        .map(project => project.id);
      const stateStat = fs.statSync(STATE_DATABASE);
      return {
        healthy: migrations.some(item => item.version >= 3) && invalidProjectUsers.length === 0,
        migrations,
        projectCount: projects.length,
        invalidProjectUsers,
        stateMode: (stateStat.mode & 0o777).toString(8).padStart(4, '0'),
        stateWritable: fs.accessSync(path.dirname(STATE_DATABASE), fs.constants.W_OK) === undefined,
        stateKeyRotation:
          database.prepare("SELECT value FROM state_meta WHERE key = 'state_key_rotation'").get()?.value || null,
      };
    } finally {
      database.close();
    }
  },
  async 'oauth.user.list'(parameters) {
    exactObject(parameters, [], []);
    return getOAuthUsers();
  },
  async 'oauth.user.add'(parameters) {
    exactObject(
      parameters,
      [
        'username',
        'password',
        'email',
        'groups',
        'linuxUser',
        'role',
        'scopes',
        'requireApproval',
        'projectIds',
        'organizationId',
        'teamId',
        'clients',
        'authorizationVersion',
      ],
      ['username', 'password', 'email']
    );
    return addOAuthUser(parameters);
  },
  async 'oauth.user.update'(parameters) {
    exactObject(parameters, ['username', 'updates']);
    exactObject(
      parameters.updates,
      [
        'password',
        'email',
        'groups',
        'linuxUser',
        'role',
        'scopes',
        'requireApproval',
        'projectIds',
        'organizationId',
        'teamId',
        'clients',
        'authorizationVersion',
      ],
      []
    );
    return updateOAuthUser(parameters.username, parameters.updates);
  },
  async 'oauth.user.delete'(parameters) {
    exactObject(parameters, ['username']);
    return deleteOAuthUser(parameters.username);
  },
  async 'oauth.client.list'(parameters) {
    exactObject(parameters, [], []);
    return getOAuthClients();
  },
  async 'oauth.client.add'(parameters) {
    exactObject(parameters, ['clientId', 'clientName', 'redirectUris'], ['redirectUris']);
    return addOAuthClient(parameters);
  },
  async 'oauth.client.delete'(parameters) {
    exactObject(parameters, ['clientId']);
    return deleteOAuthClient(parameters.clientId);
  },
  async 'oauth.health'(parameters) {
    exactObject(parameters, [], []);
    return getAutheliaHealth();
  },
  async 'project.file.read'(parameters) {
    exactObject(parameters, ['projectId', 'path', 'maxBytes'], ['projectId', 'path']);
    const location = projectFileTarget(parameters.projectId, parameters.path);
    if (!location.stat.isFile()) throw new Error('Project read target must be a regular file');
    const maxBytes = Math.min(Math.max(Number(parameters.maxBytes || 1024 * 1024), 1), MAX_PROJECT_FILE_BYTES);
    const descriptor = fs.openSync(location.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const bytes = Math.min(location.stat.size, maxBytes);
      const buffer = Buffer.alloc(bytes);
      fs.readSync(descriptor, buffer, 0, bytes, 0);
      return {
        projectId: location.project.id,
        path: location.relativePath,
        content: buffer.toString('utf8'),
        size: location.stat.size,
        readBytes: bytes,
        truncated: location.stat.size > bytes,
      };
    } finally {
      fs.closeSync(descriptor);
    }
  },
  async 'project.file.write'(parameters) {
    exactObject(parameters, ['projectId', 'path', 'content', 'mode'], ['projectId', 'path', 'content']);
    if (typeof parameters.content !== 'string') throw new Error('Project file content must be a string');
    if (!['overwrite', 'append'].includes(parameters.mode || 'overwrite'))
      throw new Error('Invalid project write mode');
    const location = projectFileTarget(parameters.projectId, parameters.path, { mustExist: false });
    if (location.stat && !location.stat.isFile()) throw new Error('Project write target must be a regular file');
    let content = parameters.content;
    if (parameters.mode === 'append' && location.stat) {
      if (location.stat.size + Buffer.byteLength(content) > MAX_PROJECT_FILE_BYTES)
        throw new Error('Project file exceeds the mutation limit');
      const descriptor = fs.openSync(location.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        content = `${fs.readFileSync(descriptor, 'utf8')}${content}`;
      } finally {
        fs.closeSync(descriptor);
      }
    }
    atomicProjectWrite(location, content);
    return {
      ...projectFileInfo(projectFileTarget(parameters.projectId, parameters.path)),
      mode: parameters.mode || 'overwrite',
    };
  },
  async 'project.file.delete'(parameters) {
    exactObject(parameters, ['projectId', 'path', 'recursive'], ['projectId', 'path']);
    const location = projectFileTarget(parameters.projectId, parameters.path);
    if (location.stat.isDirectory()) {
      if (parameters.recursive !== true) fs.rmdirSync(location.target);
      else {
        if (location.project.allowRecursiveDelete !== true)
          throw new Error('Recursive deletion is not registered for this project');
        fs.rmSync(location.target, { recursive: true, force: false });
      }
    } else if (location.stat.isFile()) fs.unlinkSync(location.target);
    else throw new Error('Project delete target must be a regular file or directory');
    return { projectId: location.project.id, deleted: location.relativePath };
  },
  async 'project.file.list'(parameters) {
    exactObject(parameters, ['projectId', 'path', 'showHidden'], ['projectId', 'path']);
    const location = projectFileTarget(parameters.projectId, parameters.path, { allowRoot: true });
    if (!location.stat.isDirectory()) throw new Error('Project list target must be a directory');
    const entries = fs
      .readdirSync(location.target, { withFileTypes: true })
      .filter(entry => parameters.showHidden === true || !entry.name.startsWith('.'))
      .slice(0, 10_000)
      .map(entry => {
        const stat = fs.lstatSync(path.join(location.target, entry.name));
        return {
          name: entry.name,
          type: entry.isSymbolicLink()
            ? 'symlink'
            : entry.isDirectory()
              ? 'directory'
              : entry.isFile()
                ? 'file'
                : 'other',
          size: stat.size,
          permissions: (stat.mode & 0o777).toString(8),
          ownerUid: stat.uid,
          modifiedAt: stat.mtime.toISOString(),
        };
      });
    return { projectId: location.project.id, path: location.relativePath, count: entries.length, entries };
  },
  async 'project.file.info'(parameters) {
    exactObject(parameters, ['projectId', 'path']);
    return projectFileInfo(projectFileTarget(parameters.projectId, parameters.path, { allowRoot: true }));
  },
  async 'project.file.move'(parameters) {
    exactObject(parameters, ['projectId', 'source', 'destination']);
    const source = projectFileTarget(parameters.projectId, parameters.source);
    const destination = projectFileTarget(parameters.projectId, parameters.destination, { mustExist: false });
    if (!source.stat.isFile()) throw new Error('Only regular project files can be moved');
    if (destination.stat) throw new Error('Project move destination already exists');
    fs.renameSync(source.target, destination.target);
    return { projectId: source.project.id, from: source.relativePath, to: destination.relativePath };
  },
  async 'project.file.copy'(parameters) {
    exactObject(parameters, ['projectId', 'source', 'destination']);
    const source = projectFileTarget(parameters.projectId, parameters.source);
    const destination = projectFileTarget(parameters.projectId, parameters.destination, { mustExist: false });
    if (!source.stat.isFile()) throw new Error('Only regular project files can be copied');
    if (destination.stat) throw new Error('Project copy destination already exists');
    if (source.stat.size > MAX_PROJECT_FILE_BYTES) throw new Error('Project file exceeds the copy limit');
    const descriptor = fs.openSync(source.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      atomicProjectWrite(destination, fs.readFileSync(descriptor, 'utf8'));
    } finally {
      fs.closeSync(descriptor);
    }
    return { projectId: source.project.id, from: source.relativePath, to: destination.relativePath };
  },
  async 'project.file.search'(parameters) {
    exactObject(
      parameters,
      ['projectId', 'path', 'pattern', 'fileType', 'maxResults'],
      ['projectId', 'path', 'pattern']
    );
    const location = projectFileTarget(parameters.projectId, parameters.path, { allowRoot: true });
    if (!location.stat.isDirectory()) throw new Error('Project search target must be a directory');
    if (typeof parameters.pattern !== 'string' || !/^[A-Za-z0-9*?._-]{1,128}$/.test(parameters.pattern))
      throw new Error('Invalid project search pattern');
    if (parameters.fileType && !['file', 'directory'].includes(parameters.fileType))
      throw new Error('Invalid project search file type');
    const expression = new RegExp(
      `^${parameters.pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replaceAll('*', '.*')
        .replaceAll('?', '.')}$`
    );
    const limit = Math.min(Math.max(Number(parameters.maxResults || 50), 1), 500);
    const results = [];
    const walk = (directory, depth) => {
      if (depth > 10 || results.length >= limit) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(directory, entry.name);
        if (
          expression.test(entry.name) &&
          (!parameters.fileType || (parameters.fileType === 'file' ? entry.isFile() : entry.isDirectory()))
        )
          results.push(path.relative(location.root, full));
        if (entry.isDirectory() && entry.name !== '.git') walk(full, depth + 1);
        if (results.length >= limit) break;
      }
    };
    walk(location.target, 0);
    return { projectId: location.project.id, results, count: results.length };
  },
  async 'config.apply'(parameters) {
    exactObject(parameters, ['configId', 'content', 'healthCheckTimeout'], ['configId', 'content']);
    return applyRegisteredConfig(
      registeredConfig(parameters.configId),
      parameters.content,
      parameters.healthCheckTimeout
    );
  },
  async 'config.backups'(parameters) {
    exactObject(parameters, ['configId']);
    const config = registeredConfig(parameters.configId);
    const directory = path.join(CONFIG_BACKUP_ROOT, config.id);
    let files = [];
    try {
      files = fs.readdirSync(directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const backups = files
      .filter(name => /^\d+\.json$/.test(name))
      .map(name => {
        const timestamp = name.slice(0, -5);
        const stat = fs.statSync(path.join(directory, `${timestamp}.bak`));
        return { timestamp, date: new Date(Number(timestamp)).toISOString(), bytes: stat.size };
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return { configId: config.id, backups };
  },
  async 'config.restore'(parameters) {
    exactObject(parameters, ['configId', 'timestamp']);
    const config = registeredConfig(parameters.configId);
    if (typeof parameters.timestamp !== 'string' || !/^\d{10,16}$/.test(parameters.timestamp))
      throw new Error('Invalid configuration backup timestamp');
    const backup = path.join(CONFIG_BACKUP_ROOT, config.id, `${parameters.timestamp}.bak`);
    const content = fs.readFileSync(backup, 'utf8');
    return applyRegisteredConfig(config, content, 30);
  },
  async 'user.list'(parameters) {
    exactObject(parameters, ['includeSystem'], []);
    const uidMin = Number(fs.readFileSync('/etc/login.defs', 'utf8').match(/^UID_MIN\s+(\d+)/m)?.[1] || 1000);
    const allowed = new Set([...MANAGED_USERS, ...projectUsers()]);
    const users = fs
      .readFileSync('/etc/passwd', 'utf8')
      .trim()
      .split('\n')
      .map(line => {
        const [username, , uid, gid, comment, home, shell] = line.split(':');
        return { username, uid: Number(uid), gid: Number(gid), comment, home, shell, is_system: Number(uid) < uidMin };
      })
      .filter(user => allowed.has(user.username) && (parameters.includeSystem || !user.is_system));
    return { users, count: users.length };
  },
  async 'user.info'(parameters) {
    exactObject(parameters, ['username']);
    const username = managedUsername(parameters.username);
    const user = passwdRecord(username);
    const [id, groups, lastlog] = await Promise.all([
      execute('id', ['--', username]),
      execute('id', ['-nG', '--', username]),
      execute('lastlog', ['-u', username]).catch(error => error.result),
    ]);
    let sshKeyCount = 0;
    try {
      sshKeyCount = fs.readFileSync(authorizedKeysPath(username).file, 'utf8').split('\n').filter(Boolean).length;
    } catch {}
    return { ...user, id: id.stdout, groups: groups.stdout, lastLogin: lastlog.stdout, sshKeyCount };
  },
  async 'user.create'(parameters) {
    exactObject(parameters, ['username', 'groups', 'shell', 'comment', 'createHome'], ['username']);
    const username = validUsername(parameters.username);
    if (!MANAGED_USERS.has(username)) throw new Error('New user is not registered with the broker');
    try {
      passwdRecord(username);
      throw new Error('Managed user already exists');
    } catch (error) {
      if (error.message !== 'Managed user does not exist') throw error;
    }
    const groups = validateGroups(parameters.groups);
    const shell = parameters.shell || '/usr/sbin/nologin';
    if (!ALLOWED_SHELLS.has(shell)) throw new Error('Login shell is not registered with the broker');
    if (
      parameters.comment &&
      (typeof parameters.comment !== 'string' || parameters.comment.length > 128 || /[\r\n:]/.test(parameters.comment))
    )
      throw new Error('Invalid user comment');
    const argv = [parameters.createHome === false ? '-M' : '-m', '-s', shell];
    if (groups.length) argv.push('-G', groups.join(','));
    if (parameters.comment) argv.push('-c', parameters.comment);
    argv.push('--', username);
    await execute('useradd', argv);
    return passwdRecord(username);
  },
  async 'user.delete'(parameters) {
    exactObject(parameters, ['username', 'removeHome']);
    const username = managedUsername(parameters.username);
    if (parameters.removeHome) throw new Error('Managed home deletion requires an offline recovery workflow');
    await execute('userdel', ['--', username]);
    return { username, deleted: true, homeRemoved: false };
  },
  async 'user.password'(parameters) {
    exactObject(parameters, ['username', 'password']);
    const username = managedUsername(parameters.username);
    if (
      typeof parameters.password !== 'string' ||
      parameters.password.length < 12 ||
      parameters.password.length > 1024 ||
      /[\r\n\0:]/.test(parameters.password)
    )
      throw new Error('Password does not satisfy broker policy');
    await executeWithInput('chpasswd', [], `${username}:${parameters.password}`);
    return { username, updated: true };
  },
  async 'user.modify'(parameters) {
    exactObject(
      parameters,
      ['username', 'addGroups', 'removeGroups', 'shell', 'lockAccount', 'unlockAccount', 'expireDate'],
      ['username']
    );
    const username = managedUsername(parameters.username);
    if (parameters.lockAccount && parameters.unlockAccount) throw new Error('Cannot lock and unlock simultaneously');
    const results = [];
    const addGroups = validateGroups(parameters.addGroups);
    const removeGroups = validateGroups(parameters.removeGroups);
    if (addGroups.length) {
      await execute('usermod', ['-aG', addGroups.join(','), '--', username]);
      results.push('groups-added');
    }
    if (removeGroups.length) {
      const current = (await execute('id', ['-nG', '--', username])).stdout.split(/\s+/);
      const remaining = current.filter(group => group !== username && !removeGroups.includes(group));
      await execute('usermod', ['-G', remaining.join(','), '--', username]);
      results.push('groups-removed');
    }
    if (parameters.shell) {
      if (!ALLOWED_SHELLS.has(parameters.shell)) throw new Error('Login shell is not registered with the broker');
      await execute('usermod', ['-s', parameters.shell, '--', username]);
      results.push('shell');
    }
    if (parameters.lockAccount) {
      await execute('usermod', ['-L', '--', username]);
      results.push('locked');
    }
    if (parameters.unlockAccount) {
      await execute('usermod', ['-U', '--', username]);
      results.push('unlocked');
    }
    if (parameters.expireDate !== undefined) {
      if (parameters.expireDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(parameters.expireDate))
        throw new Error('Invalid account expiry');
      await execute('usermod', ['-e', parameters.expireDate, '--', username]);
      results.push('expiry');
    }
    return { username, changes: results };
  },
  async 'user.ssh'(parameters) {
    exactObject(parameters, ['username', 'action', 'publicKey', 'keyIndex'], ['username', 'action']);
    const username = managedUsername(parameters.username);
    if (!['list', 'add', 'remove'].includes(parameters.action)) throw new Error('Invalid SSH key action');
    const target = authorizedKeysPath(username);
    if (parameters.action === 'list') {
      let keys = [];
      try {
        keys = fs
          .readFileSync(target.file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((key, index) => ({
            index,
            type: key.split(/\s+/)[0],
            fingerprint: crypto
              .createHash('sha256')
              .update(Buffer.from(key.split(/\s+/)[1], 'base64'))
              .digest('base64'),
          }));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return { username, keys, count: keys.length };
    }
    fs.mkdirSync(target.sshDirectory, { recursive: true, mode: 0o700 });
    const directory = fs.lstatSync(target.sshDirectory);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Unsafe .ssh directory');
    let keys = [];
    try {
      keys = fs.readFileSync(target.file, 'utf8').split('\n').filter(Boolean);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (parameters.action === 'add') keys.push(validatePublicKey(parameters.publicKey));
    else {
      if (!Number.isInteger(parameters.keyIndex) || parameters.keyIndex < 0 || parameters.keyIndex >= keys.length)
        throw new Error('SSH key index not found');
      keys.splice(parameters.keyIndex, 1);
    }
    const temporary = path.join(target.sshDirectory, `.authorized_keys.${process.pid}.tmp`);
    fs.writeFileSync(temporary, `${keys.join('\n')}${keys.length ? '\n' : ''}`, { mode: 0o600, flag: 'wx' });
    fs.chownSync(temporary, target.user.uid, target.user.gid);
    fs.renameSync(temporary, target.file);
    fs.chmodSync(target.sshDirectory, 0o700);
    fs.chownSync(target.sshDirectory, target.user.uid, target.user.gid);
    return { username, action: parameters.action, count: keys.length };
  },
  async 'process.signal'(parameters) {
    exactObject(parameters, ['pid', 'signal', 'owner'], ['pid', 'signal']);
    const pid = Number(parameters.pid);
    if (!Number.isInteger(pid) || pid <= 1) throw new Error('Invalid process ID');
    if (!['TERM', 'KILL', 'HUP', 'INT', 'USR1', 'USR2'].includes(parameters.signal))
      throw new Error('Invalid process signal');
    if (parameters.owner !== undefined && parameters.owner !== null) {
      if (typeof parameters.owner !== 'string' || !/^[a-z_][a-z0-9_.-]{0,31}$/i.test(parameters.owner))
        throw new Error('Invalid process owner');
      const [{ stdout: expectedUid }, status] = await Promise.all([
        execute('id', ['-u', parameters.owner]),
        fs.promises.readFile(`/proc/${pid}/status`, 'utf8'),
      ]);
      const actualUid = status.match(/^Uid:\s+(\d+)/m)?.[1];
      if (!actualUid || actualUid !== expectedUid.trim()) throw new Error('Process does not belong to the mapped user');
    }
    process.kill(pid, `SIG${parameters.signal}`);
    return { pid, signal: parameters.signal };
  },
  async 'project.test'(parameters) {
    const { project, root, argv } = projectTestCommand(parameters);
    const unit = `mcp-project-test-${parameters.runId}`;
    const environment = {
      APP_ENV: 'testing',
      NODE_ENV: 'test',
      CI: 'true',
    };
    const systemdArguments = [
      '--quiet',
      '--wait',
      '--pipe',
      '--collect',
      `--unit=${unit}`,
      '--service-type=exec',
      `--uid=${project.runAsUser}`,
      `--working-directory=${root}`,
      '--property=KillMode=control-group',
      '--property=MemoryMax=1G',
      '--property=CPUQuota=100%',
      '--property=TasksMax=256',
      '--property=RuntimeMaxSec=900',
      ...projectSandboxProperties(project, root),
      ...Object.entries(environment).map(([key, value]) => `--setenv=${key}=${value}`),
      '--',
      ...argv,
    ];
    try {
      return await execute('systemd-run', systemdArguments, 910_000);
    } catch (error) {
      return error.result;
    }
  },
  async 'project.cancel'(parameters) {
    exactObject(parameters, ['runId']);
    if (!/^[0-9a-f-]{36}$/i.test(parameters.runId)) throw new Error('Invalid run ID');
    return execute('systemctl', ['stop', '--', `mcp-project-test-${parameters.runId}.service`], 10_000);
  },
  async 'project.git'(parameters) {
    const { project, repo, argv } = projectGitCommand(parameters);
    const user = passwdRecord(project.runAsUser);
    const networkAction = ['pull', 'push'].includes(parameters.action);
    const unit = `mcp-project-git-${crypto.randomUUID()}`;
    const systemdArguments = [
      '--quiet',
      '--wait',
      '--pipe',
      '--collect',
      `--unit=${unit}`,
      '--service-type=exec',
      `--uid=${project.runAsUser}`,
      `--working-directory=${repo}`,
      '--property=KillMode=control-group',
      '--property=MemoryMax=1G',
      '--property=CPUQuota=100%',
      '--property=TasksMax=256',
      '--property=RuntimeMaxSec=120',
      ...projectSandboxProperties(project, repo, { allowNetwork: networkAction }),
      `--setenv=HOME=${user.home}`,
      '--setenv=GIT_CONFIG_NOSYSTEM=1',
      '--setenv=GIT_TERMINAL_PROMPT=0',
      '--setenv=GIT_ASKPASS=/bin/false',
      '--',
      ...argv,
    ];
    const result = await execute('systemd-run', systemdArguments, networkAction ? 125_000 : 35_000).catch(
      error => error.result
    );
    return { projectId: project.id, action: parameters.action, ...result };
  },
  async 'service.action'(parameters) {
    exactObject(parameters, ['service', 'action']);
    const service = serviceName(parameters.service);
    const actions = new Set(['start', 'stop', 'restart', 'reload', 'status', 'is-active']);
    if (!actions.has(parameters.action)) throw new Error('Unsupported service action');
    if (PROTECTED_SERVICES.has(service) && ['stop', 'restart'].includes(parameters.action))
      throw new Error('Protected services require the recovery workflow');
    return execute('systemctl', [parameters.action, '--', service]);
  },
  async 'service.status'(parameters) {
    exactObject(parameters, ['service']);
    const service = serviceName(parameters.service);
    const [active, enabled, status] = await Promise.all([
      execute('systemctl', ['is-active', '--', service]).catch(error => error.result),
      execute('systemctl', ['is-enabled', '--', service]).catch(error => error.result),
      execute('systemctl', ['status', '--no-pager', '-l', '--', service]).catch(error => error.result),
    ]);
    return { service, active: active.stdout, enabled: enabled.stdout, status: status.stdout || status.stderr };
  },
  async 'service.list'(parameters) {
    exactObject(parameters, ['state'], []);
    const argv = ['list-units', '--type=service', '--no-pager', '--all', '--plain'];
    if (parameters.state) {
      if (!/^[a-z-]{1,32}$/.test(parameters.state)) throw new Error('Invalid service state');
      argv.push(`--state=${parameters.state}`);
    }
    return execute('systemctl', argv, 15_000);
  },
  async 'journal.read'(parameters) {
    exactObject(parameters, ['service', 'lines', 'since', 'priority'], []);
    const argv = ['--no-pager', '--output=short-iso', '-n', String(Math.min(Number(parameters.lines || 50), 500))];
    if (parameters.service) argv.push('-u', serviceName(parameters.service));
    if (parameters.since) {
      if (typeof parameters.since !== 'string' || !/^[0-9A-Za-z :.-]{1,64}$/.test(parameters.since))
        throw new Error('Invalid journal time bound');
      argv.push('--since', parameters.since);
    }
    if (parameters.priority) {
      if (!['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'].includes(parameters.priority))
        throw new Error('Invalid journal priority');
      argv.push('-p', parameters.priority);
    }
    return execute('journalctl', argv, 20_000);
  },
  async 'firewall.status'(parameters) {
    exactObject(parameters, [], []);
    return execute('ufw', ['status', 'verbose'], 15_000);
  },
  async 'firewall.rule'(parameters) {
    exactObject(parameters, ['action', 'port', 'protocol', 'rule'], ['action', 'port', 'protocol']);
    const port = Number(parameters.port);
    if (!FIREWALL_PORTS.has(port)) throw new Error('Firewall port is not registered with the broker');
    if (!['tcp', 'udp'].includes(parameters.protocol)) throw new Error('Invalid firewall protocol');
    if (!['allow', 'deny', 'delete'].includes(parameters.action)) throw new Error('Unsupported firewall action');
    if (MANAGEMENT_PORTS.has(port) && parameters.action !== 'allow')
      throw new Error('Management connectivity rules cannot be removed or denied');
    const rollbackId = crypto.randomUUID();
    const snapshot = path.join(FIREWALL_SNAPSHOT_ROOT, rollbackId);
    fs.mkdirSync(FIREWALL_SNAPSHOT_ROOT, { recursive: true, mode: 0o700 });
    fs.cpSync('/etc/ufw', snapshot, { recursive: true, dereference: false, errorOnExist: true });
    const rollbackUnit = `mcp-firewall-rollback-${rollbackId}`;
    await execute('systemd-run', [
      '--quiet',
      `--unit=${rollbackUnit}`,
      '--on-active=60s',
      '--property=NoNewPrivileges=yes',
      '--property=PrivateTmp=yes',
      '--property=ProtectSystem=strict',
      '--property=ReadWritePaths=/etc/ufw /var/lib/mcp-sentinel/firewall-snapshots',
      '--',
      '/usr/bin/node',
      FIREWALL_ROLLBACK_SCRIPT,
      rollbackId,
    ]);
    const argv =
      parameters.action === 'delete'
        ? ['delete', parameters.rule === 'deny' ? 'deny' : 'allow', `${port}/${parameters.protocol}`]
        : [parameters.action, `${port}/${parameters.protocol}`];
    try {
      const result = await execute('ufw', argv, 15_000);
      return { ...result, rollbackId, rollbackAt: new Date(Date.now() + 60_000).toISOString() };
    } catch (error) {
      await execute('systemctl', ['start', '--', `${rollbackUnit}.service`]).catch(() => {});
      throw error;
    }
  },
  async 'firewall.confirm'(parameters) {
    exactObject(parameters, ['rollbackId']);
    if (!/^[0-9a-f-]{36}$/i.test(parameters.rollbackId)) throw new Error('Invalid firewall rollback ID');
    const unit = `mcp-firewall-rollback-${parameters.rollbackId}`;
    await execute('systemctl', ['stop', '--', `${unit}.timer`]).catch(() => {});
    await execute('systemctl', ['stop', '--', `${unit}.service`]).catch(() => {});
    fs.rmSync(path.join(FIREWALL_SNAPSHOT_ROOT, parameters.rollbackId), { recursive: true, force: true });
    return { rollbackId: parameters.rollbackId, confirmed: true };
  },
};

export async function handleRequest(request) {
  exactObject(request, ['requestId', 'operation', 'parameters']);
  if (typeof request.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(request.requestId))
    throw new Error('Invalid request ID');
  if (typeof request.operation !== 'string' || !(request.operation in operations)) throw new Error('Unknown operation');
  return { requestId: request.requestId, result: await operations[request.operation](request.parameters) };
}

export function startBroker() {
  fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true, mode: 0o750 });
  try {
    const stat = fs.lstatSync(SOCKET_PATH);
    if (!stat.isSocket()) throw new Error('Broker socket path exists and is not a socket');
    fs.unlinkSync(SOCKET_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const server = net.createServer(socket => {
    let request = '';
    let handled = false;
    socket.setEncoding('utf8');
    const respond = async () => {
      if (handled) return;
      handled = true;
      let response;
      try {
        const parsed = JSON.parse(request.trim());
        const result = await handleRequest(parsed);
        response = { requestId: result.requestId, ok: true, result: result.result };
      } catch (error) {
        let requestId = null;
        try {
          requestId = JSON.parse(request.trim()).requestId || null;
        } catch {}
        response = { requestId, ok: false, error: error.message };
      }
      socket.end(`${JSON.stringify(response)}\n`);
    };
    socket.on('data', chunk => {
      request += chunk;
      if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) socket.destroy(new Error('Request too large'));
      else if (request.includes('\n')) respond();
    });
    socket.on('end', respond);
  });

  server.listen(SOCKET_PATH, () => fs.chmodSync(SOCKET_PATH, 0o660));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) startBroker();
