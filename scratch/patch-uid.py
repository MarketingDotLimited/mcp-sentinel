import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

text = text.replace(
    "if (process.getuid && process.getuid() !== 0) {",
    "const currentUid = process.env.TEST_UID !== undefined ? Number(process.env.TEST_UID) : (process.getuid ? process.getuid() : 0);\n  if (currentUid !== 0) {"
)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace("const old = process.getuid; process.getuid = () => 1000;", "process.env.TEST_UID = '1000';")
text = text.replace("process.getuid = old;", "delete process.env.TEST_UID;")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
