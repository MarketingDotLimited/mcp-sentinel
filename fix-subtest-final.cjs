const fs = require('fs');
let content = fs.readFileSync('tests/scripts/register-node-project.test.js', 'utf8');

const replacement = `    await t.test('validateNodeProject validates input', async (t) => {
        let cpExecMock = '1000';
        mock.module('node:child_process', {
            get namedExports() { return this.defaultExport; }, defaultExport: { execFileSync: () => cpExecMock }
        });
        const module = await import(SCRIPT_PATH + '?t=' + Date.now());
        await assert.rejects(() => module.validateNodeProject(null), /Project record must be an object/);
        await assert.rejects(() => module.validateNodeProject({}), /Project ID must be a UUID/);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: ''}), /Invalid project name/);
        
        mock.method(fs, 'realpath', async (p) => p);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/b'}), /Project repository must be inside its root/);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'root'}), /Project execution user must be non-root/);
        
        cpExecMock = '0';
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user'}), /Project execution user must resolve to a non-root UID/);
        
        cpExecMock = '1000';
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user', permittedTasks: ['invalid']}), /Project contains an invalid task recipe/);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user', permittedTasks: ['npm'], permittedGitActions: ['invalid']}), /Project contains an invalid Git recipe/);
        await assert.rejects(() => module.validateNodeProject({id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a', runAsUser: 'user', permittedTasks: ['npm'], permittedGitActions: ['status'], testNetworkHosts: ['not-an-ip']}), /Project test network dependencies must be explicit IP addresses/);

        // Valid
        const res = await module.validateNodeProject({
            id: '00000000-0000-1000-8000-000000000000', name: 'valid', rootPath: '/a', repoPath: '/a/b', runAsUser: 'user', permittedTasks: ['npm'], permittedGitActions: ['status'], testNetworkHosts: ['127.0.0.1'], environment: 'development', protectedPaths: ['/x'], allowRecursiveDelete: true
        });
        assert.equal(res.id, '00000000-0000-1000-8000-000000000000');
    });`;

content = content.replace(/    await t\.test\('validateNodeProject validates input', async \(t\) => \{[\s\S]*?        assert\.equal\(res\.id, '00000000-0000-1000-8000-000000000000'\);\n    \}\);/, replacement);
fs.writeFileSync('tests/scripts/register-node-project.test.js', content);
