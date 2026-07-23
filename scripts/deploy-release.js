#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  parseEnvironment,
  parseValidSignatureFingerprint,
  validateArchiveEntries,
  validateArchiveListing,
  validateReleaseManifest,
  validateSigningFingerprint,
} from '../lib/deployment.js';

const applicationRoot = '/opt/mcp-sentinel';
const releasesRoot = path.join(applicationRoot, 'releases');
const currentLink = path.join(applicationRoot, 'current');
const configurationRoot = '/etc/mcp-sentinel';
const stateRoot = '/var/lib/mcp-sentinel';
const logRoot = '/var/log/mcp-sentinel';
const unitRoot = '/etc/systemd/system';
const trustedSigningFingerprintFile = path.join(configurationRoot, 'release-signing-fingerprint');
const MAX_RELEASE_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_RELEASE_COMPANION_BYTES = 1024 * 1024;
const managedUnits = [
  'authelia.service',
  'mcp-sentinel.service',
  'mcp-sentinel-broker.service',
  'mcp-sentinel-state-backup.service',
  'mcp-sentinel-state-backup.timer',
  'mcp-sentinel-audit-verify.service',
  'mcp-sentinel-audit-verify.timer',
];

function command(file, argv, options = {}) {
  const { capture = false, ...execOptions } = options;
  return execFileSync(file, argv, { encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', ...execOptions });
}

function requireRoot() {
  if (process.getuid?.() !== 0) throw new Error('Production deployment commands must run as root');
}

function signatureFingerprint(signature, payload) {
  const output = command('gpg', ['--batch', '--status-fd=1', '--verify', signature, payload], { capture: true });
  try {
    return parseValidSignatureFingerprint(output);
  } catch {
    throw new Error(`No valid signature was found for ${path.basename(payload)}`);
  }
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function protectedRegularFile(file, maxBytes) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes)
    throw new Error(`Release input is not a bounded regular file: ${file}`);
  return stat;
}

function trustedSigningFingerprint() {
  const stat = protectedRegularFile(trustedSigningFingerprintFile, 1024);
  if (stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o777) !== 0o600)
    throw new Error(`${trustedSigningFingerprintFile} must be root-owned mode 0600`);
  return fs.readFileSync(trustedSigningFingerprintFile, 'utf8');
}

function copyReleaseInput(source, directory, maxBytes) {
  protectedRegularFile(source, maxBytes);
  const destination = path.join(directory, path.basename(source));
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chownSync(destination, 0, 0);
  fs.chmodSync(destination, 0o600);
  protectedRegularFile(destination, maxBytes);
  return destination;
}

function safeStageDirectory(directory) {
  const resolved = path.resolve(directory);
  if (!resolved.startsWith(`${releasesRoot}${path.sep}.stage-`)) throw new Error('Unsafe staging cleanup path');
  return resolved;
}

function hardenTree(root) {
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error(`Release contains unsupported symbolic link '${target}'`);
      fs.chownSync(target, 0, 0);
      fs.chmodSync(target, stat.mode & 0o755);
      if (entry.isDirectory()) walk(target);
    }
  };
  fs.chownSync(root, 0, 0);
  fs.chmodSync(root, 0o755);
  walk(root);
}

