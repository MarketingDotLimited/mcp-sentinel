import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace(
    "throw new Error('exit mismatch');",
    "originalFs.appendFileSync('scratch/err.txt', 'EXIT MISMATCH: expected ' + expectedCode + ' got ' + actualCode + '\\n'); throw new Error('exit mismatch');"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
