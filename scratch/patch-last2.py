import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# Fix stage-checksum-mismatch:
# we need to make fsMock.readFileSync return a bad checksum for it
text = re.sub(
    r"cryptoMock\.createHash\.mock\.mockImplementation\(\(\) => \(\{ update: \(\) => \(\{ digest: \(\) => 'beef' \}\) \}\)\);",
    r"fsMock.readFileSync.mock.mockImplementation((file) => { if (file.includes('.sha256')) return 'beef *a.tar.gz\\n'; return 'a'; });",
    text
)

# Fix stage-bad-signature:
# validateSigningFingerprint should throw
text = re.sub(
    r"childMock\.execFileSync\.mock\.mockImplementation\(\(cmd\) => \{\n\s+if \(cmd === 'gpg'\) return 'BADSIG';\n\s+return '0\\n';\n\s+\}\);",
    r"childMock.execFileSync.mock.mockImplementation((cmd) => { if (cmd === 'gpg') return 'BADSIG'; return '0\\n'; });\n        libMock.validateSigningFingerprint.mock.mockImplementation(() => { throw new Error('Artifact and manifest must be signed by the same key'); });",
    text
)

# Fix stage-bad-tar-list
text = re.sub(
    r"childMock\.execFileSync\.mock\.mockImplementation\(\(cmd\) => \{\n\s+if \(cmd === 'tar' && process\.argv\.includes\('-tzf'\)\) return 'prefix/\\nprefix/b\\n';\n\s+return '0\\n';\n\s+\}\);",
    r"childMock.execFileSync.mock.mockImplementation((cmd) => { if (cmd === 'tar' && process.argv.includes('-tzf')) return 'prefix/\\nprefix/b\\n'; return '0\\n'; });\n        libMock.validateArchiveEntries.mock.mockImplementation(() => { throw new Error('Release archive must only contain files within a single root directory'); });",
    text
)

# Fix stage-no-manifest
text = re.sub(
    r"fsMock\.readFileSync\.mock\.mockImplementation\(\(file\) => \{\n\s+if \(file\.includes\('\.json'\)\) return JSON\.stringify\(\{ version: '2\.0\.0' \}\);\n\s+return 'a';\n\s+\}\);",
    r"fsMock.readFileSync.mock.mockImplementation((file) => { if (file.includes('.json')) return JSON.stringify({ version: '2.0.0' }); if (file.includes('.sha256')) return 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb *a.tar.gz\\n'; return 'a'; });\n        libMock.validateReleaseManifest.mock.mockImplementation(() => { throw new Error('Release manifest must be valid'); });",
    text
)

# Fix activate-happy secrets
text = re.sub(
    r"fsMock\.readFileSync\.mock\.mockImplementation\(\(file\) => \{\n\s+if \(file\.includes\('\.json'\)\) return JSON\.stringify\(\{ version: '1\.0\.0', commit: 'c'\.repeat\(40\) \}\);\n\s+return 'a';\n\s+\}\);",
    r"fsMock.readFileSync.mock.mockImplementation((file) => {\n            if (file.includes('secrets.json')) return JSON.stringify({ MCP_SENTINEL_SECRET: 'a'.repeat(64) });\n            if (file.includes('.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });\n            return 'a';\n        });",
    text
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
