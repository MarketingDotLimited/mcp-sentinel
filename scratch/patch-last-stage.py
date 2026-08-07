import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

new_test = """
    await t.test('stage-bad-parse-signature', async () => {
        setupStageHappy();
        libMock.parseValidSignatureFingerprint.mock.mockImplementation(() => { throw new Error('parse error'); });
        await run('stage', 'a.tar.gz', 1);
    });
"""

text = text.replace("});\n});", "});" + new_test + "\n});")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
