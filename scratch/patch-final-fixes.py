import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# Fix secrets.json literal string
text = text.replace('{ "MCP_SENTINEL_SECRET": "a".repeat(64) }', '{"MCP_SENTINEL_SECRET": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}')

# Fix validateSigningFingerprint returning undefined!
text = text.replace(
    "validateSigningFingerprint: mock.fn(() => {}),",
    "validateSigningFingerprint: mock.fn(() => true),"
)

# Fix validateProjectWritePaths
text = text.replace(
    "validateProjectWritePaths: mock.fn(() => {}),",
    "validateProjectWritePaths: mock.fn(() => true),"
)

# Fix cryptoMock createHash! It might not be applying. Let's make it return 'a'.repeat(64) statically at the top!
text = re.sub(
    r"const cryptoMock = \{ createHash: mock\.fn\(\) \};",
    r"const cryptoMock = { createHash: mock.fn(() => ({ update: () => ({ digest: () => 'a'.repeat(64) }) })) };",
    text
)
# And remove the mockImplementation in setupStageHappy
text = re.sub(
    r"cryptoMock\.createHash\.mock\.mockImplementation\(\(\) => \(\{ update: \(\) => \(\{ digest: \(\) => 'a'\.repeat\(64\) \}\) \}\)\);",
    r"",
    text
)
# And fix stage-checksum-mismatch to throw!
text = text.replace(
    "cryptoMock.createHash.mock.mockImplementation(() => ({ update: () => ({ digest: () => 'beef' }) }));",
    "cryptoMock.createHash.mock.mockImplementation(() => ({ update: () => ({ digest: () => 'beef' }) }));"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
