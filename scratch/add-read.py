with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace("mkdirSync: mock.fn(),", "readFileSync: mock.fn(() => ''), mkdirSync: mock.fn(),")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
