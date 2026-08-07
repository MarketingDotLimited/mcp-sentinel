import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

text = text.replace(
    "const originalArgv = process.argv;\n            process.argv = ['node', fileURLToPath(import.meta.url).replace('.test.js', '.js'), 'prepare'];\n            await import('../../../scripts/deploy-release.js?t=' + Date.now());\n            process.argv = originalArgv;",
    "const { execFileSync } = await import('node:child_process');\n            try { execFileSync(process.execPath, [fileURLToPath(import.meta.url).replace('.test.js', '.js'), 'prepare'], { env: process.env }); } catch {}"
)

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
