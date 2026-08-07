with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()
text = text.replace("import child_process from 'child_process';", "import { execFileSync } from 'child_process';")
text = text.replace("return child_process.execFileSync(", "return execFileSync(")
with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()
text = text.replace("namedExports: childMock", "namedExports: { execFileSync: childMock.execFileSync }")
with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
