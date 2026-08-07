import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

new_test = """
    await t.test('activate-trigger-rollback', async () => {
        setupActivateHappy();
        childMock.execFileSync.mock.mockImplementation((cmd, args) => {
            if (cmd === 'systemctl' && args.includes('start') && args.includes('mcp-sentinel.service')) {
                throw new Error('fail');
            }
            if (cmd === 'systemctl' && (args.includes('is-active') || args.includes('is-enabled'))) {
                throw new Error('fail');
            }
            return '0\\n';
        });
        await run('activate', '1.0.0-123456789012', 1);
    });
"""

text = text.replace("});\n});", "});" + new_test + "\n});")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
