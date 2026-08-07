import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace("import fs from 'fs';", "import originalFs from 'fs';")
if "import originalFs from 'fs';" not in text:
    text = text.replace("import path from 'path';", "import path from 'path';\nimport originalFs from 'fs';")

# Replace the readFileSync mock
text = re.sub(
    r'readFileSync: mock\.fn\(\)',
    r"readFileSync: mock.fn((f) => { try { if (f.includes('tests/scripts') || f.includes('scripts/') || f.includes('node:')) return originalFs.readFileSync(f, 'utf8'); } catch (e) {} return ''; })",
    text
)

# Also fix lstatSync to fallback? Maybe not needed for stack traces.

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
