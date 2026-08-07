import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# Replace the .key mock with a dynamic one that returns unique 64-char strings
old_mock = "if (file.includes('.key')) return 'a'.repeat(64); if (file.includes('.key')) return 'a'.repeat(64);"
new_mock = "if (file.includes('.key')) return cryptoMock.createHash().update(file).digest('hex');"

text = text.replace(old_mock, new_mock)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
