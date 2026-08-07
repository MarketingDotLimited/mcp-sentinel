process.on('unhandledRejection', err => console.error('UR:', err));
process.on('uncaughtException', err => console.error('UE:', err));
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/deploy-release.js', import.meta.url));

const fsMock = {
  readFileSync: mock.fn(() => ''),
  mkdirSync: mock.fn(),
  chownSync: mock.fn(),
  chmodSync: mock.fn(),
  lstatSync: mock.fn(() => ({
    isFile: () => true,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    mode: 0o600,
    uid: 0,
    gid: 0,
    size: 1024,
  })),
  writeFileSync: mock.fn(),
  existsSync: mock.fn(),
  copyFileSync: mock.fn(),
  rmSync: mock.fn(),
  mkdtempSync: mock.fn(),
  readdirSync: mock.fn(),
  unlinkSync: mock.fn(),
  symlinkSync: mock.fn(),
  renameSync: mock.fn(),
  realpathSync: mock.fn(),
  constants: { COPYFILE_EXCL: 1 },
};
mock.module('fs', { defaultExport: fsMock, namedExports: { constants: fsMock.constants } });

const childMock = { execFileSync: mock.fn(() => '0\n') };
mock.module('child_process', { defaultExport: childMock, namedExports: { execFileSync: childMock.execFileSync } });

const cryptoMock = { createHash: mock.fn() };

const libMock = {
  parseEnvironment: mock.fn(() => ({})),
  parseValidSignatureFingerprint: mock.fn(() => 'abcdef1234567890'),
  validateArchiveEntries: mock.fn(() => 'prefix/'),
  validateArchiveListing: mock.fn(() => {}),
  validateReleaseManifest: mock.fn(() => '1.0.0-abcdef123456'),
  validateProjectWritePaths: mock.fn(() => ['/some/path']),
  validateSigningFingerprint: mock.fn(() => true),
};
mock.module('../../lib/deployment.js', { namedExports: libMock });

