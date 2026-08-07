import fs from 'fs';
let code = fs.readFileSync('scratch/rewrite-deploy-test.js', 'utf8');
const newTests = `
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
`;
code = code.replace(/}\s*\);\s*}\s*$/g, newTests);
fs.writeFileSync('scratch/rewrite-deploy-test.js', code);
