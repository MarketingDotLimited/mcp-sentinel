import re

with open('tests/scripts/deploy-release.test.js', 'r') as f:
    text = f.read()

# 1. Remove the entire `if (!process.env.TEST_ACTION) { ... } else {` block and the closing brace at the end.
# Actually, the file starts with imports, then `if (!process.env.TEST_ACTION) { ... } else {`.
text = re.sub(r'if \(!process\.env\.TEST_ACTION\) \{.*?} else \{', '', text, flags=re.DOTALL)

# 2. At the very end, there are some `});\n});`. We need to replace `test(process.env.TEST_ACTION, ...)` with `test('deploy-release.js suite', async (t) => {`
text = re.sub(r"test\(process\.env\.TEST_ACTION,\s*async \(\) =>\s*\{", "test('deploy-release.js suite', async (t) => {", text)
text = re.sub(r"const action = process\.env\.TEST_ACTION;", "", text)

# 3. Inside the `await test(...)`, we need to change `await import(SCRIPT_PATH)` to `await import(SCRIPT_PATH + '?t=' + Date.now())`
text = text.replace('await import(SCRIPT_PATH);', "await import(SCRIPT_PATH + '?t=' + Date.now());")

with open('tests/scripts/deploy-release.test.js', 'w') as f:
    f.write(text)
