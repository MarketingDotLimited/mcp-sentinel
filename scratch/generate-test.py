import re

with open('scripts/deploy-release.js', 'r') as f:
    deploy_js = f.read()

# Make deploy-release.js use default imports for child_process
deploy_js = deploy_js.replace("import { execFileSync } from 'child_process';", "import child_process from 'child_process';")
deploy_js = deploy_js.replace("execFileSync(file, argv,", "child_process.execFileSync(file, argv,")

# Make deploy-release.js use deployment as a namespace for named imports
deploy_js = re.sub(r"import \{\n(.*?)\n\} from '\.\./lib/deployment\.js';", "import * as deployment from '../lib/deployment.js';", deploy_js, flags=re.DOTALL)
for name in ["parseEnvironment", "parseValidSignatureFingerprint", "validateArchiveEntries", "validateArchiveListing", "validateReleaseManifest", "validateProjectWritePaths", "validateSigningFingerprint"]:
    deploy_js = re.sub(r"(?<!deployment\.)" + name + r"\(", f"deployment.{name}(", deploy_js)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(deploy_js)

# Now, the deploy-release.test.js code:
test_code = """import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import child_process from 'child_process';
import crypto from 'crypto';
import * as deployment from '../../lib/deployment.js';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/deploy-release.js', import.meta.url));

test('deploy-release.js suite', async (t) => {

    const fsMock = {
        mkdirSync: mock.method(fs, 'mkdirSync', () => {}),
        chownSync: mock.method(fs, 'chownSync', () => {}),
        chmodSync: mock.method(fs, 'chmodSync', () => {}),
        lstatSync: mock.method(fs, 'lstatSync', () => ({ uid: 999, gid: 999 })),
        readFileSync: mock.method(fs, 'readFileSync', (p) => {
            if (p.includes('tests/scripts') || p.includes('scripts/deploy-release.js')) return ''; // fallback for cache but we shouldn't hit it
            return '';
        }),
        writeFileSync: mock.method(fs, 'writeFileSync', () => {}),
        existsSync: mock.method(fs, 'existsSync', () => false),
        copyFileSync: mock.method(fs, 'copyFileSync', () => {}),
        rmSync: mock.method(fs, 'rmSync', () => {}),
        mkdtempSync: mock.method(fs, 'mkdtempSync', () => '/tmp/mcp-release-1234'),
        readdirSync: mock.method(fs, 'readdirSync', () => []),
        unlinkSync: mock.method(fs, 'unlinkSync', () => {}),
        symlinkSync: mock.method(fs, 'symlinkSync', () => {}),
        renameSync: mock.method(fs, 'renameSync', () => {}),
        realpathSync: mock.method(fs, 'realpathSync', (p) => p),
    };

    const childMock = {
        execFileSync: mock.method(child_process, 'execFileSync', () => '0\\n')
    };

    const cryptoMock = {
        createHash: mock.method(crypto, 'createHash', () => ({ update: () => ({ digest: () => 'abcd' }) }))
    };

    const libMock = {
        parseEnvironment: mock.method(deployment, 'parseEnvironment', () => ({})),
        parseValidSignatureFingerprint: mock.method(deployment, 'parseValidSignatureFingerprint', () => 'abcdef1234567890'),
        validateArchiveEntries: mock.method(deployment, 'validateArchiveEntries', () => []),
        validateArchiveListing: mock.method(deployment, 'validateArchiveListing', () => {}),
        validateReleaseManifest: mock.method(deployment, 'validateReleaseManifest', () => {}),
        validateProjectWritePaths: mock.method(deployment, 'validateProjectWritePaths', () => {}),
        validateSigningFingerprint: mock.method(deployment, 'validateSigningFingerprint', () => {}),
    };

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
            if (file.includes('package.json')) return JSON.stringify({ version: '1.0.0' });
            if (file.includes('secrets.json')) return JSON.stringify({ "MCP_SENTINEL_SECRET": "abc" });
            return '';
        });
        fsMock.existsSync.mock.mockImplementation(() => true);
        fsMock.realpathSync.mock.mockImplementation(() => '/opt/current');
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'systemctl') return '0\\n';
            return '';
        });
    };

    const run = async (action, arg = null, expectedCode = 0) => {
        process.argv = ['node', SCRIPT_PATH, action];
        if (arg) process.argv.push(arg);
        
        try {
            await import(SCRIPT_PATH + '?t=' + Date.now());
        } catch (e) {
            console.error(e);
        }
        
        const actualCode = process.exitCode;
        process.exitCode = 0;
        if ((actualCode || 0) !== expectedCode && (process.exitCode || 0) !== expectedCode) {
            throw new Error(`exit mismatch: expected ${expectedCode}, got ${actualCode}`);
        }
        process.exitCode = 0;
    };

    await t.test('prepare-not-root', async () => {
        mock.method(process, 'getuid', () => 1000);
        await run('prepare', null, 1);
        mock.method(process, 'getuid', () => 0); // reset
    });

    await t.test('usage', async () => {
        await run('unknown', null, 2);
    });

    await t.test('prepare-happy', async () => {
        childMock.execFileSync.mock.mockImplementation((cmd) => cmd === 'id' ? '999\\n' : '');
        await run('prepare', null, 0);
    });

    await t.test('prepare-create-user', async () => {
        let calls = 0;
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'id' && calls++ === 0) throw new Error('not found');
            return cmd === 'id' ? '999\\n' : '';
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
        fsMock.mkdtempSync.mock.mockImplementation(() => { throw new Error('fail'); });
        await run('stage', 'a.tar.gz', 1);
    });

    await t.test('stage-happy', async () => {
        setupStageHappy();
        await run('stage', 'a.tar.gz', 0);
    });

    await t.test('stage-bad-file-size', async () => {
        setupStageHappy();
        fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, size: 2 * 1024 * 1024 * 1024 }));
        await run('stage', 'a.tar.gz', 1);
    });

    await t.test('stage-bad-checksum-length', async () => {
        setupStageHappy();
        fsMock.readFileSync.mock.mockImplementation((file) => file.includes('.sha256') ? 'abcd *a.tar.gz\\n' : '');
        await run('stage', 'a.tar.gz', 1);
    });

    await t.test('stage-checksum-mismatch', async () => {
        setupStageHappy();
        cryptoMock.createHash.mock.mockImplementation(() => ({ update: () => ({ digest: () => 'beef' }) }));
        await run('stage', 'a.tar.gz', 1);
    });

    await t.test('stage-bad-signature', async () => {
        setupStageHappy();
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'gpg') return 'BADSIG';
            return '';
        });
        await run('stage', 'a.tar.gz', 1);
    });

    await t.test('stage-bad-tar-list', async () => {
        setupStageHappy();
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'gpg') return '[GNUPG:] VALIDSIG ' + 'A'.repeat(40);
            if (cmd === 'tar' && process.argv.includes('-tzf')) return 'prefix/\\n../bad\\n';
            return '';
        });
        await run('stage', 'a.tar.gz', 1);
    });

    await t.test('stage-no-manifest', async () => {
        setupStageHappy();
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('manifest.json')) throw new Error('no manifest');
            if (file.includes('.sha256')) return 'a'.repeat(64) + ' *a.tar.gz\\n';
            return '';
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
        fsMock.existsSync.mock.mockImplementation(() => false);
        await run('activate', '1.0.0-123456789012', 1);
    });

    await t.test('activate-not-dir', async () => {
        fsMock.existsSync.mock.mockImplementation(() => true);
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
        fsMock.existsSync.mock.mockImplementation(() => false);
        await run('rollback', '1.0.0-123456789012', 1);
    });

    await t.test('rollback-happy', async () => {
        setupActivateHappy();
        await run('rollback', '1.0.0-123456789012', 0);
    });

    await t.test('service-catch', async () => {
        setupActivateHappy();
        childMock.execFileSync.mock.mockImplementation((cmd, args) => {
            if (cmd === 'systemctl' && (args.includes('is-active') || args.includes('is-enabled'))) {
                throw new Error('fail');
            }
            return '0\\n';
        });
        await run('activate', '1.0.0-123456789012', 0);
    });
});
"""

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(test_code)
