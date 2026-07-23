#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { parseEnvironment } from '../lib/deployment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, '..');
const rootPrefix = path.resolve(process.env.MCP_PREFLIGHT_ROOT || '/');
const expectedProjectId = '436b432a-206b-43cd-abfa-6291dbef0c50';
const expectedProjectRoot = '/var/www/vhosts/rabeeb.com/httpdocs';
const expectedProjectUser = 'rabeeb.com_07v7ld45234';
const checks = [];

function hostPath(absolutePath) {
  if (!path.isAbsolute(absolutePath)) throw new Error('Preflight paths must be absolute');
  return rootPrefix === '/' ? absolutePath : path.join(rootPrefix, absolutePath.slice(1));
}

function record(id, status, detail) {
  checks.push({ id, status, detail });
}

function attempt(id, callback, failure = 'fail') {
  try {
    const detail = callback();
    record(id, 'pass', detail || 'Verified');
  } catch (error) {
    record(id, failure, error.message);
  }
}

function assertModeOwner(absolutePath, expectedMode, uid, gid, type = 'file') {
  const target = hostPath(absolutePath);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`${absolutePath} must not be a symbolic link`);
  if (type === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new Error(`${absolutePath} must be a ${type}`);
  const mode = stat.mode & 0o777;
  if (mode !== expectedMode)
    throw new Error(`${absolutePath} mode is ${mode.toString(8)}, expected ${expectedMode.toString(8)}`);
  if (stat.uid !== uid || stat.gid !== gid)
    throw new Error(`${absolutePath} ownership is ${stat.uid}:${stat.gid}, expected ${uid}:${gid}`);
  return target;
}

function account(name) {
  const entry = fs
    .readFileSync(hostPath('/etc/passwd'), 'utf8')
    .split('\n')
    .find(line => line.startsWith(`${name}:`));
  if (!entry) throw new Error(`System account '${name}' does not exist`);
  const fields = entry.split(':');
  return { uid: Number(fields[2]), gid: Number(fields[3]), home: fields[5], shell: fields[6] };
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function requireUrl(value, name, expectedProtocol = 'https:') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== expectedProtocol || url.username || url.password)
    throw new Error(`${name} must use ${expectedProtocol}`);
  return url;
}

function inspectUnits() {
  const units = [
    'authelia.service',
    'mcp-sentinel.service',
    'mcp-sentinel-broker.service',
    'mcp-sentinel-state-backup.service',
    'mcp-sentinel-state-backup.timer',
    'mcp-sentinel-audit-verify.service',
    'mcp-sentinel-audit-verify.timer',
  ];
  for (const unit of units) {
    const source = path.join(repositoryRoot, 'deploy', unit);
    const installed = hostPath(`/etc/systemd/system/${unit}`);
    if (!fs.existsSync(installed)) throw new Error(`${unit} is not installed`);
    if (sha256(source) !== sha256(installed)) throw new Error(`${unit} does not match the reviewed release unit`);
  }
  return `${units.length} reviewed systemd units are installed`;
}