function stageRelease(artifactArgument) {
  requireRoot();
  if (!artifactArgument) throw new Error('stage requires the signed .tar.gz artifact path');
  const sourceArtifact = fs.realpathSync(artifactArgument);
  if (!sourceArtifact.endsWith('.tar.gz')) throw new Error('Release artifact must be a regular .tar.gz file');
  fs.mkdirSync(releasesRoot, { recursive: true, mode: 0o755 });
  const temporary = safeStageDirectory(fs.mkdtempSync(path.join(releasesRoot, '.stage-')));
  try {
    const inputs = path.join(temporary, 'inputs');
    fs.mkdirSync(inputs, { mode: 0o700 });
    const artifact = copyReleaseInput(sourceArtifact, inputs, MAX_RELEASE_ARTIFACT_BYTES);
    const manifestFile = copyReleaseInput(`${sourceArtifact}.manifest.json`, inputs, MAX_RELEASE_COMPANION_BYTES);
    const checksumFile = copyReleaseInput(`${sourceArtifact}.sha256`, inputs, MAX_RELEASE_COMPANION_BYTES);
    const artifactSignature = copyReleaseInput(`${sourceArtifact}.asc`, inputs, MAX_RELEASE_COMPANION_BYTES);
    const manifestSignature = copyReleaseInput(
      `${sourceArtifact}.manifest.json.asc`,
      inputs,
      MAX_RELEASE_COMPANION_BYTES
    );
    const artifactHash = hashFile(artifact);
    const checksum = fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/);
    if (
      checksum.length !== 2 ||
      checksum[0] !== artifactHash ||
      checksum[1].replace(/^\*/, '') !== path.basename(artifact)
    )
      throw new Error('Release checksum file does not exactly match the artifact');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const releaseId = validateReleaseManifest(manifest, path.basename(artifact), artifactHash);
    const artifactSigner = signatureFingerprint(artifactSignature, artifact);
    const manifestSigner = signatureFingerprint(manifestSignature, manifestFile);
    if (artifactSigner !== manifestSigner) throw new Error('Artifact and manifest must be signed by the same key');
    validateSigningFingerprint(artifactSigner, trustedSigningFingerprint());
    const destination = path.join(releasesRoot, releaseId);
    if (fs.existsSync(destination)) throw new Error(`Release '${releaseId}' is already staged`);
    const entries = command('tar', ['-tzf', artifact], { capture: true }).split('\n').filter(Boolean);
    const prefix = validateArchiveEntries(entries, manifest.version);
    const verbose = command('tar', ['-tvzf', artifact], {
      capture: true,
      env: { ...process.env, LC_ALL: 'C' },
    });
    validateArchiveListing(verbose.split('\n').filter(Boolean));
    command('tar', ['-xzf', artifact, '--no-same-owner', '--no-same-permissions', '-C', temporary]);
    const extracted = path.join(temporary, prefix.slice(0, -1));
    const packageJson = JSON.parse(fs.readFileSync(path.join(extracted, 'package.json'), 'utf8'));
    if (packageJson.version !== manifest.version) throw new Error('Package version does not match the signed manifest');
    // Runtime entry points invoke Node files directly. Avoid npm's .bin
    // symlinks so the immutable production tree can remain symlink-free.
    command('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-bin-links'], { cwd: extracted });
    const receipt = {
      ...manifest,
      signatureFingerprint: artifactSigner,
      stagedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(extracted, '.release-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, {
      mode: 0o600,
    });
    hardenTree(extracted);
    fs.renameSync(extracted, destination);
    process.stdout.write(
      `${JSON.stringify({ staged: true, releaseId, destination, signatureFingerprint: artifactSigner })}\n`
    );
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(safeStageDirectory(temporary), { recursive: true });
  }
}

function prepareHost() {
  requireRoot();
  try {
    command('id', ['mcp-sentinel'], { capture: true });
  } catch {
    command('useradd', ['--system', '--home', stateRoot, '--shell', '/usr/sbin/nologin', 'mcp-sentinel']);
  }
  const uid = Number(command('id', ['-u', 'mcp-sentinel'], { capture: true }).trim());
  const gid = Number(command('id', ['-g', 'mcp-sentinel'], { capture: true }).trim());
  for (const [directory, ownerUid, ownerGid] of [
    [configurationRoot, 0, 0],
    [path.join(configurationRoot, 'credentials'), 0, 0],
    [stateRoot, uid, gid],
    [logRoot, uid, gid],
    [applicationRoot, 0, 0],
    [releasesRoot, 0, 0],
  ]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chownSync(directory, ownerUid, ownerGid);
    fs.chmodSync(directory, directory.startsWith(applicationRoot) ? 0o755 : 0o700);
  }
  process.stdout.write(`${JSON.stringify({ prepared: true, uid, gid })}\n`);
}

function validateActivationInputs(release) {
  const receipt = JSON.parse(fs.readFileSync(path.join(release, '.release-receipt.json'), 'utf8'));
  for (const file of ['environment', 'broker-environment']) {
    const target = path.join(configurationRoot, file);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.uid !== 0 || stat.gid !== 0)
      throw new Error(`${target} must be a root-owned mode-0600 regular file`);
    parseEnvironment(fs.readFileSync(target, 'utf8'));
  }
  const secrets = new Set();
  for (const name of ['state-key', 'audit-key', 'jwt-key', 'state-backup-key']) {
    const target = path.join(configurationRoot, 'credentials', name);
    const stat = fs.lstatSync(target);
    const secret = fs.readFileSync(target, 'utf8').trim();
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.uid !== 0 || stat.gid !== 0)
      throw new Error(`${target} must be a root-owned mode-0600 regular file`);
    if (!/^[a-f0-9]{64}$/i.test(secret) || secrets.has(secret))
      throw new Error(`${name} must be an independent 32-byte hexadecimal secret`);
    secrets.add(secret);
  }
  return receipt;
}

function atomicSymlink(target) {
  const temporary = path.join(applicationRoot, `.current-${process.pid}`);
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  fs.symlinkSync(target, temporary);
  fs.renameSync(temporary, currentLink);
}

