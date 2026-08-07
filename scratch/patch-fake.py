import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

text = text.replace(
    "function requireRoot() {\n  const currentUid = process.env.TEST_UID !== undefined ? Number(process.env.TEST_UID) : (process.getuid ? process.getuid() : 0);\n  if (currentUid !== 0) {",
    "function requireRoot() {\n  if (process.argv.includes('--fake-not-root') || (process.getuid && process.getuid() !== 0)) {"
)

text = text.replace("console.log(\"UID:\", process.env.TEST_UID, process.getuid ? process.getuid() : \"none\");\n", "")

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace("process.env.TEST_UID = '1000';", "")
text = text.replace("delete process.env.TEST_UID;", "")
text = text.replace("await run('prepare', null, 1);", "await run('prepare', '--fake-not-root', 1);")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
