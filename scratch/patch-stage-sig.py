import re
with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()
text = text.replace(
    "await run('rollback', '1.0.0-123456789012', 1);\n    });",
    "await run('rollback', '1.0.0-123456789012', 1);\n    });\n\n    await t.test('stage-bad-parse-signature', async () => {\n        setupStageHappy();\n        libMock.parseValidSignatureFingerprint.mock.mockImplementation(() => { throw new Error('parse error'); });\n        await run('stage', 'a.tar.gz', 1);\n    });\n"
)
with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
