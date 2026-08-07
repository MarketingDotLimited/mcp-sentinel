import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# Add readFileSync back
text = text.replace(
    "writeFileSync: mock.method(fs, 'writeFileSync', () => {}),",
    "readFileSync: mock.method(fs, 'readFileSync', () => ''),\n        writeFileSync: mock.method(fs, 'writeFileSync', () => {}),"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