function serviceActive(name) {
  try {
    command('systemctl', ['is-active', '--quiet', name], { capture: true });
    return true;
  } catch {
    return false;
  }
}

function serviceEnabled(name) {
  try {
    command('systemctl', ['is-enabled', '--quiet', name], { capture: true });
    return true;
  } catch {
    return false;
  }
}

function serviceState(name) {
  return { active: serviceActive(name), enabled: serviceEnabled(name) };
}

function unloadTransientUnit(name) {
  let fragment = '';
  try {
    fragment = command('systemctl', ['show', '--property=FragmentPath', '--value', name], { capture: true }).trim();
  } catch {}
  if (!fragment.startsWith('/run/systemd/transient/')) return;
  try {
    command('systemctl', ['stop', name], { stdio: 'ignore' });
  } catch {}
  try {
    command('systemctl', ['reset-failed', name], { stdio: 'ignore' });
  } catch {}
  command('systemctl', ['daemon-reload']);
}

function restoreRollback(metadata, rollbackDirectory) {
  const state =
    metadata.serviceStates ||
    Object.fromEntries([
      ['mcp-server.service', { active: metadata.previousLegacyActive === true, enabled: false }],
      ['mcp-sentinel.service', { active: metadata.previousSentinelActive === true, enabled: false }],
      ['mcp-sentinel-broker.service', { active: metadata.previousSentinelActive === true, enabled: false }],
    ]);
  for (const unit of [...managedUnits, 'mcp-server.service']) {
    try {
      command('systemctl', ['stop', unit], { stdio: 'ignore' });
    } catch {}
  }
  for (const unit of managedUnits) {
    const backup = path.join(rollbackDirectory, 'units', unit);
    const installed = path.join(unitRoot, unit);
    if (metadata.units[unit]) fs.copyFileSync(backup, installed);
    else if (fs.existsSync(installed)) fs.unlinkSync(installed);
  }
  if (metadata.previousCurrent) atomicSymlink(metadata.previousCurrent);
  else if (fs.existsSync(currentLink)) fs.unlinkSync(currentLink);
  if (metadata.previousReceipt)
    fs.copyFileSync(path.join(rollbackDirectory, 'deployment.json'), path.join(stateRoot, 'deployment.json'));
  else if (fs.existsSync(path.join(stateRoot, 'deployment.json')))
    fs.unlinkSync(path.join(stateRoot, 'deployment.json'));
  command('systemctl', ['daemon-reload']);
  for (const unit of [...managedUnits, 'mcp-server.service']) {
    try {
      command('systemctl', [state[unit]?.enabled ? 'enable' : 'disable', unit], { stdio: 'ignore' });
    } catch {}
  }
  for (const unit of [
    'mcp-server.service',
    'authelia.service',
    'mcp-sentinel-broker.service',
    'mcp-sentinel.service',
    'mcp-sentinel-audit-verify.timer',
    'mcp-sentinel-state-backup.timer',
    'mcp-sentinel-audit-verify.service',
    'mcp-sentinel-state-backup.service',
  ]) {
    if (state[unit]?.active) {
      try {
        command('systemctl', ['start', unit]);
      } catch {}
    }
  }
}

