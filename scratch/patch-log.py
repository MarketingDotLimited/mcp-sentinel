import re
with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()
text = text.replace(
    "if (file.includes('.key')) { secretCount++; return secretCount.toString().padStart(64, '0'); }",
    "if (file.includes('.key')) { secretCount++; const s = secretCount.toString().padStart(64, '0'); console.error('KEY:', file, s); return s; }"
)
with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
