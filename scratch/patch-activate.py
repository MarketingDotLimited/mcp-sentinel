import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace(
    "if (file.includes('package.json') || file.includes('manifest.json')) return JSON.stringify({ version: '1.0.0' });",
    "if (file.includes('package.json') || file.includes('manifest.json') || file.includes('.json')) return JSON.stringify({ version: '1.0.0' });"
)
# Wait, I already changed it, but maybe I didn't change setupActivateHappy because it didn't match!
# Let's just override setupActivateHappy readFileSync exactly!
with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = re.sub(
    r"fsMock\.readFileSync\.mock\.mockImplementation\(\(file\) => \{.*?\n\s+return '';\n\s+\}\);",
    r"""fsMock.readFileSync.mock.mockImplementation((file) => {
            if (file.includes('.json')) return JSON.stringify({ version: '1.0.0', commit: 'c'.repeat(40) });
            return 'a';
        });""",
    text,
    flags=re.DOTALL
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
