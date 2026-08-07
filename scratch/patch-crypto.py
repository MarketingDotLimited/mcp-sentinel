import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace(
    "fsMock.readdirSync.mock.mockImplementation(() => [{ name: 'file', isDirectory: () => false }]);\n    };",
    "fsMock.readdirSync.mock.mockImplementation(() => [{ name: 'file', isDirectory: () => false }]);\n        cryptoMock.createHash.mock.mockImplementation(() => ({ update: () => ({ digest: () => 'a'.repeat(64) }) }));\n    };"
)

# Also fix activate-happy: what does setupActivateHappy lack?
# activateRelease uses fs.symlinkSync, fs.renameSync, fs.rmSync.
# It also does JSON.parse(fs.readFileSync(packageJsonPath))
# Wait, activate-happy prints: SyntaxError: Unexpected end of JSON input!
# Why? Because fsMock.readFileSync returns '' for other files!
text = text.replace(
    "if (file.includes('package.json')) return JSON.stringify({ version: '1.0.0' });",
    "if (file.includes('package.json') || file.includes('manifest.json')) return JSON.stringify({ version: '1.0.0' });\n            if (file.includes('release-signing-fingerprint')) return 'A'.repeat(40);"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
