import re
with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = re.sub(r"const cryptoMock = \{.*?\n.*?mock\.module\('crypto', \{ defaultExport: cryptoMock \}\);\n", "", text, flags=re.DOTALL)
text = text.replace("import crypto from 'crypto';", "import crypto from 'crypto';\n")
text = text.replace("    const fsMock = {\n", "    const cryptoMock = {\n        createHash: mock.method(crypto, 'createHash', () => ({ update: () => ({ digest: () => 'abcd' }) })),\n    };\n    const fsMock = {\n")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)

with open('scripts/deploy-release.js', 'r') as f:
    dep = f.read()

# Make sure fs and crypto are used as fs. and crypto. 
# They already are, because they are default imports!

