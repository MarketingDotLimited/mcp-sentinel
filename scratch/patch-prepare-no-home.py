import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

new_test = """
    await t.test('prepare-no-home', async () => {
        setupPrepareHappy();
        fsMock.existsSync.mock.mockImplementation(() => false);
        await run('prepare', null, 1);
    });
"""

text = text.replace("});\n});", "});" + new_test + "\n});")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