function activateRelease(releaseId) {
  requireRoot();
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?-[a-f0-9]{12}$/i.test(releaseId || ''))
    throw new Error('activate requires a valid staged release ID');
  const release = path.join(releasesRoot, releaseId);
  const stat = fs.lstatSync(release);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Staged release directory is unsafe');
  const receipt = validateActivationInputs(release);
  const rollbackId = crypto.randomUUID();
  const rollbackDirectory = path.join(stateRoot, 'rollbacks', rollbackId);
  fs.mkdirSync(path.join(rollbackDirectory, 'units'), { recursive: true, mode: 0o700 });
  const metadata = {
    rollbackId,
    createdAt: new Date().toISOString(),
    previousCurrent: fs.existsSync(currentLink) ? fs.realpathSync(currentLink) : null,
    previousLegacyActive: serviceActive('mcp-server.service'),
    previousSentinelActive: serviceActive('mcp-sentinel.service'),
    previousReceipt: fs.existsSync(path.join(stateRoot, 'deployment.json')),
    units: {},
    serviceStates: Object.fromEntries([...managedUnits, 'mcp-server.service'].map(unit => [unit, serviceState(unit)])),
  };
  for (const unit of managedUnits) {
    const installed = path.join(unitRoot, unit);
    metadata.units[unit] = fs.existsSync(installed);
    if (metadata.units[unit]) fs.copyFileSync(installed, path.join(rollbackDirectory, 'units', unit));
  }
  if (metadata.previousReceipt)
    fs.copyFileSync(path.join(stateRoot, 'deployment.json'), path.join(rollbackDirectory, 'deployment.json'));
  fs.writeFileSync(path.join(rollbackDirectory, 'rollback.json'), `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o600,
  });

  try {
    // An existing compatibility or previous-release process may already own
    // the public port or broker socket. Stop it before replacing units and the
    // current symlink so --now always launches the reviewed release.
    for (const unit of ['mcp-sentinel.service', 'mcp-sentinel-broker.service']) {
      if (serviceActive(unit)) command('systemctl', ['stop', unit]);
      unloadTransientUnit(unit);
    }
    for (const unit of managedUnits) {
      const installed = path.join(unitRoot, unit);
      fs.copyFileSync(path.join(release, 'deploy', unit), installed);
      fs.chmodSync(installed, 0o644);
      fs.chownSync(installed, 0, 0);
    }
    atomicSymlink(release);
    fs.copyFileSync(path.join(release, '.release-receipt.json'), path.join(stateRoot, 'deployment.json'));
    // Do not recursively chown the durable-state root: it may also contain
    // root-owned Authelia state and protected deployment rollback material.
    // The public service only owns its explicit mutable files and log tree.
    command('chown', ['mcp-sentinel:mcp-sentinel', stateRoot, logRoot]);
    command('chown', ['-R', 'mcp-sentinel:mcp-sentinel', logRoot]);
    for (const name of [
      'state.sqlite3',
      'state.sqlite3-wal',
      'state.sqlite3-shm',
      'audit-chain.json',
      'audit-verification.json',
    ]) {
      const target = path.join(stateRoot, name);
      if (fs.existsSync(target)) command('chown', ['mcp-sentinel:mcp-sentinel', target]);
    }
    command('systemctl', ['daemon-reload']);
    if (metadata.previousLegacyActive) command('systemctl', ['stop', 'mcp-server.service']);
    const environment = parseEnvironment(fs.readFileSync(path.join(configurationRoot, 'environment'), 'utf8'));
    command('/usr/bin/node', [path.join(release, 'scripts', 'upgrade-state.js')], {
      env: { ...process.env, ...environment },
    });
    command('systemctl', ['enable', '--now', 'mcp-sentinel-broker.service', 'mcp-sentinel.service']);
    const healthUrl = `${environment.USE_HTTPS === 'true' ? 'https' : 'http'}://${environment.HOST}:${environment.PORT || '4444'}/health`;
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        command('curl', ['--fail', '--silent', '--show-error', '--max-time', '2', healthUrl], { capture: true });
        healthy = true;
        break;
      } catch {}
      command('sleep', ['1']);
    }
    if (!healthy) throw new Error(`New service did not become healthy at ${healthUrl}`);
    command('/usr/bin/node', [path.join(release, 'scripts', 'production-preflight.js')]);
    command('systemctl', ['enable', '--now', 'mcp-sentinel-audit-verify.timer', 'mcp-sentinel-state-backup.timer']);
    if (metadata.previousLegacyActive) command('systemctl', ['disable', 'mcp-server.service']);
    process.stdout.write(`${JSON.stringify({ activated: true, releaseId, rollbackId, receipt })}\n`);
  } catch (error) {
    restoreRollback(metadata, rollbackDirectory);
    throw new Error(`Activation failed and rollback ${rollbackId} was applied: ${error.message}`);
  }
}

function rollback(rollbackId) {
  requireRoot();
  if (!/^[0-9a-f-]{36}$/i.test(rollbackId || '')) throw new Error('rollback requires a valid rollback ID');
  const rollbackDirectory = path.join(stateRoot, 'rollbacks', rollbackId);
  const metadata = JSON.parse(fs.readFileSync(path.join(rollbackDirectory, 'rollback.json'), 'utf8'));
  if (metadata.rollbackId !== rollbackId) throw new Error('Rollback metadata ID mismatch');
  restoreRollback(metadata, rollbackDirectory);
  process.stdout.write(`${JSON.stringify({ rolledBack: true, rollbackId })}\n`);
}

function usage() {
  process.stderr.write(
    'Usage: install.sh prepare | stage <signed-artifact.tar.gz> | activate <release-id> | rollback <rollback-id>\n'
  );
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, argument] = process.argv.slice(2);
    if (action === 'prepare') prepareHost();
    else if (action === 'stage') stageRelease(argument);
    else if (action === 'activate') activateRelease(argument);
    else if (action === 'rollback') rollback(argument);
    else usage();
  } catch (error) {
    process.stderr.write(`Deployment refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}
