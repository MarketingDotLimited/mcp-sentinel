import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace('{ "MCP_SENTINEL_SECRET": "abc" }', '{"MCP_SENTINEL_SECRET": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')

text = text.replace(
    "validateSigningFingerprint: mock.fn(() => {}),",
    "validateSigningFingerprint: mock.fn(() => true),"
)

text = text.replace(
    "validateProjectWritePaths: mock.fn(() => {}),",
    "validateProjectWritePaths: mock.fn(() => true),"
)

# For setupStageHappy:
old_mock = """        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });
            return 'a';
        });"""
new_mock = """        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.sha256')) return 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb *a.tar.gz\\n';
            if (file.includes('.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });
            return 'a';
        });"""
text = text.replace(old_mock, new_mock)

text = text.replace(
    "fsMock.existsSync.mock.mockImplementation(() => false);",
    "fsMock.existsSync.mock.mockImplementation(() => true);"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
