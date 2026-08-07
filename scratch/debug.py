with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace("test('deploy-release.js suite', async (t) => {", "test('deploy-release.js suite', async (t) => {\nconsole.log('SUITE START');")
text = text.replace("const { runCommand } = await import(SCRIPT_PATH);", "console.log('IMPORTING');\nconst { runCommand } = await import(SCRIPT_PATH);\nconsole.log('IMPORTED');")
text = text.replace("await t.test('prepare-not-root',", "console.log('TEST 1');\nawait t.test('prepare-not-root',")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
