import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# Make sure we replace `await import(SCRIPT_PATH);` with `await import(SCRIPT_PATH + '?t=' + Date.now());`
text = text.replace("await import(SCRIPT_PATH);", "await import(SCRIPT_PATH + '?t=' + Date.now());")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
