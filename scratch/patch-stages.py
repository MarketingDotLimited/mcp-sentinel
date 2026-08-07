import re
with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# stage-checksum-mismatch
text = text.replace(
    "// test removed this line to not crash",
    "fsMock.readFileSync.mock.mockImplementation((file) => { if (file.includes('.sha256')) return 'beef *a.tar.gz\\n'; return 'a'; });"
)

# stage-bad-signature
text = text.replace(
    "if (cmd === 'gpg') return 'BADSIG';\n            return '';",
    "if (cmd === 'gpg') return 'BADSIG';\n            return '';\n        });\n        libMock.validateSigningFingerprint.mock.mockImplementation(() => { throw new Error('Artifact and manifest must be signed by the same key'); });"
)

# stage-bad-tar-list
text = text.replace(
    "if (cmd === 'tar' && args.includes('-tzf')) return 'prefix/\\n../bad\\n';\n            return '';",
    "if (cmd === 'tar' && args.includes('-tzf')) return 'prefix/\\n../bad\\n';\n            return '';\n        });\n        libMock.validateArchiveEntries.mock.mockImplementation(() => { throw new Error('Release archive must only contain files within a single root directory'); });"
)

# stage-no-manifest
text = text.replace(
    "if (file.includes('.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });\n            return 'a';\n        });\n        await run('stage', 'a.tar.gz', 1);",
    "if (file.includes('.json')) return JSON.stringify({ version: '2.0.0' });\n            return 'a';\n        });\n        libMock.validateReleaseManifest.mock.mockImplementation(() => { throw new Error('Release manifest must be valid'); });\n        await run('stage', 'a.tar.gz', 1);"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
