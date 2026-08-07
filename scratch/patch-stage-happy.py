import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

new_mock = """        fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.sha256')) return 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb *a.tar.gz\\n';
            if (file.includes('.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });
            return 'a';
        });"""

text = re.sub(
    r"fsMock\.readFileSync\.mock\.mockImplementation\(\(file\) => \{\n\s+if \(file\.includes\('\.json'\)\) return JSON\.stringify\(\{ version: '1\.0\.0', commit: 'c'\.repeat\(40\) \}\);\n\s+return 'a';\n\s+\}\);",
    new_mock,
    text
)
# ALSO: fsMock.existsSync must return true for trustedSigningFingerprintFile and .sha256!
# In setupStageHappy:
text = text.replace(
    "fsMock.existsSync.mock.mockImplementation(() => false);",
    "fsMock.existsSync.mock.mockImplementation(() => true);"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