function inspectCredentials() {
  const values = new Set();
  for (const name of ['state-key', 'audit-key', 'jwt-key', 'state-backup-key']) {
    const file = assertModeOwner(`/etc/mcp-sentinel/credentials/${name}`, 0o600, 0, 0);
    const value = fs.readFileSync(file, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${name} must contain exactly 32 bytes encoded as hexadecimal`);
    if (values.has(value)) throw new Error(`${name} must be independent from every other credential`);
    values.add(value);
  }
  return 'Four independent protected credentials are present';
}

function inspectPublicEnvironment() {
  const file = assertModeOwner('/etc/mcp-sentinel/environment', 0o600, 0, 0);
  const environment = parseEnvironment(fs.readFileSync(file, 'utf8'));
  const forbidden = Object.keys(environment).filter(key => /(?:SECRET|PASSWORD|API_KEY|TOKEN)$/i.test(key));
  if (forbidden.length) throw new Error(`Environment file contains secret-bearing keys: ${forbidden.join(', ')}`);
  if (environment.NODE_ENV !== 'production') throw new Error('NODE_ENV must be production');
  if (!['127.0.0.1', '::1'].includes(environment.HOST)) throw new Error('The public API must bind to loopback');
  if (environment.TRUST_PROXY !== 'true') throw new Error('TRUST_PROXY must be true behind Nginx');
  if (!environment.TRUSTED_PROXIES?.includes('127.0.0.1')) throw new Error('TRUSTED_PROXIES must include loopback');
  const resource = requireUrl(environment.OAUTH_RESOURCE_URL, 'OAUTH_RESOURCE_URL');
  requireUrl(environment.AUTHELIA_ISSUER, 'AUTHELIA_ISSUER');
  requireUrl(environment.AUTHELIA_JWKS_URL, 'AUTHELIA_JWKS_URL');
  const origins = (environment.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  if (!origins.length || origins.includes('*')) throw new Error('ALLOWED_ORIGINS must be explicit');
  for (const origin of origins) requireUrl(origin, 'ALLOWED_ORIGINS');
  if (environment.PUBLIC_URL !== resource.toString().replace(/\/$/, ''))
    throw new Error('PUBLIC_URL and canonical OAuth resource must match exactly');
  return `Loopback API with canonical resource ${resource.origin}`;
}

function inspectBrokerEnvironment() {
  const file = assertModeOwner('/etc/mcp-sentinel/broker-environment', 0o600, 0, 0);
  const environment = parseEnvironment(fs.readFileSync(file, 'utf8'));
  const protectedServices = new Set((environment.BROKER_PROTECTED_SERVICES || '').split(','));
  for (const service of ['mcp-sentinel', 'mcp-sentinel-broker', 'ssh', 'sshd', 'nginx', 'authelia'])
    if (!protectedServices.has(service)) throw new Error(`Protected service '${service}' is missing`);
  if (!(environment.BROKER_GIT_ALLOWED_REPOS || '').split(',').includes(expectedProjectRoot))
    throw new Error('The global Git ceiling does not contain the exact Rabeeb repository');
  if (!(environment.BROKER_MANAGED_USERS || '').split(',').includes(expectedProjectUser))
    throw new Error('The Rabeeb execution user is not registered with the broker');
  const managementPorts = new Set((environment.BROKER_MANAGEMENT_PORTS || '').split(','));
  for (const port of ['22', '443'])
    if (!managementPorts.has(port)) throw new Error(`Management port ${port} is not preserved`);
  if (environment.MCP_STATE_DB !== '/var/lib/mcp-sentinel/state.sqlite3')
    throw new Error('Broker and API must share the protected SQLite state');
  return 'Broker allow-lists preserve SSH/HTTPS and the exact Rabeeb boundary';
}

function inspectDatabase(sentinel) {
  const file = assertModeOwner('/var/lib/mcp-sentinel/state.sqlite3', 0o600, sentinel.uid, sentinel.gid);
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = database.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok')
      throw new Error('SQLite integrity check failed');
    const migrations = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
    if (!migrations.some(row => row.version === 6)) throw new Error('Schema migration 6 is not applied');
    const projectRow = database.prepare('SELECT payload FROM projects WHERE id = ?').get(expectedProjectId);
    if (!projectRow) throw new Error('Rabeeb UUID project is missing');
    const project = JSON.parse(projectRow.payload);
    if (
      project.rootPath !== expectedProjectRoot ||
      project.repoPath !== expectedProjectRoot ||
      project.runAsUser !== expectedProjectUser ||
      project.testDatabase !== 'rabeeb_test' ||
      project.allowFullSuite === true
    )
      throw new Error('Rabeeb project registration does not match the production safety boundary');
    const mappingRows = database
      .prepare('SELECT username, payload FROM oauth_mappings')
      .all()
      .map(row => ({ username: row.username, ...JSON.parse(row.payload) }));
    const mapping = mappingRows.find(candidate => candidate.username === 'rabeeb');
    if (
      !mapping ||
      mapping.role !== 'developer' ||
      mapping.requireApproval !== true ||
      mapping.projectIds?.length !== 1 ||
      mapping.projectIds[0] !== expectedProjectId
    )
      throw new Error('Rabeeb OAuth mapping is not least-privileged and project-bound');
    const adminKeys = database
      .prepare('SELECT payload FROM api_keys')
      .all()
      .map(row => JSON.parse(row.payload))
      .filter(key => key.active !== false && key.role === 'admin');
    if (!adminKeys.length) throw new Error('No active stored administrator key remains for recovery');
    return `SQLite integrity, migration 6, Rabeeb project, OAuth mapping, and recovery admin verified`;
  } finally {
    database.close();
  }
}

function inspectRelease() {
  const current = hostPath('/opt/mcp-sentinel/current');
  const stat = fs.lstatSync(current);
  if (!stat.isSymbolicLink()) throw new Error('/opt/mcp-sentinel/current must be an atomic release symlink');
  const resolved = fs.realpathSync(current);
  const releases = `${hostPath('/opt/mcp-sentinel/releases')}${path.sep}`;
  if (!resolved.startsWith(releases))
    throw new Error('Current release resolves outside the versioned release directory');
  if (fs.existsSync(path.join(resolved, '.git'))) throw new Error('Production release must not contain a Git worktree');
  const receiptFile = hostPath('/var/lib/mcp-sentinel/deployment.json');
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  if (
    !/^[a-f0-9]{40}$/i.test(receipt.commit) ||
    !/^[a-f0-9]{64}$/i.test(receipt.sha256) ||
    !receipt.signatureFingerprint
  )
    throw new Error('Deployment receipt lacks signed release provenance');
  const version = JSON.parse(fs.readFileSync(path.join(resolved, 'package.json'), 'utf8')).version;
  if (receipt.version !== version) throw new Error('Deployment receipt version does not match the active release');
  const releaseReceipt = JSON.parse(fs.readFileSync(path.join(resolved, '.release-receipt.json'), 'utf8'));
  for (const field of ['version', 'commit', 'artifact', 'sha256', 'signatureFingerprint'])
    if (receipt[field] !== releaseReceipt[field])
      throw new Error(`Deployment receipt does not match the immutable release field '${field}'`);
  const expectedReleaseId = `${version}-${receipt.commit.slice(0, 12)}`;
  if (path.basename(resolved) !== expectedReleaseId)
    throw new Error('Active release directory does not match its signed version and commit');
  const trustedFingerprintFile = assertModeOwner('/etc/mcp-sentinel/release-signing-fingerprint', 0o600, 0, 0);
  const trustedFingerprint = fs.readFileSync(trustedFingerprintFile, 'utf8').trim().replaceAll(' ', '').toUpperCase();
  if (!/^[A-F0-9]{40}(?:[A-F0-9]{24})?$/.test(trustedFingerprint))
    throw new Error('Trusted release signing fingerprint is malformed');
  if (receipt.signatureFingerprint.toUpperCase() !== trustedFingerprint)
    throw new Error('Active release was not signed by the configured trusted key');
  return `Signed release ${version} at commit ${receipt.commit.slice(0, 12)}`;
}

export function runPreflight() {
  let sentinel;
  attempt('service-account', () => {
    sentinel = account('mcp-sentinel');
    if (sentinel.uid === 0 || sentinel.gid === 0 || sentinel.shell !== '/usr/sbin/nologin')
      throw new Error('mcp-sentinel must be an unprivileged nologin system account');
    return `UID ${sentinel.uid}, GID ${sentinel.gid}, nologin`;
  });
  attempt('configuration-directory', () => assertModeOwner('/etc/mcp-sentinel', 0o700, 0, 0, 'directory'));
  attempt('credential-directory', () => assertModeOwner('/etc/mcp-sentinel/credentials', 0o700, 0, 0, 'directory'));
  attempt('state-directory', () => {
    if (!sentinel) throw new Error('Service account is unavailable');
    return assertModeOwner('/var/lib/mcp-sentinel', 0o700, sentinel.uid, sentinel.gid, 'directory');
  });
  attempt('audit-directory', () => {
    if (!sentinel) throw new Error('Service account is unavailable');
    return assertModeOwner('/var/log/mcp-sentinel', 0o700, sentinel.uid, sentinel.gid, 'directory');
  });
  attempt('credentials', inspectCredentials);
  attempt('public-environment', inspectPublicEnvironment);
  attempt('broker-environment', inspectBrokerEnvironment);
  attempt('systemd-units', inspectUnits);
  attempt('signed-release', inspectRelease);
  attempt('durable-state', () => {
    if (!sentinel) throw new Error('Service account is unavailable');
    return inspectDatabase(sentinel);
  });
  const failed = checks.filter(check => check.status === 'fail').length;
  return { ready: failed === 0, failed, checkedAt: new Date().toISOString(), checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runPreflight();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ready ? 0 : 1;
}
