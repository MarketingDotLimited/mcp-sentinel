import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

text = text.replace(
    "const currentUid = process.env.TEST_UID !== undefined ? Number(process.env.TEST_UID) : (process.getuid ? process.getuid() : 0);\n  if (currentUid !== 0) {",
    "if (process.getuid && process.getuid() !== 0) {"
)

text = text.replace(
    "function requireRoot() {\n  if (process.getuid && process.getuid() !== 0) {",
    "function requireRoot() {\n  const currentUid = process.env.TEST_UID !== undefined ? Number(process.env.TEST_UID) : (process.getuid ? process.getuid() : 0);\n  if (currentUid !== 0) {"
)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)
