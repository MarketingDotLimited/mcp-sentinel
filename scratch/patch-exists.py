import re
with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace(
    "fsMock.existsSync.mock.mockImplementation(() => true);",
    "fsMock.existsSync.mock.mockImplementation((file) => { if (file.includes('1.0.0-abcdef123456')) return false; return true; });"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
