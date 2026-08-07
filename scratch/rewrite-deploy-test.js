const fs = require('fs');

const testCode = `import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/deploy-release.js', import.meta.url));

if (!process.env.TEST_ACTION) {
    const actions = [
        'prepare-not-root', 'usage', 'prepare-happy', 'prepare-create-user',
        'stage-no-artifact', 'stage-not-tar-gz', 'stage-invalid-temp',
        'stage-happy', 'stage-bad-file-size', 'stage-bad-checksum-length',
        'stage-bad-checksum-hash', 'stage-different-signature', 'stage-already-staged',
        'stage-invalid-package', 'stage-harden-symlink', 'stage-harden-dir',
        'stage-signature-throw', 'stage-wrong-mode',
        'activate-missing-id', 'activate-invalid-id', 'activate-happy',
        'activate-not-dir', 'activate-bad-stat', 'activate-bad-secret',
        'activate-dup-secret', 'activate-atomic', 'activate-dropin',
        'rollback-missing', 'rollback-invalid', 'rollback-happy',
        'rollback-missing-fields', 'rollback-mismatch', 'rollback-catch',
        'activate-unload', 'activate-rollback', 'activate-unload-success', 'service-catch'
    ];

    test('deploy-release.js multi-process coverage', async (t) => {
        for (const action of actions) {
            await t.test(action, () => {
                execFileSync(process.execPath, [
                    '--experimental-test-module-mocks',
                    '--test',
                    __filename
                ], {
                    env: { ...process.env, TEST_ACTION: action },
                    stdio: 'inherit'
                });
            });
        }
    });
} else {
    // Child process runs the specific test
    const fsMock = {
        mkdirSync: mock.fn(), chownSync: mock.fn(), chmodSync: mock.fn(), lstatSync: mock.fn(),
        readFileSync: mock.fn(), writeFileSync: mock.fn(), existsSync: mock.fn(), copyFileSync: mock.fn(),
        rmSync: mock.fn(), mkdtempSync: mock.fn(), readdirSync: mock.fn(), unlinkSync: mock.fn(),
        symlinkSync: mock.fn(), renameSync: mock.fn(), realpathSync: mock.fn(), constants: { COPYFILE_EXCL: 1 }
    };
    mock.module('fs', { defaultExport: fsMock, namedExports: { constants: fsMock.constants } });

    const childMock = { execFileSync: mock.fn(() => '0\\n') };
    mock.module('child_process', { namedExports: childMock });

    const cryptoMock = {
        createHash: mock.fn(() => ({ update: mock.fn(() => ({ digest: mock.fn(() => 'a'.repeat(64)) })) })),
        randomUUID: mock.fn(() => '12345678-1234-1234-1234-123456789012')
    };
    mock.module('crypto', { defaultExport: cryptoMock });

    const libMock = {
        parseEnvironment: mock.fn(() => ({ BROKER_GIT_ALLOWED_REPOS: '/tmp/repo' })),
        parseValidSignatureFingerprint: mock.fn(() => 'A'.repeat(40)),
        validateArchiveEntries: mock.fn(() => 'prefix/'),
        validateArchiveListing: mock.fn(),
        validateReleaseManifest: mock.fn(() => '1.0.0-123456789012'),
        validateProjectWritePaths: mock.fn(() => ['/tmp/repo']),
        validateSigningFingerprint: mock.fn(),
    };
    mock.module('../../lib/deployment.js', { namedExports: libMock });

    mock.method(process.stdout, 'write', () => {});
    mock.method(process.stderr, 'write', () => {});
    mock.method(process, 'getuid', () => 0);

    const setupStageHappy = () => {
        fsMock.realpathSync.mock.mockImplementation(() => '/opt/a.tar.gz');
        fsMock.mkdtempSync.mock.mockImplementation(() => '/opt/mcp-sentinel/releases/.stage-123');
        fsMock.existsSync.mock.mockImplementation(() => false);
        fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o600, uid: 0, gid: 0 }));
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.sha256')) return 'a'.repeat(64) + ' *a.tar.gz\\n';
            if (file.includes('manifest.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });
            if (file.includes('package.json')) return JSON.stringify({ version: '1.0.0' });
            if (file.includes('release-signing-fingerprint')) return 'A'.repeat(40);
            return '';
        });
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'gpg') return '[GNUPG:] VALIDSIG ' + 'A'.repeat(40);
            if (cmd === 'tar' && process.argv.includes('-tzf')) return 'prefix/\\nprefix/a\\n';
            if (cmd === 'tar' && process.argv.includes('-tvzf')) return '-rw-r--r-- root/root 0 2021-01-01 00:00 prefix/a\\n';
            return '0\\n';
        });
        fsMock.readdirSync.mock.mockImplementation(() => [{ name: 'file', isDirectory: () => false }]);
    };

    const setupActivateHappy = () => {
        fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 }));
        let secretCount = 0;
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.release-receipt.json')) return JSON.stringify({});
            if (file.includes('environment')) return 'NODE_ENV=production\\n';
            if (file.includes('credentials')) { secretCount++; return String(secretCount).padEnd(64, '0'); }
            if (file.includes('rollback.json')) return JSON.stringify({ rollbackId: '123' });
            return '{}';
        });
        fsMock.existsSync.mock.mockImplementation(() => true);
        fsMock.realpathSync.mock.mockImplementation(() => '/opt/current');
        childMock.execFileSync.mock.mockImplementation(() => '0\\n');
    };

    const setupRollbackHappy = () => {
        fsMock.readFileSync.mock.mockImplementation(() => JSON.stringify({
            rollbackId: '12345678-1234-1234-1234-123456789012',
            units: { 'mcp-sentinel.service': true, 'authelia.service': false },
            brokerProjectDropIn: true,
            previousCurrent: '/opt/previous',
            previousReceipt: true,
            serviceStates: {
                'mcp-sentinel.service': { active: true, enabled: true },
                'mcp-server.service': { active: false, enabled: false }
            }
        }));
        fsMock.existsSync.mock.mockImplementation(() => true);
        childMock.execFileSync.mock.mockImplementation(() => '0\\n');
    };

    const run = async (action, arg, expectedCode) => {
        process.argv = ['node', SCRIPT_PATH, action];
        if (arg) process.argv.push(arg);
        try {
            await import(SCRIPT_PATH);
        } catch {}
        if (process.exitCode !== expectedCode && (process.exitCode || 0) !== expectedCode) {
            console.error(\`Expected \${expectedCode}, got \${process.exitCode}\`);
            process.exit(1);
        }
    };

    test(process.env.TEST_ACTION, async () => {
        const action = process.env.TEST_ACTION;
        if (action === 'prepare-not-root') {
            mock.method(process, 'getuid', () => 1000);
            await run('prepare', null, 1);
        } else if (action === 'usage') {
            await run('unknown', null, 2);
        } else if (action === 'prepare-happy') {
            childMock.execFileSync.mock.mockImplementation((cmd) => cmd === 'id' ? '999\\n' : '');
            await run('prepare', null, 0);
        } else if (action === 'prepare-create-user') {
            let calls = 0;
            childMock.execFileSync.mock.mockImplementation((cmd) => {
                if (cmd === 'id' && calls++ === 0) throw new Error('not found');
                return cmd === 'id' ? '999\\n' : '';
            });
            await run('prepare', null, 0);
        } else if (action === 'stage-no-artifact') {
            await run('stage', null, 1);
        } else if (action === 'stage-not-tar-gz') {
            fsMock.realpathSync.mock.mockImplementation(() => '/opt/a.txt');
            await run('stage', 'a.txt', 1);
        } else if (action === 'stage-invalid-temp') {
            fsMock.realpathSync.mock.mockImplementation(() => '/opt/a.tar.gz');
            fsMock.mkdtempSync.mock.mockImplementation(() => '/tmp/bad');
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'stage-happy') {
            setupStageHappy();
            await run('stage', 'a.tar.gz', 0);
        } else if (action === 'stage-bad-file-size') {
            setupStageHappy();
            fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, isSymbolicLink: () => false, size: 0, mode: 0o600, uid: 0, gid: 0 }));
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'stage-bad-checksum-length') {
            setupStageHappy();
            fsMock.readFileSync.mock.mockImplementation((file) => {
                if (file.includes('.sha256')) return 'a'.repeat(64) + '\\n';
                if (file.includes('manifest.json')) return '{}';
                if (file.includes('release-signing-fingerprint')) return 'A'.repeat(40);
                return '';
            });
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'stage-bad-checksum-hash') {
            setupStageHappy();
            fsMock.readFileSync.mock.mockImplementation((file) => {
                if (file.includes('.sha256')) return 'b'.repeat(64) + ' *a.tar.gz\\n';
                if (file.includes('release-signing-fingerprint')) return 'A'.repeat(40);
                return '{}';
            });
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'stage-different-signature') {
            setupStageHappy();
            let i = 0;
            libMock.parseValidSignatureFingerprint.mock.mockImplementation(() => (i++ === 0) ? 'A'.repeat(40) : 'B'.repeat(40));
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'stage-already-staged') {
            setupStageHappy();
            fsMock.existsSync.mock.mockImplementation(() => true);
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'stage-invalid-package') {
            setupStageHappy();
            fsMock.readFileSync.mock.mockImplementation((file) => {
                if (file.includes('.sha256')) return 'a'.repeat(64) + ' *a.tar.gz\\n';
                if (file.includes('manifest.json')) return JSON.stringify({ version: '1.0.0' });
                if (file.includes('package.json')) return JSON.stringify({ version: '2.0.0' });
                if (file.includes('release-signing-fingerprint')) return 'A'.repeat(40);
                return '';
            });
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'stage-harden-symlink') {
            setupStageHappy();
            fsMock.lstatSync.mock.mockImplementation((file) => {
                if (file.includes('a.tar.gz')) return { isFile: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o600, uid: 0, gid: 0 };
                return { isFile: () => true, isSymbolicLink: () => true, size: 1024, mode: 0o600, uid: 0, gid: 0 };
            });
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'stage-harden-dir') {
            setupStageHappy();
            let i = 0;
            fsMock.readdirSync.mock.mockImplementation(() => (i++ === 0) ? [{ name: 'dir', isDirectory: () => true }] : []);
            await run('stage', 'a.tar.gz', 0);
        } else if (action === 'stage-signature-throw') {
            setupStageHappy();
            libMock.parseValidSignatureFingerprint.mock.mockImplementation(() => { throw new Error('bad'); });
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'stage-wrong-mode') {
            setupStageHappy();
            fsMock.lstatSync.mock.mockImplementation((f) => {
                if (f.includes('release-signing-fingerprint')) return { isFile: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o777, uid: 0, gid: 0 };
                return { isFile: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o600, uid: 0, gid: 0 };
            });
            await run('stage', 'a.tar.gz', 1);
        } else if (action === 'activate-missing-id') {
            await run('activate', null, 1);
        } else if (action === 'activate-invalid-id') {
            await run('activate', 'bad', 1);
        } else if (action === 'activate-happy') {
            setupActivateHappy();
            await run('activate', '1.0.0-123456789012', 0);
        } else if (action === 'activate-not-dir') {
            setupActivateHappy();
            fsMock.lstatSync.mock.mockImplementation((f) => {
                if (f.includes('1.0.0-123456789012')) return { isDirectory: () => false, isSymbolicLink: () => false };
                return { isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 };
            });
            await run('activate', '1.0.0-123456789012', 1);
        } else if (action === 'activate-bad-stat') {
            setupActivateHappy();
            fsMock.lstatSync.mock.mockImplementation((f) => {
                if (f.includes('environment')) return { isFile: () => false, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0 };
                return { isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 };
            });
            await run('activate', '1.0.0-123456789012', 1);
        } else if (action === 'activate-bad-secret') {
            setupActivateHappy();
            fsMock.lstatSync.mock.mockImplementation((f) => {
                if (f.includes('state-key')) return { isFile: () => false, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0 };
                return { isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 };
            });
            await run('activate', '1.0.0-123456789012', 1);
        } else if (action === 'activate-dup-secret') {
            setupActivateHappy();
            fsMock.readFileSync.mock.mockImplementation((file) => file.includes('credentials') ? 'same_secret_invalid_len' : '{}');
            await run('activate', '1.0.0-123456789012', 1);
        } else if (action === 'activate-atomic') {
            setupActivateHappy();
            fsMock.existsSync.mock.mockImplementation((f) => f.includes('.current-') ? true : false);
            await run('activate', '1.0.0-123456789012', 0);
        } else if (action === 'activate-dropin') {
            setupActivateHappy();
            fsMock.lstatSync.mock.mockImplementation((f) => {
                if (f.includes('/tmp/repo')) return { isDirectory: () => false, isSymbolicLink: () => false };
                return { isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 };
            });
            await run('activate', '1.0.0-123456789012', 1);
        } else if (action === 'rollback-missing') {
            await run('rollback', null, 1);
        } else if (action === 'rollback-invalid') {
            await run('rollback', 'bad', 1);
        } else if (action === 'rollback-happy') {
            setupRollbackHappy();
            await run('rollback', '12345678-1234-1234-1234-123456789012', 0);
        } else if (action === 'rollback-missing-fields') {
            setupRollbackHappy();
            fsMock.readFileSync.mock.mockImplementation(() => JSON.stringify({
                rollbackId: '12345678-1234-1234-1234-123456789012', units: {}, brokerProjectDropIn: false,
                previousCurrent: null, previousReceipt: false, previousLegacyActive: true, previousSentinelActive: true
            }));
            await run('rollback', '12345678-1234-1234-1234-123456789012', 0);
        } else if (action === 'rollback-mismatch') {
            fsMock.readFileSync.mock.mockImplementation(() => JSON.stringify({ rollbackId: 'wrong' }));
            await run('rollback', '12345678-1234-1234-1234-123456789012', 1);
        } else if (action === 'rollback-catch') {
            setupRollbackHappy();
            let i = 0;
            childMock.execFileSync.mock.mockImplementation((cmd) => {
                if (cmd === 'systemctl' && i++ < 5) throw new Error('fail');
                return '';
            });
            await run('rollback', '12345678-1234-1234-1234-123456789012', 0);
        } else if (action === 'activate-unload') {
            setupActivateHappy();
            childMock.execFileSync.mock.mockImplementation((cmd, args) => {
                if (cmd === 'systemctl' && args.includes('show')) return '/run/systemd/transient/unit';
                if (cmd === 'systemctl' && args.includes('stop')) throw new Error('stop fail');
                if (cmd === 'systemctl' && args.includes('reset-failed')) throw new Error('reset fail');
                return '0\\n';
            });
            await run('activate', '1.0.0-123456789012', 1);
        } else if (action === 'activate-rollback') {
            setupActivateHappy();
            childMock.execFileSync.mock.mockImplementation((cmd, args) => {
                if (cmd === 'curl') throw new Error('health fail');
                return '0\\n';
            });
            await run('activate', '1.0.0-123456789012', 1);
        } else if (action === 'activate-unload-success') {
            setupActivateHappy();
            childMock.execFileSync.mock.mockImplementation((cmd, args) => {
                if (cmd === 'systemctl' && args.includes('show')) return '/run/systemd/transient/unit';
                return '0\\n';
            });
            await run('activate', '1.0.0-123456789012', 0);
        } else if (action === 'service-catch') {
            setupActivateHappy();
            childMock.execFileSync.mock.mockImplementation((cmd, args) => {
                if (cmd === 'systemctl' && (args.includes('is-active') || args.includes('is-enabled'))) {
                    throw new Error('fail');
                }
                return '0\\n';
            });
            await run('activate', '1.0.0-123456789012', 0);
        }
    });
}
\`;

fs.writeFileSync('tests/scripts/deploy-release.test.js', testCode);
