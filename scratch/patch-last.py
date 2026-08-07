import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# Fix stage-bad-file-size
text = text.replace(
    "isFile: () => true, size: 2 * 1024 * 1024 * 1024",
    "isFile: () => true, isDirectory: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 0, gid: 0, size: 2 * 1024 * 1024 * 1024"
)

# Fix setupActivateHappy secrets
old_mock_activate = """        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });
            return 'a';
        });"""

new_mock_activate = """        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('secrets.json')) return JSON.stringify({ MCP_SENTINEL_SECRET: 'a'.repeat(64) });
            if (file.includes('.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });
            return 'a';
        });"""

text = text.replace(old_mock_activate, new_mock_activate)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