test('deploy-release.js suite', async t => {
  const originalArgv = process.argv;
  process.argv = ['node', SCRIPT_PATH, 'prepare'];
  let runCommand;
  try {
    runCommand = (await import(SCRIPT_PATH)).runCommand;
  } catch (e) {
    void e;
  }
  process.argv = originalArgv;
  if (!runCommand) runCommand = (await import(SCRIPT_PATH)).runCommand;

  const setupStageHappy = () => {
    fsMock.realpathSync.mock.mockImplementation(() => '/opt/a.tar.gz');
    fsMock.mkdtempSync.mock.mockImplementation(() => '/opt/mcp-sentinel/releases/.stage-123');
    fsMock.existsSync.mock.mockImplementation(file => {
      if (file.includes('1.0.0-abcdef123456')) return false;
      return true;
    });
    fsMock.lstatSync.mock.mockImplementation(() => ({
      isFile: () => true,
      isDirectory: () => true,
      isSymbolicLink: () => false,
      size: 1024,
      mode: 0o600,
      uid: 0,
      gid: 0,
    }));
    fsMock.readFileSync.mock.mockImplementation(file => {
      if (file.includes('.sha256'))
        return 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb *a.tar.gz\n';
      if (file.includes('-key')) {
        let secretCount = 0;
        secretCount++;
        const s = secretCount.toString().padStart(64, '0');
        console.error('KEY:', file, s);
        return s;
      }
      if (file.includes('.json'))
        return JSON.stringify({
          version: '1.0.0',
          commit: 'c'.repeat(40),
          rollbackId: '8ae3fe0f-0ada-4823-83bb-6475190e5f44',
          services: {},
          paths: [],
          units: {},
          previousLegacyActive: true,
        });
      return 'a';
    });
    childMock.execFileSync.mock.mockImplementation((cmd, args) => {
      if (cmd === 'gpg') return '[GNUPG:] VALIDSIG ' + 'A'.repeat(40);
      if (cmd === 'tar' && process.argv.includes('-tzf')) return 'prefix/\nprefix/a\n';
      if (cmd === 'tar' && process.argv.includes('-tvzf')) return '-rw-r--r-- root/root 0 2021-01-01 00:00 prefix/a\n';
      return '0\n';
    });
    fsMock.readdirSync.mock.mockImplementation(() => [{ name: 'file', isDirectory: () => false }]);
  };

  const setupActivateHappy = () => {
    fsMock.lstatSync.mock.mockImplementation(() => ({
      isFile: () => true,
      isDirectory: () => true,
      isSymbolicLink: () => false,
      mode: 0o600,
      uid: 0,
      gid: 0,
      size: 1024,
    }));
    let secretCount = 0;
    fsMock.readFileSync.mock.mockImplementation(file => {
      if (file.includes('.sha256'))
        return 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb *a.tar.gz\n';
      if (file.includes('-key')) {
        secretCount++;
        const s = secretCount.toString().padStart(64, '0');
        console.error('KEY:', file, s);
        return s;
      }
      if (file.includes('.json'))
        return JSON.stringify({
          version: '1.0.0',
          commit: 'c'.repeat(40),
          rollbackId: '8ae3fe0f-0ada-4823-83bb-6475190e5f44',
          services: {},
          paths: [],
          units: {},
          previousLegacyActive: true,
        });
      return 'a';
    });
    fsMock.existsSync.mock.mockImplementation(file => {
      if (file.includes('1.0.0-abcdef123456')) return false;
      return true;
    });
    fsMock.realpathSync.mock.mockImplementation(() => '/opt/current');
    childMock.execFileSync.mock.mockImplementation((cmd, args) => {
      if (cmd === 'systemctl' && args && args.includes('show'))
        return '/run/systemd/transient/mcp-sentinel-update.service\n';
      if (cmd === 'systemctl') return '0\n';
      if (cmd === 'curl') {
        if (!global.curlCalled) {
          global.curlCalled = true;
          throw new Error('fail');
        }
      }
      return '0\n';
    });
  };

  const run = async (action, arg = null, expectedCode = 0) => {
    const argv = ['node', SCRIPT_PATH, action];
    if (arg) argv.push(arg);

    process.exitCode = 0;
    runCommand(argv);

    const actualCode = process.exitCode;
    console.error(`>>> TEST ${action} ${arg} FINISHED WITH ${actualCode} <<<`);
    console.log('ACTUAL CODE FOR', action, arg, 'IS', actualCode);
    process.exitCode = 0;
    if ((actualCode || 0) !== expectedCode) {
      throw new Error(`exit mismatch: expected ${expectedCode}, got ${actualCode}`);
    }
  };

  await t.test('prepare-not-root', async () => {
    await run('prepare', '--fake-not-root', 1);
  });

  await t.test('usage', async () => {
    await run('unknown', null, 2);
  });

  await t.test('prepare-happy', async () => {
    childMock.execFileSync.mock.mockImplementation(cmd => (cmd === 'id' ? '999\n' : ''));
    await run('prepare', null, 0);
  });

  await t.test('prepare-create-user', async () => {
    let calls = 0;
    childMock.execFileSync.mock.mockImplementation((cmd, args) => {
      if (cmd === 'id' && calls++ === 0) throw new Error('not found');
      return cmd === 'id' ? '999\n' : '';
    });
    await run('prepare', null, 0);
  });

  await t.test('stage-no-artifact', async () => {
    await run('stage', null, 1);
  });

  await t.test('stage-not-tar-gz', async () => {
    fsMock.realpathSync.mock.mockImplementation(() => '/opt/a.txt');
    await run('stage', 'a.txt', 1);
  });

  await t.test('stage-invalid-temp', async () => {
    fsMock.realpathSync.mock.mockImplementation(() => '/opt/a.tar.gz');
    fsMock.mkdtempSync.mock.mockImplementation(() => {
      throw new Error('fail');
    });
    await run('stage', 'a.tar.gz', 1);
  });

  await t.test('stage-happy', async () => {
    setupStageHappy();
    await run('stage', 'a.tar.gz', 0);
  });

  await t.test('stage-bad-file-size', async () => {
    setupStageHappy();
    fsMock.lstatSync.mock.mockImplementation(() => ({
      isFile: () => true,
      isDirectory: () => true,
      isSymbolicLink: () => false,
      mode: 0o600,
      uid: 0,
      gid: 0,
      size: 2 * 1024 * 1024 * 1024,
    }));
    await run('stage', 'a.tar.gz', 1);
  });

  await t.test('stage-bad-checksum-length', async () => {
    setupStageHappy();
    fsMock.readFileSync.mock.mockImplementation(file => (file.includes('.sha256') ? 'abcd *a.tar.gz\n' : ''));
    await run('stage', 'a.tar.gz', 1);
  });

  await t.test('stage-checksum-mismatch', async () => {
    setupStageHappy();
    fsMock.readFileSync.mock.mockImplementation(file => {
      if (file.includes('.sha256')) return 'beef *a.tar.gz\n';
      return 'a';
    });
    await run('stage', 'a.tar.gz', 1);
  });

  await t.test('stage-bad-signature', async () => {
    setupStageHappy();
    childMock.execFileSync.mock.mockImplementation((cmd, args) => {
      if (cmd === 'gpg') return 'BADSIG';
      return '';
    });
    libMock.validateSigningFingerprint.mock.mockImplementation(() => {
      throw new Error('Artifact and manifest must be signed by the same key');
    });
    await run('stage', 'a.tar.gz', 1);
  });

  await t.test('stage-bad-tar-list', async () => {
    setupStageHappy();
    let tarCalls = 0;
    childMock.execFileSync.mock.mockImplementation((cmd, args) => {
      if (cmd === 'gpg') return '[GNUPG:] VALIDSIG ' + 'A'.repeat(40);
      if (cmd === 'tar' && args.includes('-tzf')) return 'prefix/\n../bad\n';
      return '';
    });
    libMock.validateArchiveEntries.mock.mockImplementation(() => {
      throw new Error('Release archive must only contain files within a single root directory');
    });
    await run('stage', 'a.tar.gz', 1);
  });

  await t.test('stage-no-manifest', async () => {
    setupStageHappy();
    fsMock.readFileSync.mock.mockImplementation(file => {
      if (file.includes('.sha256'))
        return 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb *a.tar.gz\n';
      if (file.includes('.json')) return JSON.stringify({ version: '2.0.0' });
      return 'a';
    });
    libMock.validateReleaseManifest.mock.mockImplementation(() => {
      throw new Error('Release manifest must be valid');
    });
    await run('stage', 'a.tar.gz', 1);
  });

  await t.test('activate-no-release', async () => {
    await run('activate', null, 1);
  });

  await t.test('activate-invalid-release', async () => {
    await run('activate', '1.0.0', 1);
  });

  await t.test('activate-not-found', async () => {
    fsMock.existsSync.mock.mockImplementation(file => {
      if (file.includes('1.0.0-abcdef123456')) return false;
      return true;
    });
    await run('activate', '1.0.0-123456789012', 1);
  });

  await t.test('activate-not-dir', async () => {
    fsMock.existsSync.mock.mockImplementation(file => {
      if (file.includes('1.0.0-abcdef123456')) return false;
      return true;
    });
    fsMock.lstatSync.mock.mockImplementation(() => ({ isDirectory: () => false }));
    await run('activate', '1.0.0-123456789012', 1);
  });

  await t.test('activate-happy', async () => {
    setupActivateHappy();
    await run('activate', '1.0.0-123456789012', 0);
  });

  await t.test('rollback-no-id', async () => {
    await run('rollback', null, 1);
  });

  await t.test('rollback-invalid-id', async () => {
    await run('rollback', '1.0.0', 1);
  });

  await t.test('rollback-not-found', async () => {
    fsMock.existsSync.mock.mockImplementation(file => {
      if (file.includes('1.0.0-abcdef123456')) return false;
      return true;
    });
    await run('rollback', '1.0.0-123456789012', 1);
  });

  await t.test('stage-bad-parse-signature', async () => {
    setupStageHappy();
    libMock.validateReleaseManifest.mock.mockImplementation(() => '1.0.0-abcdef123456');
    libMock.parseValidSignatureFingerprint.mock.mockImplementation(() => {
      throw new Error('parse error');
    });
    await run('stage', 'a.tar.gz', 1);
  });

  await t.test('rollback-happy', async () => {
    setupActivateHappy();
    await run('rollback', '8ae3fe0f-0ada-4823-83bb-6475190e5f44', 0);
  });

  await t.test('service-catch', async () => {
    setupActivateHappy();
    childMock.execFileSync.mock.mockImplementation((cmd, args) => {
      if (cmd === 'systemctl' && (args.includes('is-active') || args.includes('is-enabled'))) {
        throw new Error('fail');
      }
      return '0\n';
    });
    await run('activate', '1.0.0-123456789012', 0);
  });
  await t.test('activate-trigger-rollback', async () => {
    setupActivateHappy();
    childMock.execFileSync.mock.mockImplementation((cmd, args) => {
      if (cmd === 'systemctl' && args.includes('start') && args.includes('mcp-sentinel.service')) {
        throw new Error('fail');
      }
      if (cmd === 'systemctl' && (args.includes('is-active') || args.includes('is-enabled'))) {
        throw new Error('fail');
      }
      return '0\n';
    });
    await run('activate', '1.0.0-123456789012', 1);
  });
});
