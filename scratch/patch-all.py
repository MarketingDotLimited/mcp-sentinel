import re

with open('scripts/deploy-release.js', 'r') as f:
    text = f.read()

# Fix UID check!
text = re.sub(
    r"function requireRoot\(\) \{\n\s+if \(process\.getuid\?\.\(\) \!== 0\) throw new Error\('Production deployment commands must run as root'\);\n\}",
    r"function requireRoot() {\n    if (process.argv.includes('--fake-not-root') || (process.getuid && process.getuid() !== 0)) throw new Error('Production deployment commands must run as root');\n}",
    text
)

text = text.replace(
    "process.exitCode = 1;",
    "console.error('CAUGHT:', error.stack);\n    process.exitCode = 1;"
)

with open('scripts/deploy-release.js', 'w') as f:
    f.write(text)

