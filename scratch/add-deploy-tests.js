import fs from 'fs';

const testFile = 'tests/scripts/deploy-release.test.js';
let code = fs.readFileSync(testFile, 'utf8');

// I need to add tests inside the main test block.
// I will replace the end of the file correctly.

const appended = `
    await t.test('stageRelease', async (t) => {
        // missing artifact
        let code = await runDeploy('stage');
        assert.equal(code, 1);

        // invalid artifact
        code = await runDeploy('stage', 'not-tar-gz');
        assert.equal(code, 1);

        // mock valid artifact
        fsMock.realpathSync.mock.mockImplementation(() => '/opt/a.tar.gz');
        fsMock.existsSync.mock.mockImplementation(() => false);
        fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, isSymbolicLink: () => false, size: 1024, mode: 0o600, uid: 0, gid: 0 }));
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.sha256')) return 'a'.repeat(64) + ' *a.tar.gz\\n';
            if (file.includes('manifest.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });
            if (file.includes('package.json')) return JSON.stringify({ version: '1.0.0' });
            return '';
        });
        childMock.execFileSync.mock.mockImplementation((cmd) => {
            if (cmd === 'gpg') return '[GNUPG:] VALIDSIG ' + 'A'.repeat(40);
            if (cmd === 'tar') return 'opt/\\nopt/a\\n';
            return '';
        });
        
        code = await runDeploy('stage', 'a.tar.gz');
        assert.equal(code, 0);
    });

    await t.test('activateRelease', async (t) => {
        // invalid id
        let code = await runDeploy('activate', 'bad');
        assert.equal(code, 1);

        // valid id but fail lstat
        fsMock.lstatSync.mock.mockImplementation(() => { throw new Error('Not found') });
        code = await runDeploy('activate', '1.0.0-123456789012');
        assert.equal(code, 1);

        // full happy path
        fsMock.lstatSync.mock.mockImplementation(() => ({ isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 1024 }));
        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.release-receipt.json')) return JSON.stringify({});
            if (file.includes('environment')) return 'NODE_ENV=production\\n';
            if (file.includes('credentials')) return 'a'.repeat(64);
            return '{}';
        });
        fsMock.existsSync.mock.mockImplementation(() => true);
        fsMock.realpathSync.mock.mockImplementation(() => '/opt/current');
        childMock.execFileSync.mock.mockImplementation(() => '0\\n');

        code = await runDeploy('activate', '1.0.0-123456789012');
        assert.equal(code, 0);
    });

    await t.test('rollback', async (t) => {
        // invalid id
        let code = await runDeploy('rollback', 'bad');
        assert.equal(code, 1);

        fsMock.readFileSync.mock.mockImplementation(() => JSON.stringify({
            rollbackId: '12345678-1234-1234-1234-123456789012',
            units: {},
            serviceStates: {}
        }));
        childMock.execFileSync.mock.mockImplementation(() => '0\\n');

        code = await runDeploy('rollback', '12345678-1234-1234-1234-123456789012');
        assert.equal(code, 0);
    });
`;

// I'll rewrite the entire file so I don't mess up
