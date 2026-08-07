import fs from 'fs';

const testFile = 'tests/scripts/deploy-release.test.js';

const testCode = `import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/deploy-release.js', import.meta.url));

const fsMock = {
    mkdirSync: mock.fn(),
    chownSync: mock.fn(),
    chmodSync: mock.fn(),
    lstatSync: mock.fn(),
    readFileSync: mock.fn(),
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
    constants: { COPYFILE_EXCL: 1 }
};

mock.module('fs', { defaultExport: fsMock, namedExports: { constants: fsMock.constants } });

const childMock = {
    execFileSync: mock.fn(() => '0\\n')
};

mock.module('child_process', { namedExports: childMock });

const cryptoMock = {
    createHash: mock.fn(() => ({ update: mock.fn(() => ({ digest: mock.fn(() => 'a'.repeat(64)) })) })),
    randomUUID: mock.fn(() => '12345678-1234-1234-1234-123456789012')
};
mock.module('crypto', { defaultExport: cryptoMock });

// We also mock the lib functions to control their outcomes and test branches in deploy-release easily!
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

async function runDeploy(action, arg) {
    const originalArgv = [...process.argv];
    process.argv = ['node', SCRIPT_PATH, action];
    if (arg) process.argv.push(arg);
    const originalExitCode = process.exitCode;
    process.exitCode = 0;
    
    // reset mocks
    for (const key of Object.keys(fsMock)) {
        if (typeof fsMock[key].mock !== 'undefined') fsMock[key].mock.resetCalls();
    }
    childMock.execFileSync.mock.resetCalls();
    for (const key of Object.keys(libMock)) {
        if (typeof libMock[key].mock !== 'undefined') libMock[key].mock.resetCalls();
    }

    try {
        await import(\`\${SCRIPT_PATH}?t=\${Date.now()}\`);
        return process.exitCode;
    } catch(e) {
        // catch throws from the module evaluation if any
        return process.exitCode;
    } finally {
        process.argv = originalArgv;
        process.exitCode = originalExitCode;
    }
}

test('deploy-release.js full coverage', async (t) => {
    t.beforeEach(() => {
        mock.method(process.stdout, 'write', () => {});
        mock.method(process.stderr, 'write', () => {});
        mock.method(process, 'getuid', () => 0);
    });

    await t.test('prepareHost not root', async () => {
        mock.method(process, 'getuid', () => 1000);
        assert.equal(await runDeploy('prepare'), 1);
        mock.method(process, 'getuid', () => 0);
    });

    await t.test('usage', async () => {
        assert.equal(await runDeploy('unknown'), 2);
    });

    await t.test('prepareHost happy path', async () => {
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'id') return '999\\n';
            return '';
        });
        assert.equal(await runDeploy('prepare'), 0);
    });
    
    await t.test('prepareHost create user', async () => {
        let calls = 0;
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'id' && calls++ === 0) throw new Error('not found');
            if (cmd === 'id') return '999\\n';
            return '';
        });
        assert.equal(await runDeploy('prepare'), 0);
    });

    // stageRelease
    await t.test('stageRelease no artifact', async () => {
        assert.equal(await runDeploy('stage'), 1);
    });

    await t.test('stageRelease not tar.gz', async () => {
        fsMock.realpathSync.mock.mockImplementation(() => '/opt/a.txt');
        assert.equal(await runDeploy('stage', 'a.txt'), 1);
    });

    await t.test('stageRelease invalid temp dir', async () => {
        fsMock.realpathSync.mock.mockImplementation(() => '/opt/a.tar.gz');
        fsMock.mkdtempSync.mock.mockImplementation(() => '/tmp/bad');
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });

    // Helper for stage happy path setup
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

    await t.test('stageRelease happy path', async () => {
        setupStageHappy();
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 0);
    });

    // Stage error branches
    await t.test('stageRelease bad file size', async () => {
        setupStageHappy();
        fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, isSymbolicLink: () => false, size: 0, mode: 0o600, uid: 0, gid: 0 }));
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });
    
    await t.test('stageRelease bad checksum length', async () => {
        setupStageHappy();
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.sha256')) return 'a'.repeat(64) + '\\n'; // split space length 1
            if (file.includes('manifest.json')) return JSON.stringify({});
            if (file.includes('release-signing-fingerprint')) return 'A'.repeat(40);
            return '';
        });
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });
    
    await t.test('stageRelease bad checksum hash', async () => {
        setupStageHappy();
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.sha256')) return 'b'.repeat(64) + ' *a.tar.gz\\n'; 
            if (file.includes('release-signing-fingerprint')) return 'A'.repeat(40);
            return '{}';
        });
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });

    await t.test('stageRelease different signature', async () => {
        setupStageHappy();
        let i = 0;
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'gpg') {
                if (i++ === 0) return '[GNUPG:] VALIDSIG ' + 'A'.repeat(40);
                return '[GNUPG:] VALIDSIG ' + 'B'.repeat(40);
            }
            return '';
        });
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });

    await t.test('stageRelease already staged', async () => {
        setupStageHappy();
        fsMock.existsSync.mock.mockImplementation(() => true);
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });

    await t.test('stageRelease invalid package version', async () => {
        setupStageHappy();
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.sha256')) return 'a'.repeat(64) + ' *a.tar.gz\\n';
            if (file.includes('manifest.json')) return JSON.stringify({ version: '1.0.0' });
            if (file.includes('package.json')) return JSON.stringify({ version: '2.0.0' }); // mismatch
            if (file.includes('release-signing-fingerprint')) return 'A'.repeat(40);
            return '';
        });
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });

    await t.test('stageRelease harden tree symbolic link', async () => {
        setupStageHappy();
        fsMock.lstatSync.mock.mockImplementation((file) => {
            if (file.includes('a.tar.gz')) return { isFile: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o600, uid: 0, gid: 0 };
            return { isFile: () => true, isSymbolicLink: () => true, size: 1024, mode: 0o600, uid: 0, gid: 0 };
        });
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });

    await t.test('stageRelease harden tree directory recursion', async () => {
        setupStageHappy();
        let i = 0;
        fsMock.readdirSync.mock.mockImplementation(() => {
            if (i++ === 0) return [{ name: 'dir', isDirectory: () => true }];
            return [];
        });
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 0);
    });

    // signatureFingerprint missing
    await t.test('signatureFingerprint throw', async () => {
        setupStageHappy();
        libMock.parseValidSignatureFingerprint.mock.mockImplementation(() => { throw new Error('bad') });
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });

    // trustedSigningFingerprint mode
    await t.test('trustedSigningFingerprint wrong mode', async () => {
        setupStageHappy();
        fsMock.lstatSync.mock.mockImplementation((f) => {
            if (f.includes('release-signing-fingerprint')) return { isFile: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o777, uid: 0, gid: 0 };
            return { isFile: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o600, uid: 0, gid: 0 };
        });
        assert.equal(await runDeploy('stage', 'a.tar.gz'), 1);
    });

    // activateRelease
    await t.test('activateRelease missing id', async () => {
        assert.equal(await runDeploy('activate'), 1);
    });
    await t.test('activateRelease invalid id', async () => {
        assert.equal(await runDeploy('activate', 'bad'), 1);
    });

    const setupActivateHappy = () => {
        fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 }));
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.release-receipt.json')) return JSON.stringify({});
            if (file.includes('environment')) return 'NODE_ENV=production\\n';
            if (file.includes('credentials')) return 'a'.repeat(64); // mock secret
            if (file.includes('rollback.json')) return JSON.stringify({ rollbackId: '123' });
            return '{}';
        });
        fsMock.existsSync.mock.mockImplementation(() => true);
        fsMock.realpathSync.mock.mockImplementation(() => '/opt/current');
        childMock.execFileSync.mock.mockImplementation(() => '0\\n');
    };

    await t.test('activateRelease happy path', async () => {
        setupActivateHappy();
        assert.equal(await runDeploy('activate', '1.0.0-123456789012'), 0);
    });

    await t.test('activateRelease not directory', async () => {
        setupActivateHappy();
        fsMock.lstatSync.mock.mockImplementation((f) => {
            if (f.includes('1.0.0-123456789012')) return { isDirectory: () => false, isSymbolicLink: () => false };
            return { isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 };
        });
        assert.equal(await runDeploy('activate', '1.0.0-123456789012'), 1);
    });

    await t.test('activateRelease bad target stat', async () => {
        setupActivateHappy();
        fsMock.lstatSync.mock.mockImplementation((f) => {
            if (f.includes('environment')) return { isFile: () => false, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0 };
            return { isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 };
        });
        assert.equal(await runDeploy('activate', '1.0.0-123456789012'), 1);
    });

    await t.test('activateRelease bad target secret stat', async () => {
        setupActivateHappy();
        fsMock.lstatSync.mock.mockImplementation((f) => {
            if (f.includes('state-key')) return { isFile: () => false, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0 };
            return { isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 };
        });
        assert.equal(await runDeploy('activate', '1.0.0-123456789012'), 1);
    });
    
    await t.test('activateRelease duplicated secret', async () => {
        setupActivateHappy();
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('credentials')) return 'same_secret_invalid_len'; 
            return '{}';
        });
        assert.equal(await runDeploy('activate', '1.0.0-123456789012'), 1);
    });

    // atomicSymlink
    await t.test('activateRelease atomicSymlink coverage', async () => {
        setupActivateHappy();
        fsMock.existsSync.mock.mockImplementation((f) => {
            if (f.includes('.current-')) return true; // to trigger unlinkSync
            return false;
        });
        assert.equal(await runDeploy('activate', '1.0.0-123456789012'), 0);
    });

    // installBrokerProjectDropIn
    await t.test('activateRelease installBrokerProjectDropIn coverage', async () => {
        setupActivateHappy();
        fsMock.lstatSync.mock.mockImplementation((f) => {
            if (f.includes('/tmp/repo')) return { isDirectory: () => false, isSymbolicLink: () => false };
            return { isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 };
        });
        assert.equal(await runDeploy('activate', '1.0.0-123456789012'), 1);
    });

    // rollback 
    await t.test('rollback missing id', async () => {
        assert.equal(await runDeploy('rollback'), 1);
    });

    await t.test('rollback invalid id', async () => {
        assert.equal(await runDeploy('rollback', 'bad'), 1);
    });

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

    await t.test('rollback happy path', async () => {
        setupRollbackHappy();
        assert.equal(await runDeploy('rollback', '12345678-1234-1234-1234-123456789012'), 0);
    });

    await t.test('rollback missing metadata fields', async () => {
        fsMock.readFileSync.mock.mockImplementation(() => JSON.stringify({
            rollbackId: '12345678-1234-1234-1234-123456789012',
            units: {},
            brokerProjectDropIn: false,
            previousCurrent: null,
            previousReceipt: false,
            previousLegacyActive: true,
            previousSentinelActive: true
        }));
        fsMock.existsSync.mock.mockImplementation(() => true);
        childMock.execFileSync.mock.mockImplementation(() => '0\\n');
        assert.equal(await runDeploy('rollback', '12345678-1234-1234-1234-123456789012'), 0);
    });

    await t.test('rollback metadata id mismatch', async () => {
        fsMock.readFileSync.mock.mockImplementation(() => JSON.stringify({
            rollbackId: 'wrong',
        }));
        assert.equal(await runDeploy('rollback', '12345678-1234-1234-1234-123456789012'), 1);
    });

    // serviceActive, serviceEnabled coverage
    await t.test('service functions catch', async () => {
        setupRollbackHappy();
        let i = 0;
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'systemctl') {
                if (i++ < 5) throw new Error('fail');
            }
            return '';
        });
        assert.equal(await runDeploy('rollback', '12345678-1234-1234-1234-123456789012'), 0);
    });

    // unloadTransientUnit coverage
    await t.test('activateRelease unloadTransientUnit catch', async () => {
        setupActivateHappy();
        childMock.execFileSync.mock.mockImplementation((cmd, args) => {
            if (cmd === 'systemctl' && args.includes('show')) {
                return '/run/systemd/transient/unit';
            }
            if (cmd === 'systemctl' && args.includes('stop')) throw new Error('stop fail');
            if (cmd === 'systemctl' && args.includes('reset-failed')) throw new Error('reset fail');
            return '0\\n';
        });
        assert.equal(await runDeploy('activate', '1.0.0-123456789012'), 0);
    });

    // activate failure rollback path
    await t.test('activateRelease trigger rollback', async () => {
        setupActivateHappy();
        childMock.execFileSync.mock.mockImplementation((cmd, args) => {
            if (cmd === 'curl') throw new Error('health check fail'); // fail health check to trigger rollback
            return '0\\n';
        });
        assert.equal(await runDeploy('activate', '1.0.0-123456789012'), 1);
    });
});
`;

fs.writeFileSync(testFile, testCode);
